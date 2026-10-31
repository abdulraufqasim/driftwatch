import { getProject } from '../../database/models/project.js';

export function loadProject(id) {
  return getProject(id);
}
