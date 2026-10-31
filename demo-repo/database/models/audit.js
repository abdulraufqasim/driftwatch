import { health } from '../../backend/routes/health.js';

export function recordHealthCheck() {
  return health();
}
