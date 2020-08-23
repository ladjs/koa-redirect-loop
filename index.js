const { callbackify } = require('util');

const Url = require('url-parse');
const isSANB = require('is-string-and-not-blank');

class RedirectLoop {
  constructor(config) {
    this.config = {
      defaultPath: '/',
      maxRedirects: 5,
      logger: console,
      ...config
    };
    if (!isSANB(this.config.defaultPath))
      throw new Error('defaultPath must be a String');
    if (
      typeof this.config.maxRedirects !== 'number' ||
      this.config.maxRedirects <= 0
    )
      throw new Error('maxRedirects must be a Number greater than zero');
    this.middleware = this.middleware.bind(this);
  }

  middleware(ctx, next) {
    if (!ctx.session) return ctx.throw(new Error('Sessions required'));
    if (typeof ctx.saveSession !== 'function')
      throw new Error(
        'Please use koa-generic-session v2.0.3+ which exposes a `ctx.saveSession()` method'
      );

    const { config } = this;
    const { redirect } = ctx;
    const { end } = ctx.res;

    ctx.res.end = function (chunk, encoding) {
      // instead of `!req.xhr` we need to use !accepts HTML
      // because Fetch does not provide XMLHttpRequest
      if (ctx.accepts('html')) {
        ctx.session.prevPrevPath = ctx.session.prevPath;
        ctx.session.prevPath = ctx.originalUrl;
        ctx.session.prevMethod = ctx.method;
        // if it was a redirect then store how many times
        // so that we can limit the max number of redirects
        if ([301, 302].includes(ctx.res.statusCode))
          ctx.session.maxRedirects =
            typeof ctx.session.maxRedirects === 'number'
              ? ctx.session.maxRedirects + 1
              : 1;
        else ctx.session.maxRedirects = 0;
      }

      callbackify(ctx.saveSession)((err) => {
        if (err) {
          if (ctx.logger && ctx.logger.error) ctx.logger.error(err);
          else config.logger.error(err);
        }

        end.call(ctx.res, chunk, encoding);
      });
    };

    ctx.redirect = function (url, alt) {
      let address = url;

      if (url === 'address') address = ctx.get('Referrer') || alt || '/';

      const previousPreviousPath =
        ctx.session.prevPrevPath || config.defaultPath;
      const previousPath = ctx.session.prevPath || config.defaultPath;
      const previousMethod = ctx.session.prevMethod || ctx.method;
      const maxRedirects = ctx.session.maxRedirects || 1;

      if (
        previousPath &&
        address === previousPath &&
        ctx.method === previousMethod
      ) {
        if (
          previousPreviousPath &&
          address !== previousPreviousPath &&
          maxRedirects <= config.maxRedirects
        ) {
          address = previousPreviousPath;
        } else {
          // if the prevPrevPath w/o querystring is !== prevPrevPath
          // then redirect then to prevPrevPath w/o querystring
          const { pathname } = new Url(previousPreviousPath, {});
          if (pathname === previousPreviousPath) address = '/';
          else address = pathname;
        }
      } else if (maxRedirects > config.maxRedirects) {
        address = config.defaultPath;
      }

      redirect.call(this, address, alt);
    };

    return next();
  }
}

module.exports = RedirectLoop;
