import type { Command } from "commander";
import type { RenderNode } from "#modules/rendering/primitives.js";
import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, writeJson, writeStdoutLine } from "#modules/rendering/transport.js";
import {
  DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION,
  type DaemonScopeRootOptions,
  printDaemonError,
  resolveDaemonCommandScopeRoot,
} from "./daemon-cli-options.js";
import { buildDaemonOpsDaemonHandler } from "./daemon-client-handlers.js";
import { daemonOpsClientForScope, localDaemonStop } from "./daemon-ops-operations.js";
import { buildDaemonStatusNode } from "./daemon-status-renderer.js";

export function addDaemonControlCommands(command: Command): void {
  command
    .command("status")
    .description("Show daemon health summary (exits 0 if reachable)")
    .option("--scope-root <path>", DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION)
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean; scopeRoot?: string }, child: Command) => {
      const scopeRoot = resolveDaemonCommandScopeRoot(opts, child);
      const client = await daemonOpsClientForScope(scopeRoot, buildDaemonOpsDaemonHandler);
      const result = await client.status();
      if (result.state === "running") {
        if (opts.json) writeJson({ ...result.status, managed: result.managed });
        else print(buildDaemonStatusNode(result.status, result.managed));
        return;
      }
      if (opts.json) {
        writeJson(result.state === "stale"
          ? { running: false, managed: result.managed, staleControlFile: true }
          : { running: false, managed: result.managed });
      } else {
        printDaemonError(result.state === "stale"
          ? `Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`
          : "Daemon is not running.");
        if (result.managed) print(line(plain("managed:  yes (OS service installed)")));
      }
      process.exitCode = 1;
    });

  command
    .command("pid")
    .description("Print the PID of the running daemon (exits non-zero if not running)")
    .option("--scope-root <path>", DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION)
    .action(async (opts: DaemonScopeRootOptions, child: Command) => {
      const scopeRoot = resolveDaemonCommandScopeRoot(opts, child);
      const result = await (await daemonOpsClientForScope(
        scopeRoot,
        buildDaemonOpsDaemonHandler,
      )).pid();
      if (result.state === "running") {
        writeStdoutLine(String(result.pid));
        return;
      }
      printDaemonError(result.state === "stale"
        ? `Stale control file (pid ${result.pid} is not alive). Run 'kota doctor --fix' to clean up.`
        : "Daemon is not running.");
      process.exitCode = 1;
    });

  command
    .command("stop")
    .description("Gracefully stop the running daemon (exits 0 on success)")
    .option("--scope-root <path>", DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION)
    .option("--timeout <seconds>", "Seconds to wait for clean exit", "90")
    .action(async (opts: { timeout: string; scopeRoot?: string }, child: Command) => {
      const timeoutSec = Math.max(1, Number.parseInt(opts.timeout, 10) || 10);
      const result = await localDaemonStop({
        timeoutSec,
        scopeRoot: resolveDaemonCommandScopeRoot(opts, child),
      });
      if (result.ok) {
        print(line(span("Daemon stopped.", "success")));
        return;
      }
      const messages = {
        not_running: "Daemon is not running.",
        stale: "Daemon process is not running (stale control file).",
        unavailable: "Daemon control endpoint could not be verified; refusing to signal the recorded pid.",
        timeout: `Daemon did not stop within ${timeoutSec}s.`,
      } as const;
      printDaemonError(messages[result.reason]);
      process.exitCode = 1;
    });

  command
    .command("reload")
    .description("Reload daemon config and re-register module workflow contributions without restart")
    .option("--scope-root <path>", DAEMON_SCOPE_ROOT_OPTION_DESCRIPTION)
    .action(async (opts: DaemonScopeRootOptions, child: Command) => {
      const scopeRoot = resolveDaemonCommandScopeRoot(opts, child);
      const result = await (await daemonOpsClientForScope(
        scopeRoot,
        buildDaemonOpsDaemonHandler,
      )).reload();
      if (!result.ok) {
        printDaemonError(result.reason === "not_running"
          ? "Daemon is not running."
          : "Daemon reload failed or daemon is not reachable.");
        process.exitCode = 1;
        return;
      }
      const lines: RenderNode[] = [line(
        span("Reloaded. ", "success"),
        plain(`${result.workflows} workflow definition(s) active.`),
      )];
      lines.push(result.changedModules.length === 0
        ? line(span("  No module config changes detected.", "muted"))
        : line(plain("  Reloaded module(s): "), span(result.changedModules.join(", "), "accent")));
      const guardrails = result.sessionGuardrails;
      lines.push(line(
        plain(`  Session guardrails: ${guardrails.refreshed} refreshed, `),
        plain(`${guardrails.unchanged} unchanged, `),
        span(
          `${guardrails.nonRefreshable.length} not refreshable.`,
          guardrails.nonRefreshable.length > 0 ? "warn" : "muted",
        ),
      ));
      for (const session of guardrails.nonRefreshable) {
        lines.push(line(span(`    ${session.id}: ${session.reason}`, "muted")));
      }
      print(stack(...lines));
    });
}
