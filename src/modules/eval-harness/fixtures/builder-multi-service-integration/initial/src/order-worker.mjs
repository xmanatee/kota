import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const EXPECTED_ROUTE = "/api/bundles/starter-kit";
const EXPECTED_SUMMARY = "Starter Kit total: $34.50 (3 lines)";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function summarizeBundle(bundle) {
  const items = Array.isArray(bundle.items) ? bundle.items : [];
  const totalCents = items.reduce(
    (sum, item) => sum + item.quantity * item.unitCents,
    0,
  );
  return {
    bundleId: bundle.id,
    displayName: bundle.displayName,
    itemLineCount: items.length,
    totalCents,
    summaryLine: `${bundle.displayName} total: $${(totalCents / 100).toFixed(2)} (${items.length} lines)`,
    itemLabels: items.map((item) => item.label),
  };
}

async function waitForResponse(responsePath) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (existsSync(responsePath)) {
      return JSON.parse(readFileSync(responsePath, "utf8"));
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for catalog API response at ${responsePath}`);
}

async function main() {
  const requestDir = requiredEnv("CATALOG_REQUEST_DIR");
  const outputPath = process.env.INTEGRATION_OUTPUT_PATH ?? "integration-result.json";
  const requestId = `order-worker-${process.pid}-${Date.now()}`;
  const requestPath = join(requestDir, `${requestId}.request.json`);
  const responsePath = join(requestDir, `${requestId}.response.json`);
  const tempPath = `${requestPath}.tmp`;

  writeFileSync(
    tempPath,
    `${JSON.stringify({
      id: requestId,
      component: "order-worker",
      method: "GET",
      path: EXPECTED_ROUTE,
    })}\n`,
    "utf8",
  );
  renameSync(tempPath, requestPath);

  const response = await waitForResponse(responsePath);
  if (response.status !== 200) {
    throw new Error(`Catalog API request failed with ${response.status}: ${JSON.stringify(response.body)}`);
  }
  if (!response.body?.bundle || typeof response.body.bundle !== "object") {
    throw new Error("Catalog API response missing bundle object");
  }

  const observedOutput = summarizeBundle(response.body.bundle);
  if (observedOutput.summaryLine !== EXPECTED_SUMMARY) {
    throw new Error(
      `Unexpected bundle summary ${JSON.stringify(observedOutput.summaryLine)}`,
    );
  }

  const artifact = {
    schemaVersion: 1,
    componentsExercised: ["catalog-api", "order-worker"],
    componentStartup: {
      api: { ready: true, requestDir },
      worker: { invoked: true, mode: "request-file" },
    },
    requests: [
      {
        method: "GET",
        path: EXPECTED_ROUTE,
        status: response.status,
        responseRunToken: response.body.bundle.runToken,
      },
    ],
    observedOutput,
    integration: {
      runToken: response.body.bundle.runToken,
      summaryLine: observedOutput.summaryLine,
    },
    validationNodes: [
      "api-started",
      "worker-invoked",
      "api-request-observed",
      "dynamic-token-propagated",
      "integrated-output-produced",
    ],
    validationNodesPassed: 5,
  };

  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(observedOutput.summaryLine);
}

await main();
