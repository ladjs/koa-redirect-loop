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

test.beforeEach(t => {
  const app = new Koa();
  app.keys = ['some secret'];
  app.context.onerror = errorHandler;
  const router = new Router();
  app.use(session());
  app.use(cabin.middleware);
  app.use(redirectLoop.middleware);
  router.get('/', ctx => {
    ctx.status = 200;
  });
  router.get('/bar', ctx => ctx.redirect('/foo'));
  router.get('/foo', ctx => ctx.redirect('/foo'));
  router.get('/baz', ctx => ctx.redirect('/bar'));
  router.get('/beep', ctx => {
    ctx.status = 200;
  });
  router.get('/boop', ctx => ctx.redirect('/boop'));
  router.get('/1', ctx => ctx.redirect('/2')); // 1
  router.get('/2', ctx => ctx.redirect('/3')); // 2
  router.get('/3', ctx => ctx.redirect('/4')); // 3
  router.get('/4', ctx => ctx.redirect('/5')); // 4
  router.get('/5', ctx => ctx.redirect('/6')); // 5
  router.get('/6', ctx => ctx.redirect('/7')); // 6 <-- redirects to /
  router.get('/7', ctx => ctx.redirect('/8'));
  router.get('/form', ctx => {
    ctx.status = 200;
  });
  router.post('/form', ctx => ctx.redirect('/form'));
  app.use(router.routes());
  const server = app.listen();
  t.context.url = `http://localhost:${server.address().port}/`;
});

test('caps at max of 5 redirects', async t => {
  const res = await fetch(`${t.context.url}1`, {
    credentials: 'include'
  });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/beep => 200 => /boop => /beep', async t => {
  let res = await fetch(`${t.context.url}beep`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}beep`);
  res = await fetch(`${t.context.url}boop`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}beep`);
  t.pass();
});

test('/bar => /foo => /', async t => {
  const res = await fetch(`${t.context.url}bar`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/foo => /', async t => {
  const res = await fetch(`${t.context.url}foo`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('/baz => /bar => /foo => /', async t => {
  const res = await fetch(`${t.context.url}baz`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  t.pass();
});

test('prevents incorrect redirect to earlier path', async t => {
  // GET / -> GET /form -> POST /form -> GET /form
  let res = await fetch(t.context.url, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, t.context.url);
  res = await fetch(`${t.context.url}form`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual'
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);

  // GET /form -> POST /form -> GET /form -> POST /form
  res = await fetch(`${t.context.url}form`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual'
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, { credentials: 'include' });
  t.is(res.status, 200);
  t.is(res.url, `${t.context.url}form`);
  res = await fetch(`${t.context.url}form`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual'
  });
  t.is(res.status, 302);
  t.is(res.headers.get('location'), `${t.context.url}form`);

  t.pass();
});
