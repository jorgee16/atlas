import {
  AppBootstrap
} from './core/app-bootstrap.js';

export async function createApp(root) {
  const app = new AppBootstrap(root);

  await app.start();

  return app;
}
