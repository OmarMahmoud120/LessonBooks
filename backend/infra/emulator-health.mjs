import { connect } from 'node:net';
await Promise.all(
  [9099, 8080, 9199].map(
    (port) =>
      new Promise((resolve, reject) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.setTimeout(2000);
        socket.once('connect', () => {
          socket.destroy();
          resolve();
        });
        socket.once('error', reject);
        socket.once('timeout', () => {
          socket.destroy();
          reject(new Error('emulator_not_ready'));
        });
      }),
  ),
);
