const assert = require("node:assert/strict");
const { renderQuarterReport } = require("./src/report");

const positiveReport = renderQuarterReport([
  { account: "Hosting", minorUnits: 1234, currency: "USD" },
  { account: "Support", minorUnits: 566, currency: "USD" },
]);

assert.equal(
  positiveReport,
  ["Hosting: USD 12.34", "Support: USD 5.66", "Total: USD 18.00"].join("\n"),
);

const adjustmentReport = renderQuarterReport([
  {
    account: "Refund",
    minorUnits: -150,
    currency: "USD",
    note: "customer credit",
  },
  { account: "Fee", minorUnits: 25, currency: "USD" },
]);

assert.equal(
  adjustmentReport,
  [
    "Refund (customer credit): (USD 1.50)",
    "Fee: USD 0.25",
    "Total: (USD 1.25)",
  ].join("\n"),
);

console.log("ok");
