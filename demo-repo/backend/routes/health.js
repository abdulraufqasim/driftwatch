import { loadUser } from '../controller.js';

export function health() {
  return { ok: true, user: loadUser('demo-user') };
}
