const assert = require("node:assert/strict");
const { renderQuarterReport } = require("./src/report");

const report = renderQuarterReport([
  { account: "Hosting", minorUnits: 1234, currency: "USD" },
  { account: "Support", minorUnits: 566, currency: "USD" },
]);

assert.equal(
  report,
  ["Hosting: USD 12.34", "Support: USD 5.66", "Total: USD 18.00"].join("\n"),
);

console.log("ok");
