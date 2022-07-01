# koa-redirect-loop

[![build status](https://github.com/ladjs/koa-redirect-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/ladjs/koa-redirect-loop/actions/workflows/ci.yml)
[![code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![made with lass](https://img.shields.io/badge/made_with-lass-95CC28.svg)](https://lass.js.org)
[![license](https://img.shields.io/github/license/ladjs/koa-redirect-loop.svg)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/koa-redirect-loop.svg)](https://npm.im/koa-redirect-loop)

> Prevent redirect loops with sessions since HTTP referrer header is unreliable and ensures sessions are saved upon redirect

> Note that this package only supports `koa-generic-session`, since other packages do not expose a save method used in `res.end` override.


## Table of Contents

* [Install](#install)
* [Usage](#usage)
* [Options](#options)
* [Contributors](#contributors)
* [License](#license)


## Install

[npm][]:

```sh
npm install koa-redirect-loop
```


## Usage

```js
const Koa = require('koa');
const session = require('koa-generic-session');
const RedirectLoop = require('koa-redirect-loop');

const redirectLoop = new RedirectLoop({
  defaultPath: '/',
  maxRedirects: 5,
  logger: console
});

const app = new Koa();
app.keys = [ 'secret' ];

app.use(session());
app.use(redirectLoop.middleware);
```


## Options

* `defaultPath` (String) - path to fallback to, defaults to `'/'`
* `maxRedirects` (Number) - maximum number of redirects to allow, defaults to `5`
* `console` (Object) - a logger instance, defaults to `console`


## Contributors

| Name           | Website                    |
| -------------- | -------------------------- |
| **Nick Baugh** | <http://niftylettuce.com/> |


## License

[MIT](LICENSE) © [Nick Baugh](http://niftylettuce.com/)


##

[npm]: https://www.npmjs.com/
