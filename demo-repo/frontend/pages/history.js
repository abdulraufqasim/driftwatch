import { renderScore } from '../components/score.js';

export function renderHistory(scores) {
  return scores.map(renderScore);
}
