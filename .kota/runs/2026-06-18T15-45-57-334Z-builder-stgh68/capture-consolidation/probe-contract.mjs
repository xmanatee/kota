import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import { createCaptureRouteHandler } from "#modules/capture/routes.js";

const outPath = join(dirname(fileURLToPath(import.meta.url)), "contract-probe.json");

const records = {
  memory: { target: "memory", recordId: "mem-1" },
  knowledge: { target: "knowledge", recordId: "kn-1" },
  tasks: {
    target: "tasks",
    recordId: "task-x",
    path: "data/tasks/ready/task-x.md",
  },
  inbox: {
    target: "inbox",
    recordId: "inbox-x",
    path: "data/inbox/x.md",
  },
};

function record(name, passed, detail = {}) {
  return { name, passed, ...detail };
}

function contributor(target, onCapture) {
  return {
    target,
    async capture(input) {
      return onCapture ? onCapture(input) : records[target];
    },
  };
}

function provider({ targets = ["memory", "knowledge", "tasks", "inbox"], classifier } = {}) {
  const instance = new CaptureProviderImpl(classifier ? { classifier } : {});
  for (const target of targets) {
    instance.register(contributor(target));
  }
  return instance;
}

function request(body) {
  const req = new EventEmitter();
  req.destroy = () => {
    req.destroyed = true;
  };
  queueMicrotask(() => {
    req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  return req;
}

function jsonRequest(body) {
  return request(JSON.stringify(body));
}

function response() {
  const chunks = [];
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
  };
  res.writeHead = (status, headers = {}) => {
    res.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
  };
  res.write = (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  };
  res.end = (chunk) => {
    if (chunk !== undefined) res.write(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    res.text = text;
    res.body = text ? JSON.parse(text) : null;
    res.emit("finish");
  };
  return res;
}

async function invoke(handler, body) {
  const res = response();
  await handler(typeof body === "string" ? request(body) : jsonRequest(body), res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function main() {
  const arms = [];

  {
    const handler = createCaptureRouteHandler(() => provider());
    const res = await invoke(handler, "{not-json");
    arms.push(
      record("malformed-body-rejected", res.status === 400, {
        status: res.status,
        body: res.body,
      }),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => provider());
    const res = await invoke(handler, { text: "   " });
    arms.push(
      record(
        "empty-text-rejected",
        res.status === 400 && same(res.body, { error: "text is required" }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => provider());
    const res = await invoke(handler, {
      text: " remember dark themes ",
      filter: { target: "memory" },
    });
    arms.push(
      record(
        "success-explicit-target",
        res.status === 200 && same(res.body, { ok: true, record: records.memory }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => provider());
    const res = await invoke(handler, {
      text: "file this follow-up",
      filter: { target: "tasks" },
    });
    arms.push(
      record(
        "success-tasks-with-path",
        res.status === 200 && same(res.body, { ok: true, record: records.tasks }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => provider());
    const res = await invoke(handler, { text: "ambiguous note" });
    arms.push(
      record(
        "ambiguous-no-classifier",
        res.status === 200 &&
          same(res.body, {
            ok: false,
            reason: "ambiguous",
            suggestions: ["memory", "knowledge", "tasks", "inbox"],
          }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() =>
      provider({
        classifier: {
          async classify() {
            throw new Error("classifier boom");
          },
        },
      }),
    );
    const res = await invoke(handler, { text: "classifier throws" });
    arms.push(
      record(
        "classifier-throws-surfaces-500",
        res.status === 500 && same(res.body, { error: "classifier boom" }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() =>
      provider({
        classifier: {
          async classify() {
            return { kind: "ambiguous" };
          },
        },
      }),
    );
    const res = await invoke(handler, { text: "classifier abstains" });
    arms.push(
      record(
        "ambiguous-classifier-says-ambiguous",
        res.status === 200 &&
          same(res.body, {
            ok: false,
            reason: "ambiguous",
            suggestions: ["memory", "knowledge", "tasks", "inbox"],
          }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => provider({ targets: ["memory"] }));
    const res = await invoke(handler, {
      text: "knowledge note",
      filter: { target: "knowledge" },
    });
    arms.push(
      record(
        "unregistered-explicit-target",
        res.status === 200 && same(res.body, { ok: false, reason: "no_contributors" }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => new CaptureProviderImpl());
    const res = await invoke(handler, { text: "anything" });
    arms.push(
      record(
        "no-contributors-zero",
        res.status === 200 && same(res.body, { ok: false, reason: "no_contributors" }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const instance = new CaptureProviderImpl();
    instance.register(
      contributor("inbox", () => {
        throw new Error("disk full");
      }),
    );
    const handler = createCaptureRouteHandler(() => instance);
    const res = await invoke(handler, {
      text: "rough thought",
      filter: { target: "inbox" },
    });
    arms.push(
      record(
        "contributor-throws",
        res.status === 200 &&
          same(res.body, {
            ok: false,
            reason: "contributor_failed",
            target: "inbox",
            message: "disk full",
          }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() =>
      provider({
        classifier: {
          async classify() {
            return { kind: "confident", target: "tasks" };
          },
        },
      }),
    );
    const res = await invoke(handler, { text: "file a task" });
    arms.push(
      record(
        "classifier-confident-pick",
        res.status === 200 && same(res.body, { ok: true, record: records.tasks }),
        { status: res.status, body: res.body },
      ),
    );
  }

  {
    const observed = {};
    const instance = new CaptureProviderImpl({
      classifier: {
        async classify(input) {
          observed.classifier = input;
          return { kind: "confident", target: "memory" };
        },
      },
    });
    instance.register(
      contributor("memory", (input) => {
        observed.contributor = input;
        return records.memory;
      }),
    );
    const handler = createCaptureRouteHandler(() => instance);
    const res = await invoke(handler, {
      text: "  trim me  ",
      filter: { hint: "preference" },
    });
    arms.push(
      record(
        "classifier-receives-trimmed-text-and-hint",
        res.status === 200 &&
          observed.classifier?.text === "trim me" &&
          observed.classifier?.hint === "preference" &&
          observed.contributor?.text === "trim me" &&
          observed.contributor?.hint === "preference",
        { status: res.status, body: res.body, observed },
      ),
    );
  }

  {
    const handler = createCaptureRouteHandler(() => {
      throw new Error("provider unavailable");
    });
    const res = await invoke(handler, { text: "anything" });
    arms.push(
      record(
        "provider-throws-unhandled",
        res.status === 500 && same(res.body, { error: "provider unavailable" }),
        { status: res.status, body: res.body },
      ),
    );
  }

  const passed = arms.every((arm) => arm.passed);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        project: "capture-consolidation",
        routes: ["POST /capture", "POST /api/capture"],
        handler: "createCaptureRouteHandler",
        passed,
        arms,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  if (!passed) {
    process.exitCode = 1;
  }
}

await main();
