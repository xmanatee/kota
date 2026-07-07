#!/usr/bin/env node
import { existsSync, rmSync } from "node:fs";
import {
  changedSourceModules,
  findCatalogBypassShortcuts,
  observeFeatureCases,
  observeRegressionCases,
} from "./check-feature-slice-observations.mjs";
import {
  fail,
  requiredChangedModules,
  requiredFeatureCases,
  requiredRegressionCases,
  requirePassingRun,
  resultPath,
  runNodeTests,
  testFile,
  validateEvidence,
  writeEvidence,
} from "./check-feature-slice-shared.mjs";

function runBaselineOnly() {
  const regressions = runNodeTests("^regression:");
  requirePassingRun(regressions, "regression tests");
  console.log(
    JSON.stringify(
      {
        status: "ok",
        command: regressions.command,
        regressionCases: requiredRegressionCases.length,
      },
      null,
      2,
    ),
  );
}

function runMainCheck() {
  rmSync(resultPath, { force: true });
  const featureRun = runNodeTests("^feature:");
  requirePassingRun(featureRun, "feature tests");
  const regressionRun = runNodeTests("^regression:");
  requirePassingRun(regressionRun, "regression tests");

  const featureCases = observeFeatureCases();
  const regressionCases = observeRegressionCases();
  const failedFeature = featureCases.filter((entry) => !entry.passed);
  const failedRegression = regressionCases.filter((entry) => !entry.passed);
  if (failedFeature.length > 0 || failedRegression.length > 0) {
    fail(
      `observed behavior did not match expectations: feature=${failedFeature
        .map((entry) => entry.id)
        .join(",")}; regression=${failedRegression.map((entry) => entry.id).join(",")}`,
    );
  }

  const filesOrModulesInvolved = changedSourceModules();
  const missingModules = requiredChangedModules.filter(
    (modulePath) => !filesOrModulesInvolved.includes(modulePath),
  );
  if (missingModules.length > 0) {
    fail(
      `feature slice must change catalog, pricing, and receipt modules; missing ${missingModules.join(", ")}`,
    );
  }

  const evidence = {
    schemaVersion: 1,
    status: "passed",
    featureBehavior: {
      id: "gift-wrap-checkout-slice",
      cases: featureCases,
    },
    regressionBehaviors: regressionCases,
    commandsRun: [featureRun.command, regressionRun.command],
    filesOrModulesInvolved,
    metrics: {
      featureCasesPassed: featureCases.length,
      regressionCasesPassed: regressionCases.length,
      touchedModuleCoverage: requiredChangedModules.length,
    },
  };
  validateEvidence(evidence);
  writeEvidence(evidence);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        featureCases: featureCases.length,
        regressionCases: regressionCases.length,
        evidence: "feature-slice-result.json",
        touchedModuleCoverage: requiredChangedModules.length,
      },
      null,
      2,
    ),
  );
}

function goodEvidence() {
  return {
    schemaVersion: 1,
    status: "passed",
    featureBehavior: {
      id: "gift-wrap-checkout-slice",
      cases: requiredFeatureCases.map((id) => ({ id, passed: true })),
    },
    regressionBehaviors: requiredRegressionCases.map((id) => ({
      id,
      passed: true,
    })),
    commandsRun: [
      `node --test --test-name-pattern ^feature: ${testFile}`,
      `node --test --test-name-pattern ^regression: ${testFile}`,
    ],
    filesOrModulesInvolved: [...requiredChangedModules],
    metrics: {
      featureCasesPassed: requiredFeatureCases.length,
      regressionCasesPassed: requiredRegressionCases.length,
      touchedModuleCoverage: requiredChangedModules.length,
    },
  };
}

function expectShortcutFailure(name, evidence, expectedMessage) {
  try {
    validateEvidence(evidence);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      fail(
        `${name} failed for the wrong reason. Expected ${JSON.stringify(expectedMessage)} in ${JSON.stringify(message)}`,
      );
    }
    return;
  }
  fail(`${name} shortcut unexpectedly passed`);
}

function expectCatalogBypassShortcutFailure() {
  const shortcuts = findCatalogBypassShortcuts({
    catalogService: {
      sku: "svc-gift-wrap",
      label: "Gift wrap",
      priceCents: 499,
    },
    moduleSources: {
      "src/pricing.mjs": `
        export function priceCart(cart) {
          return {
            serviceLines: cart.giftWrap
              ? [{ sku: "svc-gift-wrap", label: "Gift wrap", priceCents: 499 }]
              : [],
          };
        }
      `,
      "src/receipt-renderer.mjs": `
        export function renderReceipt() {
          return "Gift wrap: $4.99";
        }
      `,
      "src/checkout.mjs": `
        export function buildCheckoutSummary() {
          return { fulfillment: { serviceSkus: ["svc-gift-wrap"] } };
        }
      `,
    },
  });
  const modules = new Set(shortcuts.map((shortcut) => shortcut.modulePath));
  for (const modulePath of [
    "src/pricing.mjs",
    "src/receipt-renderer.mjs",
    "src/checkout.mjs",
  ]) {
    if (!modules.has(modulePath)) {
      fail(`catalog-bypass-hardcoded-output did not flag ${modulePath}`);
    }
  }
}

function runShortcutSelfTest() {
  expectShortcutFailure(
    "hardcoded-single-feature-case",
    {
      ...goodEvidence(),
      featureBehavior: {
        id: "gift-wrap-checkout-slice",
        cases: [{ id: requiredFeatureCases[0], passed: true }],
      },
    },
    "missing case id",
  );
  expectShortcutFailure(
    "skipped-regression-evidence",
    {
      ...goodEvidence(),
      regressionBehaviors: [],
      metrics: {
        ...goodEvidence().metrics,
        regressionCasesPassed: 0,
      },
    },
    "missing case id",
  );
  expectShortcutFailure(
    "single-module-shortcut",
    {
      ...goodEvidence(),
      filesOrModulesInvolved: ["src/pricing.mjs"],
      metrics: {
        ...goodEvidence().metrics,
        touchedModuleCoverage: 1,
      },
    },
    "missing required module",
  );
  expectCatalogBypassShortcutFailure();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        shortcutGuards: [
          "hardcoded-single-feature-case",
          "skipped-regression-evidence",
          "single-module-shortcut",
          "catalog-bypass-hardcoded-output",
        ],
      },
      null,
      2,
    ),
  );
}

const args = process.argv.slice(2);
try {
  if (args.includes("--self-test-shortcuts")) {
    runShortcutSelfTest();
  } else if (args.includes("--baseline-only")) {
    runBaselineOnly();
  } else {
    runMainCheck();
  }
} catch (error) {
  if (existsSync(resultPath)) rmSync(resultPath, { force: true });
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
