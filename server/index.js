'use strict';

const config = require('./config');
const { createApp } = require('./app');

async function main() {
  const app = await createApp();

  await new Promise(function (resolve, reject) {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
  });

  const address =
    'http://' +
    (config.host === '0.0.0.0' ? 'localhost' : config.host) +
    ':' +
    config.port;

  process.stdout.write(
    'Braganza Dental Clinic server running at ' + address + '\n'
  );

  let shuttingDown = false;

  const shutdown = function (signal) {
    if (shuttingDown) return;

    shuttingDown = true;

    process.stdout.write(
      '\nReceived ' + signal + ', shutting down.\n'
    );

    app.close().then(
      function () {
        process.exit(0);
      },
      function () {
        process.exit(1);
      }
    );
  };

  ['SIGINT', 'SIGTERM'].forEach(function (signal) {
    process.on(signal, function () {
      shutdown(signal);
    });
  });
}

main().catch(function (error) {
  process.stderr.write(
    'Failed to start server: ' +
    (error && error.stack ? error.stack : error) +
    '\n'
  );

  process.exit(1);
});