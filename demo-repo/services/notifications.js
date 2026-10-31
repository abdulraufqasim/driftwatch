import { renderScore } from '../frontend/components/score.js';

export function scoreNotification(score) {
  return `Architecture score: ${renderScore(score)}`;
}
