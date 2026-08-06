import {
  AppBootstrap
} from './core/app-bootstrap.js';

export function createApp(root) {
  const app = new AppBootstrap(root);

  return app.start();
}
