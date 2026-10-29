import { getUser } from '../database/models/user.js';
import { renderChart } from './components/chart.js';

export function start() {
  renderChart(getUser());
}
