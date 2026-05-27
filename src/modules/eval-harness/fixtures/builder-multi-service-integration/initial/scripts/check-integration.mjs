import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resultPath = join(projectRoot, "integration-result.json");
const requestLogPath = join(projectRoot, ".kota", "integration", "catalog-requests.jsonl");
const requestDirPath = join(projectRoot, ".kota", "integration", "requests");
const expectedRoute = "/api/bundles/starter-kit";
const expectedSummary = "Starter Kit total: $34.50 (3 lines)";
const expectedNodes = [
  "api-started",
  "worker-invoked",
  "api-request-observed",
  "dynamic-token-propagated",
  "integrated-output-produced",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readRequestLog(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function validateEvidence({ artifact, requestLog, expectedToken }) {
  const issues = [];
  if (!isRecord(artifact)) {
    throw new Error("integration artifact must be a JSON object");
  }

  const components = Array.isArray(artifact.componentsExercised)
    ? artifact.componentsExercised
    : [];
  for (const component of ["catalog-api", "order-worker"]) {
    if (!components.includes(component)) {
      issues.push(`component ${component} was not recorded as exercised`);
    }
  }

  const startup = isRecord(artifact.componentStartup)
    ? artifact.componentStartup
    : {};
  const apiStartup = isRecord(startup.api) ? startup.api : {};
  const workerStartup = isRecord(startup.worker) ? startup.worker : {};
  if (apiStartup.ready !== true) issues.push("catalog-api startup was not recorded");
  if (workerStartup.invoked !== true) issues.push("order-worker invocation was not recorded");

  const observedApiRequest = requestLog.find(
    (entry) =>
      isRecord(entry) &&
      entry.method === "GET" &&
      entry.path === expectedRoute &&
      entry.status === 200,
  );
  if (!observedApiRequest) {
    issues.push(`No catalog-api request log entry recorded GET ${expectedRoute} with status 200`);
  }

  const artifactRequests = Array.isArray(artifact.requests) ? artifact.requests : [];
  const artifactRequest = artifactRequests.find(
    (entry) =>
      isRecord(entry) &&
      entry.method === "GET" &&
      entry.path === expectedRoute &&
      entry.status === 200,
  );
  if (!artifactRequest) {
    issues.push(`integration artifact did not record GET ${expectedRoute} with status 200`);
  } else if (artifactRequest.responseRunToken !== expectedToken) {
    issues.push("integration artifact request did not propagate the dynamic API token");
  }

  const observed = isRecord(artifact.observedOutput) ? artifact.observedOutput : {};
  if (observed.bundleId !== "starter-kit") {
    issues.push("observed output did not name the starter-kit bundle");
  }
  if (observed.itemLineCount !== 3) {
    issues.push("observed output did not include the three catalog item lines");
  }
  if (observed.totalCents !== 3450) {
    issues.push("observed output did not compute the integrated catalog total");
  }
  if (observed.summaryLine !== expectedSummary) {
    issues.push(`observed summary line did not match ${JSON.stringify(expectedSummary)}`);
  }

  const integration = isRecord(artifact.integration) ? artifact.integration : {};
  if (integration.runToken !== expectedToken) {
    issues.push("integration metadata did not preserve the dynamic API token");
  }

  const nodes = Array.isArray(artifact.validationNodes) ? artifact.validationNodes : [];
  for (const node of expectedNodes) {
    if (!nodes.includes(node)) {
      issues.push(`validation node ${node} was not recorded`);
    }
  }
  if (artifact.validationNodesPassed !== expectedNodes.length) {
    issues.push(`validationNodesPassed must be ${expectedNodes.length}`);
  }

  if (issues.length > 0) {
    throw new Error(`integration evidence invalid:\n- ${issues.join("\n- ")}`);
  }

  return {
    validationNodesPassed: expectedNodes.length,
    requestCount: requestLog.length,
  };
}

function goodArtifact(token) {
  return {
    schemaVersion: 1,
    componentsExercised: ["catalog-api", "order-worker"],
    componentStartup: {
      api: { ready: true, requestDir: "/tmp/kota-eval-requests" },
      worker: { invoked: true, mode: "request-file" },
    },
    requests: [
      {
        method: "GET",
        path: expectedRoute,
        status: 200,
        responseRunToken: token,
      },
    ],
    observedOutput: {
      bundleId: "starter-kit",
      displayName: "Starter Kit",
      itemLineCount: 3,
      totalCents: 3450,
      summaryLine: expectedSummary,
      itemLabels: ["API plan", "Onboarding", "Usage credit"],
    },
    integration: {
      runToken: token,
      summaryLine: expectedSummary,
    },
    validationNodes: expectedNodes,
    validationNodesPassed: expectedNodes.length,
  };
}

function goodRequestLog() {
  return [
    {
      at: "2026-05-27T00:00:00.000Z",
      method: "GET",
      path: expectedRoute,
      status: 200,
      responseKeys: ["bundle"],
    },
  ];
}

function expectInvalidShortcut(name, args, expectedMessage) {
  try {
    validateEvidence(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(
        `${name} failed for the wrong reason. Expected ${JSON.stringify(expectedMessage)} in ${JSON.stringify(message)}`,
      );
    }
    return;
  }
  throw new Error(`${name} unexpectedly passed integration evidence validation`);
}

function runShortcutSelfTest() {
  const token = "shortcut-self-test-token";
  expectInvalidShortcut(
    "hardcoded artifact shortcut",
    {
      artifact: {
        ...goodArtifact("hardcoded-token"),
        integration: { runToken: "hardcoded-token", summaryLine: expectedSummary },
      },
      requestLog: goodRequestLog(),
      expectedToken: token,
    },
    "dynamic API token",
  );
  expectInvalidShortcut(
    "bypassed API shortcut",
    {
      artifact: goodArtifact(token),
      requestLog: [],
      expectedToken: token,
    },
    "No catalog-api request log entry",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        shortcutGuards: ["hardcoded-artifact", "bypassed-api"],
      },
      null,
      2,
    ),
  );
}

function collectChild(child) {
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString();
  });
  return output;
}

function waitForApiReady(child, output) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(
        new Error(
          `catalog API did not report readiness\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
        ),
      );
    }, 5000);

    function tryParseReady() {
      for (const line of output.stdout.split("\n")) {
        if (!line.startsWith("CATALOG_API_READY ")) continue;
        try {
          const payload = JSON.parse(line.slice("CATALOG_API_READY ".length));
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolveReady(payload);
          }
          return;
        } catch (error) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            rejectReady(error);
          }
        }
      }
    }

    child.stdout?.on("data", tryParseReady);
    tryParseReady();
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectReady(
        new Error(
          `catalog API exited before readiness (code=${code}, signal=${signal})\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
        ),
      );
    });
  });
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    child.once("exit", (code, signal) => {
      resolveExit({ code, signal });
    });
  });
}

async function runIntegration() {
  rmSync(resultPath, { force: true });
  mkdirSync(dirname(requestLogPath), { recursive: true });
  rmSync(requestLogPath, { force: true });
  rmSync(requestDirPath, { recursive: true, force: true });
  mkdirSync(requestDirPath, { recursive: true });

  const runToken = `catalog-${randomUUID()}`;
  const api = spawn(process.execPath, ["src/catalog-api.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CATALOG_REQUEST_DIR: requestDirPath,
      CATALOG_API_LOG: requestLogPath,
      CATALOG_RUN_TOKEN: runToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const apiOutput = collectChild(api);

  try {
    const ready = await waitForApiReady(api, apiOutput);
    if (!isRecord(ready) || ready.requestDir !== requestDirPath) {
      throw new Error(`catalog API readiness payload missing requestDir: ${JSON.stringify(ready)}`);
    }

    const workerEnv = {
      ...process.env,
      CATALOG_REQUEST_DIR: requestDirPath,
      INTEGRATION_OUTPUT_PATH: resultPath,
    };
    delete workerEnv.CATALOG_API_LOG;
    delete workerEnv.CATALOG_RUN_TOKEN;

    const worker = spawn(process.execPath, ["src/order-worker.mjs"], {
      cwd: projectRoot,
      env: workerEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const workerOutput = collectChild(worker);
    const workerExit = await waitForExit(worker);
    if (workerExit.code !== 0) {
      throw new Error(
        `order worker failed (code=${workerExit.code}, signal=${workerExit.signal})\nstdout:\n${workerOutput.stdout}\nstderr:\n${workerOutput.stderr}\napi stdout:\n${apiOutput.stdout}\napi stderr:\n${apiOutput.stderr}`,
      );
    }

    if (!existsSync(resultPath)) {
      throw new Error("order worker did not write integration-result.json");
    }

    const artifact = readJson(resultPath);
    const requestLog = readRequestLog(requestLogPath);
    const summary = validateEvidence({
      artifact,
      requestLog,
      expectedToken: runToken,
    });

    console.log(
      JSON.stringify(
        {
          status: "passed",
          artifact: "integration-result.json",
          requestLogEntries: summary.requestCount,
          validationNodesPassed: summary.validationNodesPassed,
        },
        null,
        2,
      ),
    );
  } finally {
    api.kill("SIGTERM");
  }
}

if (process.argv.includes("--self-test-shortcuts")) {
  runShortcutSelfTest();
} else {
  await runIntegration();
}
