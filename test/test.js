const Boom = require('@hapi/boom');
const Cabin = require('cabin');
const Koa = require('koa');
const Router = require('@koa/router');
const errorHandler = require('koa-better-error-handler');
const fetch = require('fetch-cookie/node-fetch')(require('node-fetch'));
const session = require('koa-generic-session');
const test = require('ava');

const RedirectLoop = require('..');

const redirectLoop = new RedirectLoop();
const cabin = new Cabin();
const cookiesKey = 'lad.sid';

test.beforeEach((t) => {
  const app = new Koa();
  app.keys = ['some secret'];
  // override koa's undocumented error handler
  app.context.onerror = errorHandler(cookiesKey);
  const router = new Router();
  app.keys = ['lad'];
  app.use(
    session({
      key: cookiesKey,
      cookie: {
        httpOnly: true,
        path: '/',
        overwrite: true,
        signed: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      }
    })
  );
  app.use(cabin.middleware);
  app.use(redirectLoop.middleware);
  router.get('/', (ctx) => {
    ctx.status = 200;
  });
  router.get('/bar', (ctx) => ctx.redirect('/foo'));
  router.get('/foo', (ctx) => ctx.redirect('/foo'));
  router.get('/baz', (ctx) => ctx.redirect('/bar'));
  router.get('/beep', (ctx) => {
    ctx.status = 200;
  });
  router.get('/boop', (ctx) => ctx.redirect('/boop'));
  router.get('/1', (ctx) => ctx.redirect('/2')); // 1
  router.get('/2', (ctx) => ctx.redirect('/3')); // 2
  router.get('/3', (ctx) => ctx.redirect('/4')); // 3
  router.get('/4', (ctx) => ctx.redirect('/5')); // 4
  router.get('/5', (ctx) => ctx.redirect('/6')); // 5
  router.get('/6', (ctx) => ctx.redirect('/7')); // 6 <-- redirects to /
  router.get('/7', (ctx) => ctx.redirect('/8'));
  router.get('/form', (ctx) => {
    ctx.status = 200;
  });
  router.post('/form', (ctx) => ctx.redirect('/form'));
  router.get('/error', (ctx) => {
    ctx.throw(Boom.badRequest('Uh oh'));
  });
  router.get('/headers', async (ctx) => {
    ctx.res.write('hello');
    ctx.res.end();
    ctx.throw(Boom.badRequest('Uh oh'));
  });
  app.use(router.routes());
  const server = app.listen();
  t.context.url = `http://localhost:${server.address().port}/`;
});

test('caps at max of 5 redirects', async (t) => {
  const res = await fetch(`${t.context.url}1`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/beep => 200 => /boop => /beep', async (t) => {
  let res = await fetch(`${t.context.url}beep`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}beep`);
  res = await fetch(`${t.context.url}boop`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}beep`);
  t.pass();
});

test('/bar => /foo => /', async (t) => {
  const res = await fetch(`${t.context.url}bar`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/foo => /', async (t) => {
  const res = await fetch(`${t.context.url}foo`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/baz => /bar => /foo => /', async (t) => {
  const res = await fetch(`${t.context.url}baz`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('prevents incorrect redirect to earlier path', async (t) => {
  // GET / -> GET /form -> POST /form -> GET /form
  let res = await fetch(t.context.url, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  res = await fetch(`${t.context.url}form`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);

  // GET /form -> POST /form -> GET /form -> POST /form
  res = await fetch(`${t.context.url}form`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    credentials: 'include',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: { Accept: 'text/html' }
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);

  t.pass();
});

test('router does not endless redirect when thrown bad request with referrer', async (t) => {
  const referrer = `${t.context.url}error`;
  const res = await fetch(referrer, {
    credentials: 'include',
    redirect: 'manual',
    headers: {
      Referrer: referrer,
      Accept: 'text/html'
    }
  });
  t.is(res.headers.get('location'), referrer);
  t.is(res.status, 302);
});

test('router does not endless redirect when thrown bad request without referrer', async (t) => {
  const referrer = `${t.context.url}error`;
  const res = await fetch(referrer, {
    credentials: 'include',
    redirect: 'manual',
    headers: {
      Accept: 'text/html'
    }
  });
  t.is(res.status, 400);
  t.is(res.url, referrer);
});

/*
Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
    at ServerResponse.setHeader (_http_outgoing.js:485:11)
    at Cookies.set (/Users/user/Projects/forwardemail.net/node_modules/cookies/index.js:116:13)
    at Object.set (/Users/user/Projects/forwardemail.net/node_modules/koa-generic-session/lib/session.js:462:20)
    at /Users/foo/Projects/forwardemail.net/node_modules/koa-generic-session/lib/session.js:189:28
    at Generator.next (<anonymous>)
    at step (/Users/foo/Projects/forwardemail.net/node_modules/koa-generic-session/lib/session.js:3:191)
    at /Users/foo/Projects/forwardemail.net/node_modules/koa-generic-session/lib/session.js:3:361
*/
test('does not throw ERR_HTTP_HEADERS_SENT', async (t) => {
  const res = await fetch(`${t.context.url}headers`, {
    credentials: 'include',
    headers: {
      Accept: 'text/html'
    }
  });
  t.is(res.status, 404);
});
