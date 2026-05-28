#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const requestedRound = process.argv.includes("--round=2") ? 2 : 1;
const failures = [];
const canaries = [];

function record(id, passed, detail) {
  canaries.push({ id, passed, detail });
  if (!passed) failures.push(`${id}: ${detail}`);
}

function currency(value) {
  return Number(value).toFixed(2);
}

let moduleExports;
try {
  moduleExports = await import(pathToFileURL(join(process.cwd(), "src/ledger.mjs")).href);
} catch (err) {
  record("ledger-module-loads", false, err instanceof Error ? err.message : String(err));
}

if (moduleExports !== undefined) {
  const entries = [
    { id: "L-100", status: "approved", amount: 80.25, owner: "north" },
    { id: "L-101", status: "pending", amount: 42, owner: "south" },
    { id: "L-102", status: "approved", amount: 45.25, owner: "north" }
  ];
  const summarizeLedger = moduleExports.summarizeLedger;
  if (typeof summarizeLedger !== "function") {
    record("summary-exported", false, "summarizeLedger must be exported");
  } else {
    try {
      const summary = summarizeLedger(entries);
      record("summary-entry-count", summary?.entryCount === 3, "entryCount should be 3");
      record(
        "summary-status-totals",
        summary?.statusTotals?.approved === 125.5 && summary?.statusTotals?.pending === 42,
        "approved and pending totals should be grouped by status"
      );
      record(
        "summary-owner-totals",
        summary?.ownerTotals?.north === 125.5 && summary?.ownerTotals?.south === 42,
        "owner totals should remain data-driven"
      );
      record("summary-currency", summary?.currency === "USD", "currency should be USD");
    } catch (err) {
      record("summary-runtime", false, err instanceof Error ? err.message : String(err));
    }
  }

  if (requestedRound >= 2) {
    const exportLedgerCsv = moduleExports.exportLedgerCsv;
    if (typeof exportLedgerCsv !== "function") {
      record("csv-exported", false, "exportLedgerCsv must be exported");
    } else {
      try {
        const csv = exportLedgerCsv(entries);
        const expectedRows = [
          "status,total,count",
          `approved,${currency(125.5)},2`,
          `pending,${currency(42)},1`
        ];
        record(
          "csv-summary",
          expectedRows.every((row) => csv.includes(row)),
          "CSV should include status totals and counts"
        );
      } catch (err) {
        record("csv-runtime", false, err instanceof Error ? err.message : String(err));
      }
    }
  }
}

const passed = failures.length === 0;
writeFileSync(
  "ledger-result.json",
  JSON.stringify(
    {
      requestedRound,
      canaryScore: passed ? 1 : 0,
      canaries
    },
    null,
    2
  )
);

if (!passed) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`ledger canary round ${requestedRound} passed`);
