import { loadUser } from '../controller.js';

export function scan() {
  return loadUser('demo-user');
}
