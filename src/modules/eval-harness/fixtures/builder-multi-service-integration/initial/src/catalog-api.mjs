import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { STARTER_BUNDLE_ROUTE } from "./catalog-routes.mjs";

const STARTER_BUNDLE = {
  id: "starter-kit",
  displayName: "Starter Kit",
  items: [
    { sku: "api-plan", label: "API plan", quantity: 1, unitCents: 1250 },
    { sku: "onboarding", label: "Onboarding", quantity: 2, unitCents: 650 },
    { sku: "usage-credit", label: "Usage credit", quantity: 3, unitCents: 300 },
  ],
};

function appendRequestLog(entry) {
  const logPath = process.env.CATALOG_API_LOG;
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function responseFor(request) {
  if (request.method === "GET" && request.path === STARTER_BUNDLE_ROUTE) {
    return {
      status: 200,
      body: {
        bundle: {
          ...STARTER_BUNDLE,
          runToken: process.env.CATALOG_RUN_TOKEN ?? "missing-token",
        },
      },
    };
  }
  return {
    status: 404,
    body: { error: "not found", path: request.path },
  };
}

function handleRequestFile(requestDir, fileName) {
  const requestPath = join(requestDir, fileName);
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const response = responseFor(request);
  writeFileSync(
    join(requestDir, `${request.id}.response.json`),
    `${JSON.stringify(response, null, 2)}\n`,
    "utf8",
  );
  rmSync(requestPath, { force: true });
  appendRequestLog({
    at: new Date().toISOString(),
    method: request.method,
    path: request.path,
    status: response.status,
    responseKeys: Object.keys(response.body),
  });
}

export function startCatalogService(requestDir) {
  mkdirSync(requestDir, { recursive: true });
  const interval = setInterval(() => {
    for (const fileName of readdirSync(requestDir)) {
      if (!fileName.endsWith(".request.json")) continue;
      handleRequestFile(requestDir, fileName);
    }
  }, 25);
  return {
    close() {
      clearInterval(interval);
    },
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function startService() {
  const requestDir = requiredEnv("CATALOG_REQUEST_DIR");
  const service = startCatalogService(requestDir);
  console.log(
    `CATALOG_API_READY ${JSON.stringify({
      requestDir,
      route: STARTER_BUNDLE_ROUTE,
    })}`,
  );

  process.on("SIGTERM", () => {
    service.close();
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startService();
}
