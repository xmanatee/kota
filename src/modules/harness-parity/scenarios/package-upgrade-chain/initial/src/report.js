const { formatMoney, summarize } = require("../packages/ledger-kit");

function renderQuarterReport(entries) {
  const lines = entries.map((entry) => ({
    label: entry.account,
    cents: entry.amountCents,
  }));
  const total = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  return `${summarize(lines)}\nTotal: ${formatMoney(total)}`;
}

module.exports = { renderQuarterReport };
