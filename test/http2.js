const fs = require('fs');
const path = require('path');
const http2 = require('http2');
const crypto = require('crypto');
const Cabin = require('cabin');
const Koa = require('koa');
const Router = require('@koa/router');
const errorHandler = require('koa-better-error-handler');
const session = require('koa-generic-session');
const compress = require('koa-compress');
const supertest = require('supertest');
const test = require('ava');

const RedirectLoop = require('..');

const redirectLoop = new RedirectLoop();
const cookiesKey = 'lad.sid';

const ca = fs.readFileSync(path.join(__dirname, '/fixtures/ca.cert.pem'));
const key = fs.readFileSync(path.join(__dirname, '/fixtures/key.pem'));
const cert = fs.readFileSync(path.join(__dirname, '/fixtures/cert.pem'));

/*

openssl genrsa -out ca.key.pem 2048
openssl req -x509 -new -nodes -key ca.key.pem -sha256 -days 5000 -out ca.cert.pem # specify CN = CA

openssl genrsa -out key.pem 2048
openssl req -new -key key.pem -out cert.csr # specify CN = localhost

openssl x509 -req -in cert.csr -CA ca.cert.pem -CAkey ca.key.pem -CAcreateserial -out cert.pem -days 5000 -sha256
openssl pkcs12 -export -in cert.pem -inkey key.pem -out cert.pfx # empty password

openssl pkcs12 -export -in cert.pem -inkey key.pem -out passcert.pfx # password test

 */

let request;

test.beforeEach((t) => {
  t.context.logger = {
    error(err) {
      console.log(err.code);
    },
    info(msg) {
      console.info(msg);
    },
    debug(msg) {
      console.debug(msg);
    },
    trace(msg) {
      console.trace(msg);
    },
    warn(msg) {
      console.warn(msg);
    }
  };
  const cabin = new Cabin({
    axe: {
      logger: t.context.logger
    }
  });

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
  app.use(compress());
  app.use(redirectLoop.middleware);
  router.get('/', async (ctx) => {
    ctx.body = await crypto.randomBytes(2048).toString('base64');
  });
  app.use(router.routes());

  t.context.server = http2
    .createSecureServer(
      {
        key,
        cert
      },
      app.callback()
    )
    .listen();

  t.context.url = `https://localhost:${t.context.server.address().port}`;
  request = supertest(t.context.url);
});

test('does not throw ERR_HTTP2_HEADERS_SENT', async (t) => {
  t.context.logger.error = (err) => {
    console.log(err.code);
    t.not(err.code, 'ERR_HTTP2_HEADERS_SENT');
  };

  const res = await request
    .get('/')
    .http2()
    .ca(ca)
    .connect({
      '*': { host: 'localhost', port: t.context.server.address().port }
    });
  t.is(res.status, 200);
});
