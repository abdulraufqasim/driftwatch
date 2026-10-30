import { renderChart } from '../components/chart.js';
import { formatScore } from '../../shared/utils/format.js';

export function renderDashboard(score) {
  return { score: formatScore(score), chart: renderChart([score]) };
}
