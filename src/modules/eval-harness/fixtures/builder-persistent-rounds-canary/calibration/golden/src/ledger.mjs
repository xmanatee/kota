export function summarizeLedger(entries) {
  const statusTotals = {};
  const ownerTotals = {};
  for (const entry of entries) {
    statusTotals[entry.status] = (statusTotals[entry.status] ?? 0) + entry.amount;
    ownerTotals[entry.owner] = (ownerTotals[entry.owner] ?? 0) + entry.amount;
  }
  return {
    entryCount: entries.length,
    statusTotals,
    ownerTotals,
    currency: "USD",
  };
}

export function exportLedgerCsv(entries) {
  const summary = summarizeLedger(entries);
  const rows = ["status,total,count"];
  const counts = {};
  for (const entry of entries) {
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }
  for (const status of Object.keys(summary.statusTotals).sort()) {
    rows.push(`${status},${summary.statusTotals[status].toFixed(2)},${counts[status] ?? 0}`);
  }
  return `${rows.join("\n")}\n`;
}
