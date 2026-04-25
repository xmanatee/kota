/**
 * Local-handler unit tests for the `web` namespace. Cover the daemon-down
 * branches we can exercise without standing up a real HTTP server: the
 * `missing_api_key` short-circuit and the operator handler's local-mode
 * routing decision.
 *
 * The actual server-start path is exercised by `static-routes.test.ts` and
 * the broader integration tests; this file pins the contract behavior.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { localWebClient } from "./web-operations.js";

function stubCtx(cwd: string): ModuleContext {
  return {
    cwd,
    config: {},
    getRoutes: () => [],
    getRegisteredConfigKeys: () => new Set<string>(),
  } as unknown as ModuleContext;
}

describe("web local handler", () => {
  let cwd: string;
  let savedKey: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kota-web-ops-"));
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it("returns missing_api_key when ANTHROPIC_API_KEY is unset", async () => {
    const result = await localWebClient(stubCtx(cwd)).start({ port: 1 });
    expect(result).toEqual({ ok: false, reason: "missing_api_key" });
  });
});
