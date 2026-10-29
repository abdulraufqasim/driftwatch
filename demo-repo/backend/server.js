import { loadUser } from './controller.js';

export function startServer() {
  return loadUser('demo-user');
}
