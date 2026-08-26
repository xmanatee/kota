import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getService } from "../src/catalog.mjs";
import { buildCheckoutSummary } from "../src/checkout.mjs";
import {
  scopeRoot,
  requiredChangedModules,
} from "./check-feature-slice-shared.mjs";

const featureModuleCandidates = [
  ...requiredChangedModules,
  "src/checkout.mjs",
];

function starterCart(overrides = {}) {
  return {
    items: [
      { sku: "notebook", quantity: 3 },
      { sku: "pen", quantity: 2 },
    ],
    ...overrides,
  };
}

function gitCapture(args) {
  const result = spawnSync("git", args, {
    cwd: scopeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error !== undefined) {
    return "";
  }
  return result.stdout;
}

function pathsFromPorcelain(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const pathPart = line.length > 3 ? line.slice(3) : "";
      if (pathPart.includes(" -> ")) {
        return pathPart.split(" -> ").filter(Boolean);
      }
      return pathPart ? [pathPart] : [];
    });
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function readModuleSource(modulePath) {
  return readFileSync(join(scopeRoot, modulePath), "utf8");
}

function containsStringLiteral(source, value) {
  return source.includes(value) || [
    JSON.stringify(value),
    `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
    `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``,
  ].some((literal) => source.includes(literal));
}

function containsNumberLiteral(source, value) {
  const escaped = String(value).replaceAll(".", "\\.");
  return new RegExp(`(^|[^\\w.])${escaped}([^\\w.]|$)`).test(source);
}

function sourceContainsRule(source, rule) {
  if (rule.kind === "number") {
    return containsNumberLiteral(source, rule.value);
  }
  return containsStringLiteral(source, rule.value);
}

function serviceRules(service) {
  const money = formatMoney(service.priceCents);
  return [
    {
      modulePath: "src/pricing.mjs",
      label: "catalog service sku",
      kind: "string",
      value: service.sku,
    },
    {
      modulePath: "src/pricing.mjs",
      label: "catalog service label",
      kind: "string",
      value: service.label,
    },
    {
      modulePath: "src/pricing.mjs",
      label: "catalog service price",
      kind: "number",
      value: service.priceCents,
    },
    {
      modulePath: "src/receipt-renderer.mjs",
      label: "catalog service label",
      kind: "string",
      value: service.label,
    },
    {
      modulePath: "src/receipt-renderer.mjs",
      label: "catalog service money",
      kind: "string",
      value: money,
    },
    {
      modulePath: "src/receipt-renderer.mjs",
      label: "catalog service price",
      kind: "number",
      value: service.priceCents,
    },
    {
      modulePath: "src/checkout.mjs",
      label: "catalog service sku",
      kind: "string",
      value: service.sku,
    },
  ];
}

export function findCatalogBypassShortcuts({
  catalogService = getService("gift-wrap"),
  moduleSources,
} = {}) {
  if (
    catalogService === null ||
    typeof catalogService !== "object" ||
    typeof catalogService.sku !== "string" ||
    typeof catalogService.label !== "string" ||
    typeof catalogService.priceCents !== "number"
  ) {
    return [
      {
        modulePath: "src/catalog.mjs",
        label: "missing catalog gift-wrap service",
      },
    ];
  }

  const sources =
    moduleSources ??
    Object.fromEntries(
      ["src/pricing.mjs", "src/receipt-renderer.mjs", "src/checkout.mjs"].map(
        (modulePath) => [modulePath, readModuleSource(modulePath)],
      ),
    );
  return serviceRules(catalogService).filter((rule) =>
    sourceContainsRule(sources[rule.modulePath] ?? "", rule),
  );
}

export function changedSourceModules() {
  const rootCommit = gitCapture(["rev-list", "--max-parents=0", "HEAD"])
    .trim()
    .split("\n")
    .find(Boolean);
  const changed = new Set();
  if (rootCommit !== undefined) {
    for (const path of gitCapture(["diff", "--name-only", `${rootCommit}..HEAD`])
      .split("\n")
      .filter(Boolean)) {
      changed.add(path);
    }
  }
  for (const path of pathsFromPorcelain(
    gitCapture(["status", "--porcelain=v1", "--untracked-files=all"]),
  )) {
    changed.add(path);
  }
  return featureModuleCandidates.filter((path) => changed.has(path));
}

export function observeFeatureCases() {
  const ada = buildCheckoutSummary(
    starterCart({ giftWrap: true, giftMessage: "For Ada" }),
  );
  const lin = buildCheckoutSummary({
    items: [{ sku: "planner", quantity: 1 }],
    giftWrap: true,
    giftMessage: "For Lin",
  });
  const catalogService = getService("gift-wrap");
  const catalogBacked = buildCheckoutSummary(
    starterCart({ giftWrap: true, giftMessage: "Catalog probe" }),
  );
  const catalogServiceLine = catalogBacked.serviceLines?.[0] ?? null;
  const catalogBypassShortcuts = findCatalogBypassShortcuts({
    catalogService,
  });
  return [
    {
      id: "gift-wrap-fee-and-receipt",
      passed:
        ada.totals.serviceCents === 499 &&
        ada.totals.totalCents === 4299 &&
        ada.receipt.includes("Gift wrap: $4.99") &&
        ada.receipt.includes("Gift message: For Ada"),
      observed: {
        serviceCents: ada.totals.serviceCents,
        totalCents: ada.totals.totalCents,
        receipt: ada.receipt,
      },
    },
    {
      id: "gift-wrap-fulfillment-metadata",
      passed:
        lin.totals.serviceCents === 499 &&
        lin.totals.totalCents === 3898 &&
        lin.fulfillment.serviceSkus.join(",") === "svc-gift-wrap" &&
        lin.fulfillment.giftWrap?.requested === true &&
        lin.fulfillment.giftWrap?.applied === true &&
        lin.fulfillment.giftWrap?.message === "For Lin",
      observed: {
        serviceCents: lin.totals.serviceCents,
        totalCents: lin.totals.totalCents,
        serviceSkus: lin.fulfillment.serviceSkus,
        giftWrap: lin.fulfillment.giftWrap,
      },
    },
    {
      id: "catalog-backed-service-contract",
      passed:
        catalogService !== null &&
        catalogService.sku === "svc-gift-wrap" &&
        catalogService.label === "Gift wrap" &&
        catalogService.priceCents === 499 &&
        catalogServiceLine?.sku === catalogService.sku &&
        catalogServiceLine?.label === catalogService.label &&
        catalogServiceLine?.priceCents === catalogService.priceCents &&
        catalogBacked.totals.serviceCents === catalogService.priceCents &&
        catalogBacked.fulfillment.serviceSkus.join(",") === catalogService.sku &&
        catalogBacked.receipt.includes(
          `${catalogService.label}: ${formatMoney(catalogService.priceCents)}`,
        ) &&
        catalogBypassShortcuts.length === 0,
      observed: {
        catalogService,
        serviceLine: catalogServiceLine,
        serviceCents: catalogBacked.totals.serviceCents,
        serviceSkus: catalogBacked.fulfillment.serviceSkus,
        receipt: catalogBacked.receipt,
        catalogBypassShortcuts,
      },
    },
  ];
}

export function observeRegressionCases() {
  const starter = buildCheckoutSummary(starterCart());
  const freeShipping = buildCheckoutSummary({
    items: [{ sku: "planner", quantity: 2 }],
  });
  return [
    {
      id: "bulk-discount-preserved",
      passed:
        starter.totals.merchandiseCents === 4100 &&
        starter.totals.discountCents === 300 &&
        starter.totals.totalCents === 3800,
      observed: starter.totals,
    },
    {
      id: "free-shipping-preserved",
      passed:
        freeShipping.totals.merchandiseCents === 5600 &&
        freeShipping.totals.shippingCents === 0 &&
        freeShipping.totals.totalCents === 5600,
      observed: freeShipping.totals,
    },
    {
      id: "receipt-format-preserved",
      passed:
        starter.receipt.includes("3 x Notebook: $36.00") &&
        starter.receipt.includes("Bulk discount: -$3.00") &&
        starter.receipt.includes("Shipping: FREE") &&
        starter.receipt.includes("Total: $38.00") &&
        !starter.receipt.includes("Gift wrap"),
      observed: {
        receipt: starter.receipt,
      },
    },
  ];
}
