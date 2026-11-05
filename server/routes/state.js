'use strict';

const { sendJson } = require('../http/helpers');

function register(router, app) {
  router.get('/api/state', async function (ctx) {
    sendJson(ctx.res, 200, {
      state: await app.state.read(ctx.user.role),
      serverTime: new Date().toISOString()
    });
  });

  async function replace(ctx) {
    const payload = ctx.body && ctx.body.state !== undefined ? ctx.body.state : ctx.body;
    const state = await app.state.replace(payload, ctx.user.id, ctx.user.role);
    sendJson(ctx.res, 200, { state: state, serverTime: new Date().toISOString() });
  }

  router.put('/api/state', replace);
  router.post('/api/state', replace);
}

module.exports = { register: register };
