'use strict';

function compile(pattern) {
  const segments = pattern.split('/').filter(function (part) { return part.length > 0; });
  return segments.map(function (segment) {
    if (segment.charAt(0) === ':') return { param: segment.slice(1) };
    return { literal: segment };
  });
}

class Router {
  constructor() {
    this.routes = [];
    this.guards = [];
  }

  use(guard) {
    this.guards.push(guard);
    return this;
  }

  register(method, pattern, handler, options) {
    this.routes.push({
      method: method.toUpperCase(),
      segments: compile(pattern),
      handler: handler,
      options: options || {}
    });
    return this;
  }

  get(pattern, handler, options) { return this.register('GET', pattern, handler, options); }
  post(pattern, handler, options) { return this.register('POST', pattern, handler, options); }
  put(pattern, handler, options) { return this.register('PUT', pattern, handler, options); }
  patch(pattern, handler, options) { return this.register('PATCH', pattern, handler, options); }
  delete(pattern, handler, options) { return this.register('DELETE', pattern, handler, options); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(function (part) { return part.length > 0; });
    let pathMatched = false;
    for (let i = 0; i < this.routes.length; i += 1) {
      const route = this.routes[i];
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let j = 0; j < route.segments.length; j += 1) {
        const segment = route.segments[j];
        if (segment.literal !== undefined) {
          if (segment.literal !== parts[j]) { ok = false; break; }
        } else {
          params[segment.param] = decodeURIComponent(parts[j]);
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method.toUpperCase()) return { route: route, params: params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

module.exports = Router;
