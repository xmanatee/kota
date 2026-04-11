import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  requiredSourceUrls,
  SOURCE_EVIDENCE_FILE,
  validateTaskSourceEvidence,
} from "./source-evidence.js";
import type { TaskReviewTarget } from "./task-review-target.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-source-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeTask(state: TaskReviewTarget["state"], body: string): TaskReviewTarget {
  return {
    path: `data/tasks/${state}/task-research.md`,
    state,
    content: body,
  };
}

function writeEvidence(runDir: string, sources: unknown[]): void {
  writeFileSync(join(runDir, SOURCE_EVIDENCE_FILE), JSON.stringify({ sources }, null, 2));
}

describe("source evidence", () => {
  it("detects required source URLs from resource-backed tasks", () => {
    const task = `---
id: task-research
title: Review new research links
status: ready
area: research
summary: Investigate links.
---

## Resources

- https://x.com/example/status/123
- https://github.com/example/repo.
`;

    expect(requiredSourceUrls(task)).toEqual([
      "https://x.com/example/status/123",
      "https://github.com/example/repo",
    ]);
  });

  it("does not require evidence for incidental URLs without research intent", () => {
    const task = `---
id: task-config
title: Add webhook URL setting
status: ready
area: runtime
summary: Add a URL setting.
---

## Desired Outcome

Add config for https://example.com/webhook shape.
`;

    expect(requiredSourceUrls(task)).toEqual([]);
  });

  it("fails source-backed tasks without source-evidence.json", () => {
    const runDir = makeTmpDir();
    const task = makeTask("done", `---
id: task-research
title: Review resource
status: done
area: research
summary: Review link.
---

## Resources

- https://x.com/example/status/123
`);

    expect(() => validateTaskSourceEvidence(task, runDir)).toThrow(/Missing source-evidence\.json/);
  });

  it("fails done tasks when a required source is blocked", () => {
    const runDir = makeTmpDir();
    writeEvidence(runDir, [
      {
        url: "https://x.com/example/status/123",
        status: "blocked",
        method: "WebFetch and web search",
        evidence: "X returned an authentication wall; no alternate source exposed the tweet text.",
      },
    ]);
    const task = makeTask("done", `---
id: task-research
title: Review resource
status: done
area: research
summary: Review link.
---

## Resources

- https://x.com/example/status/123
`);

    expect(() => validateTaskSourceEvidence(task, runDir)).toThrow(/marked done.*blocked/);
  });

  it("allows blocked tasks with explicit source blockers", () => {
    const runDir = makeTmpDir();
    writeEvidence(runDir, [
      {
        url: "https://x.com/example/status/123",
        status: "blocked",
        method: "WebFetch and web search",
        evidence: "X returned an authentication wall; no alternate source exposed the tweet text.",
      },
    ]);
    const task = makeTask("blocked", `---
id: task-research
title: Review resource
status: blocked
area: research
summary: Review link.
---

## Resources

- https://x.com/example/status/123
`);

    expect(validateTaskSourceEvidence(task, runDir)).toMatch(/OK: source evidence covers 1/);
  });

  it("allows done tasks after every required source was read", () => {
    const runDir = makeTmpDir();
    writeEvidence(runDir, [
      {
        url: "https://github.com/example/repo",
        status: "read",
        method: "WebFetch",
        evidence: "Read the repository README and extracted the relevant module API pattern.",
      },
    ]);
    const task = makeTask("done", `---
id: task-research
title: Review resource
status: done
area: research
summary: Review link.
---

## Resources

- https://github.com/example/repo
`);

    expect(validateTaskSourceEvidence(task, runDir)).toMatch(/OK: source evidence covers 1/);
  });
});
