import { getUser } from '../database/models/user.js';

export function loadUser(id) {
  return getUser(id);
}
