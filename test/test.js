const Boom = require('@hapi/boom');
const Cabin = require('cabin');
const Koa = require('koa');
const Redis = require('ioredis-mock');
const Router = require('@koa/router');
const StateHelper = require('@ladjs/state-helper');
const cryptoRandomString = require('crypto-random-string');
const errorHandler = require('koa-better-error-handler');
const flash = require('koa-better-flash');
const redisStore = require('koa-redis');
const session = require('koa-generic-session');
const supertest = require('supertest');
const test = require('ava');

const RedirectLoop = require('..');

const redirectLoop = new RedirectLoop();
const cabin = new Cabin();
const client = new Redis();
const cookiesKey = 'lad.sid';

let request;

test.beforeEach((t) => {
  const app = new Koa();
  app.keys = ['some secret'];
  // override koa's undocumented error handler
  app.context.onerror = errorHandler(cookiesKey);
  const router = new Router();
  // session store
  app.keys = ['koa-redirect-loop'];
  app.use(
    session({
      store: redisStore({ client }),
      key: cookiesKey,
      cookie: {
        httpOnly: true,
        path: '/',
        overwrite: true,
        signed: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      },
      genSid: () => cryptoRandomString.async({ length: 32 })
    })
  );
  app.use(cabin.middleware);

  // add dynamic view helpers
  const stateHelper = new StateHelper();
  app.use(stateHelper.middleware);
  app.use(redirectLoop.middleware);
  // flash messages (must come after sessions added and flash)
  app.use(flash());

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

  router.get('/redirect-start', async (ctx) => {
    ctx.flash('success', 'yay!');
    ctx.redirect('/redirect-end');
  });

  router.get('/redirect-end', async (ctx) => {
    ctx.body = ctx.state.flash();
  });

  router.get('/throw-start', async (ctx) => {
    ctx.flash('success', 'oops!');
    ctx.throw(500);
  });

  router.get('/throw-end', async (ctx) => {
    ctx.body = ctx.state.flash();
  });

  app.use(router.routes());
  const server = app.listen();
  t.context.url = `http://127.0.0.1:${server.address().port}/`;
  request = supertest.agent(server);
});

test('caps at max of 5 redirects', async (t) => {
  const res = await request
    .get(`/1`)
    .set('Accept', 'text/html')
    .redirects(10)
    .expect(200);

  t.is(res.redirects.pop(), t.context.url);
});

test('/beep => 200 => /boop => /beep', async (t) => {
  let res = await request.get(`/beep`).redirects().expect(200);
  // since this shouldn't redirect there should be no redirects in res.redirects
  t.is(res.redirects.length, 0);

  res = await request.get(`/boop`).redirects().expect(200);
  t.is(res.redirects.pop(), `${t.context.url}beep`);
});

test('/bar => /foo => /', async (t) => {
  const res = await request.get(`/bar`).redirects().expect(200);
  t.is(res.redirects.pop(), t.context.url);
});

test('/foo => /', async (t) => {
  const res = await request.get(`/foo`).redirects().expect(200);
  t.is(res.redirects.pop(), t.context.url);
});

test('/baz => /bar => /foo => /', async (t) => {
  const res = await request.get(`/baz`).redirects().expect(200);
  t.is(res.redirects.pop(), t.context.url);
});

test('prevents incorrect redirect to earlier path', async (t) => {
  // GET / -> GET /form -> POST /form -> GET /form
  let res = await request.get('/').redirects().expect(200);
  // since this shouldn't redirect there should be no redirects in res.redirects
  t.is(res.redirects.length, 0);

  res = await request.get(`/form`).redirects().expect(200);
  // since this shouldn't redirect there should be no redirects in res.redirects
  t.is(res.redirects.length, 0);

  res = await request.post(`/form`).expect(302);
  t.is(res.header.location, `/form`);

  // GET /form -> POST /form -> GET /form -> POST /form
  res = await request.get(`/form`).redirects().expect(200);
  // since this shouldn't redirect there should be no redirects in res.redirects
  t.is(res.redirects.length, 0);

  res = await request.post(`/form`).expect(302);
  t.is(res.header.location, `/form`);

  res = await request.get(`/form`).redirects().expect(200);
  // since this shouldn't redirect there should be no redirects in res.redirects
  t.is(res.redirects.length, 0);

  res = await request.post(`/form`).expect(302);
  t.is(res.header.location, `/form`);
});

test('router does not endless redirect when thrown bad request with referrer', async (t) => {
  const referrer = `${t.context.url}error`;
  const res = await request.get('/error').set('Referrer', referrer).expect(400);
  t.is(res.redirects.length, 0);
});

test('router does not endless redirect when thrown bad request without referrer', async (t) => {
  const res = await request.get('/error').expect(400);
  t.is(res.redirects.length, 0);
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
  const res = await request.get(`/headers`);
  t.is(res.status, 404);
});

// works with flash messages (preserves them upon redirect and throw)
test('preserves flash messages on redirect', async (t) => {
  const res = await request.get('/redirect-start').redirects(1);
  t.log(res.body);
  t.deepEqual(res.body, { success: ['yay!'] });
});
test('preserves flash messages on throw', async (t) => {
  const res = await request.get('/throw-start');
  t.is(res.status, 500);
  const res2 = await request.get('/throw-start');
  t.is(res2.status, 500);
  const { body } = await request.get('/throw-end');
  t.deepEqual(body, { success: ['oops!'] });
});
