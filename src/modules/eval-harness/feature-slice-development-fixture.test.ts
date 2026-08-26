import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import { copyFixtureInitialState } from "./runner-materialize.js";

const FIXTURE_ID = "builder-feature-slice-development";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

function run(
  command: string,
  args: string[],
  cwd: string,
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function expectRunOk(command: string, args: string[], cwd: string): void {
  const result = run(command, args, cwd);
  expect(
    result.status,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0);
}

function materializeFixture(): {
  fixtureDir: string;
  workingDir: string;
  cleanup: () => void;
} {
  const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
  const workingDir = mkdtempSync(join(tmpdir(), "kota-feature-slice-fixture-"));
  copyFixtureInitialState(fixture.initialStateDir, workingDir);
  return {
    fixtureDir: fixture.fixtureDir,
    workingDir,
    cleanup: () => rmSync(workingDir, { recursive: true, force: true }),
  };
}

function initializeGitBaseline(workingDir: string): void {
  expectRunOk("git", ["init", "-q"], workingDir);
  expectRunOk(
    "git",
    ["config", "user.email", "kota@example.invalid"],
    workingDir,
  );
  expectRunOk("git", ["config", "user.name", "KOTA"], workingDir);
  expectRunOk("git", ["add", "-A"], workingDir);
  expectRunOk("git", ["commit", "-qm", "initial"], workingDir);
}

function copyGoldenImplementation(fixtureDir: string, workingDir: string): void {
  for (const file of ["catalog.mjs", "pricing.mjs", "receipt-renderer.mjs"]) {
    cpSync(
      join(fixtureDir, "calibration", "golden", "src", file),
      join(workingDir, "src", file),
    );
  }
}

function runFeatureSliceCheck(workingDir: string, args: string[] = []) {
  return run(
    process.execPath,
    ["scripts/check-feature-slice.mjs", ...args],
    workingDir,
  );
}

function writeHardcodedCatalogBypass(workingDir: string): void {
  appendFileSync(
    join(workingDir, "src/catalog.mjs"),
    "\n// no-op catalog touch\n",
  );
  writeFileSync(
    join(workingDir, "src/pricing.mjs"),
    `import { getProduct } from "./catalog.mjs";

function notebookQuantity(items) {
  return items
    .filter((item) => item.sku === "notebook")
    .reduce((sum, item) => sum + item.quantity, 0);
}

export function priceCart(cart) {
  const items = cart.items.map((item) => {
    const product = getProduct(item.sku);
    return {
      sku: product.sku,
      label: product.label,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
      subtotalCents: product.priceCents * item.quantity,
    };
  });
  const merchandiseCents = items.reduce(
    (sum, item) => sum + item.subtotalCents,
    0,
  );
  const discountCents = notebookQuantity(items) >= 3 ? 300 : 0;
  const serviceLines =
    cart.giftWrap === true
      ? [
          {
            sku: "svc-gift-wrap",
            label: "Gift wrap",
            priceCents: 499,
            message: cart.giftMessage ?? null,
          },
        ]
      : [];
  const serviceCents = serviceLines.reduce(
    (sum, service) => sum + service.priceCents,
    0,
  );
  const shippingCents = merchandiseCents >= 4000 ? 0 : 599;
  return {
    items,
    serviceLines,
    giftWrap: {
      requested: cart.giftWrap === true,
      applied: cart.giftWrap === true,
      message: cart.giftMessage ?? null,
    },
    totals: {
      merchandiseCents,
      discountCents,
      serviceCents,
      shippingCents,
      totalCents: merchandiseCents - discountCents + serviceCents + shippingCents,
    },
  };
}
`,
  );
  writeFileSync(
    join(workingDir, "src/receipt-renderer.mjs"),
    `export function formatMoney(cents) {
  return \`$\${(cents / 100).toFixed(2)}\`;
}

export function renderReceipt(pricedCart) {
  const lines = pricedCart.items.map(
    (item) =>
      \`\${item.quantity} x \${item.label}: \${formatMoney(item.subtotalCents)}\`,
  );
  if (pricedCart.totals.discountCents > 0) {
    lines.push(\`Bulk discount: -\${formatMoney(pricedCart.totals.discountCents)}\`);
  }
  for (const service of pricedCart.serviceLines) {
    lines.push(\`\${service.label}: \${formatMoney(service.priceCents)}\`);
    if (service.message) {
      lines.push(\`Gift message: \${service.message}\`);
    }
  }
  lines.push(
    pricedCart.totals.shippingCents === 0
      ? "Shipping: FREE"
      : \`Shipping: \${formatMoney(pricedCart.totals.shippingCents)}\`,
  );
  lines.push(\`Total: \${formatMoney(pricedCart.totals.totalCents)}\`);
  return lines.join("\\n");
}
`,
  );
}

describe("builder feature-slice development fixture", () => {
  it("accepts the calibrated cross-module feature implementation", () => {
    const { fixtureDir, workingDir, cleanup } = materializeFixture();
    try {
      initializeGitBaseline(workingDir);
      copyGoldenImplementation(fixtureDir, workingDir);

      const result = runFeatureSliceCheck(workingDir);
      expect(
        result.status,
        `feature-slice check failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toBe(0);
      const evidence = JSON.parse(
        readFileSync(join(workingDir, "feature-slice-result.json"), "utf8"),
      );
      expect(
        evidence.featureBehavior.cases.map(
          (entry: { id: string }) => entry.id,
        ),
      ).toContain("catalog-backed-service-contract");
    } finally {
      cleanup();
    }
  });

  it("keeps the shortcut self-test aligned with catalog-bypass guards", () => {
    const { workingDir, cleanup } = materializeFixture();
    try {
      const result = runFeatureSliceCheck(workingDir, ["--self-test-shortcuts"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("catalog-bypass-hardcoded-output");
    } finally {
      cleanup();
    }
  });

  it("rejects hardcoded output with a no-op catalog edit", () => {
    const { workingDir, cleanup } = materializeFixture();
    try {
      initializeGitBaseline(workingDir);
      writeHardcodedCatalogBypass(workingDir);

      const result = runFeatureSliceCheck(workingDir);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("catalog-backed-service-contract");
    } finally {
      cleanup();
    }
  });
});
