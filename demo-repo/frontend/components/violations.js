export function renderViolation(violation) {
  return `${violation.ruleId}: ${violation.message}`;
}
