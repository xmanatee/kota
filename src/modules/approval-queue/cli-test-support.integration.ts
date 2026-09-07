import { Command } from "commander";
import { vi } from "vitest";
import { type ApprovalClientProjection, type PendingApproval, projectApprovalForClient } from "#core/daemon/approval-queue.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { setStderrTransport, setTerminalTransport, TerminalTransport } from "#modules/rendering/transport.js";
import { registerApprovalCommands } from "./cli.js";
import type { ApprovalsClient } from "./client.js";

// Authored boundary responses, with no simulated queue or execution lifecycle.
export function approval(overrides: Partial<PendingApproval> = {}): ApprovalClientProjection {
  const item: PendingApproval = {
    id: "1234abcd", scopeId: "scope-test", kind: "tool_call", tool: "shell",
    input: { command: "git push origin main", accessToken: "raw-token" },
    risk: "dangerous", reason: "publish reviewed change", createdAt: new Date().toISOString(),
    status: "pending", ...overrides,
  };
  return projectApprovalForClient(item, "daemon-api", item.input);
}

export function cli() {
  const client = {
    list: vi.fn<ApprovalsClient["list"]>().mockResolvedValue({ approvals: [] }),
    approve: vi.fn<ApprovalsClient["approve"]>(),
    reject: vi.fn<ApprovalsClient["reject"]>(),
  } satisfies ApprovalsClient;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transport = (chunks: string[]) => new TerminalTransport({
    theme: NO_COLOR_THEME,
    stream: { isTTY: false, write: (chunk) => { chunks.push(chunk); return true; } },
  });
  setTerminalTransport(transport(stdout));
  setStderrTransport(transport(stderr));
  const exit = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
  return {
    client, stdout, stderr, exit,
    async run(...args: string[]) {
      const program = new Command().exitOverride();
      registerApprovalCommands(program, { client: { approvals: client } } as unknown as ModuleContext);
      await program.parseAsync(["node", "kota", "approval", ...args]);
      return stdout.join("");
    },
  };
}

export function cleanup(): void {
  setTerminalTransport(null);
  setStderrTransport(null);
  vi.restoreAllMocks();
}
