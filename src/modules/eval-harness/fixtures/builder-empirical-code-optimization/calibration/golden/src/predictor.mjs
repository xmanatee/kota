export function predict(row) {
  return 7.5 + 1.7 * row.x - 0.9 * row.y;
}
