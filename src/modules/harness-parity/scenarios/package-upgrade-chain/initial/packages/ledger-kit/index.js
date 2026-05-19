function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function summarize(lines) {
  return lines.map((line) => `${line.label}: ${formatMoney(line.cents)}`).join("\n");
}

module.exports = { formatMoney, summarize };
