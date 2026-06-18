import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initEventBus, resetEventBus } from "#core/events/event-bus.js";
import { buildRequestHandler } from "#core/server/server-routes.js";
import { SessionPool } from "#core/server/session-pool.js";
import { digestRoutes } from "#modules/autonomy/workflows/daily-digest/digest-route.js";
import {
  DAILY_DIGEST_STATE_FILENAME,
  renderOnDemandDigest,
} from "#modules/autonomy/workflows/daily-digest/on-demand.js";

const TOKEN = "digest-consolidation-probe";
const windowEndMs = Date.parse("2026-04-26T03:30:00.000Z");
const outPath = join(dirname(fileURLToPath(import.meta.url)), "contract-probe.json");

function record(name, passed, detail) {
  return { name, passed, ...detail };
}

async function main() {
  const projectDir = join(
    tmpdir(),
    `kota-digest-consolidation-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
  for (const state of ["backlog", "ready", "doing", "blocked"]) {
    mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
  }

  const observed = [];
  const bus = initEventBus();
  const unsubscribe = bus.on("workflow.daily.digest", (payload) => {
    observed.push({ event: "workflow.daily.digest", payload });
  });

  const pool = new SessionPool();
  const requestHandler = buildRequestHandler({
    port: 0,
    pool,
    scheduler: { count: () => 0 },
    bus,
    moduleRoutes: digestRoutes({ projectDir }),
    makeAgent: () => {
      throw new Error("makeAgent must not be invoked by /api/digest");
    },
    resolveDefaultAutonomyMode: () => "passive",
    authToken: TOKEN,
  });

  function request(url, headers = {}) {
    return new Promise((resolve) => {
      const req = Object.assign(new EventEmitter(), {
        method: "GET",
        url,
        headers,
      });
      const chunks = [];
      const res = Object.assign(new EventEmitter(), {
        headersSent: false,
        destroyed: false,
        statusCode: 200,
        headers: {},
        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
        },
        writeHead(status, headersToSet = {}) {
          this.statusCode = status;
          this.headersSent = true;
          for (const [name, value] of Object.entries(headersToSet)) {
            this.setHeader(name, value);
          }
          return this;
        },
        write(chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        },
        end(chunk) {
          if (chunk !== undefined) this.write(chunk);
          this.destroyed = true;
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: this.statusCode,
            headers: this.headers,
            text,
            json: () => JSON.parse(text),
          });
        },
      });
      requestHandler(req, res);
    });
  }

  const arms = [];
  try {
    const expected = renderOnDemandDigest({ projectDir, windowEndMs });
    const explicitRes = await request(`/api/digest?windowEndMs=${windowEndMs}`, {
      authorization: `Bearer ${TOKEN}`,
    });
    const explicitBody = explicitRes.json();
    arms.push(
      record("success-explicit-windowEndMs", explicitRes.status === 200, {
        status: explicitRes.status,
        textMatchesOnDemandSeam: explicitBody.text === expected.text,
        dataMatchesOnDemandSeam:
          JSON.stringify(explicitBody.data) === JSON.stringify(expected.data),
        quiet: explicitBody.data?.quiet,
        topLevelKeys: Object.keys(explicitBody).sort(),
        dataKeys: Object.keys(explicitBody.data ?? {}).sort(),
      }),
    );

    const defaultBefore = Date.now();
    const defaultRes = await request("/api/digest", {
      authorization: `Bearer ${TOKEN}`,
    });
    const defaultBody = defaultRes.json();
    const defaultEnded = Date.parse(defaultBody.data?.windowEndedAt ?? "");
    arms.push(
      record(
        "success-default-windowEndMs",
        defaultRes.status === 200 &&
          Number.isFinite(defaultEnded) &&
          defaultEnded >= defaultBefore - 2_000 &&
          defaultEnded <= Date.now() + 2_000,
        {
          status: defaultRes.status,
          windowEndedAt: defaultBody.data?.windowEndedAt,
          quiet: defaultBody.data?.quiet,
          queueDeltaKeys: Object.keys(defaultBody.data?.queueDelta ?? {}).sort(),
        },
      ),
    );

    const badRes = await request("/api/digest?windowEndMs=not-a-number", {
      authorization: `Bearer ${TOKEN}`,
    });
    const badBody = badRes.json();
    arms.push(
      record("malformed-windowEndMs-rejected", badRes.status === 400, {
        status: badRes.status,
        body: badBody,
      }),
    );

    const unauthRes = await request("/api/digest");
    const unauthText = unauthRes.text;
    arms.push(
      record("unauthenticated-rejected", unauthRes.status === 401, {
        status: unauthRes.status,
        bodyPreview: unauthText.slice(0, 120),
      }),
    );

    const statePath = join(projectDir, ".kota", DAILY_DIGEST_STATE_FILENAME);
    arms.push(
      record("no-cadence-state-file-written", !existsSync(statePath), {
        statePathExists: existsSync(statePath),
      }),
    );

    arms.push(
      record("no-workflow-daily-digest-emitted", observed.length === 0, {
        observedEventCount: observed.length,
      }),
    );
  } finally {
    unsubscribe();
    resetEventBus();
    rmSync(projectDir, { recursive: true, force: true });
  }

  const passed = arms.every((arm) => arm.passed);
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        project: "digest-consolidation",
        route: "GET /api/digest",
        passed,
        arms,
      },
      null,
      2,
    )}\n`,
  );

  if (!passed) {
    console.error(`Digest contract probe failed; see ${outPath}`);
    process.exit(1);
  }
}

await main();
