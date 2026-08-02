/**
 * `kota project` operator subcommands.
 *
 * `ls` lists configured projects, marks the default, and points at the
 * currently active selection (or "—" when no selection is in force).
 * `use` switches the daemon's active selection so subsequent inspection
 * calls without `--project` scope to that project. Pass `--clear` to
 * reset the selection back to the registry default.
 *
 * Output flows through the rendering module so the table degrades cleanly
 * on a non-TTY pipe and matches the rest of `daemon-ops` chrome.
 */

import { Command } from "commander";
import type { ScopePolicyFragment } from "#core/daemon/scope-policy.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { confirmAction } from "#core/util/confirm.js";
import { columns, line, plain, type RenderNode, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";
import type { ProjectsListResult } from "./client.js";

function buildProjectsListNode(result: Extract<ProjectsListResult, { ok: true }>): RenderNode {
  if (result.projects.length === 0) {
    return line(span("No projects configured.", "muted"));
  }
  const rows = result.projects.map((p) => {
    const isActive = result.activeProjectId === p.projectId;
    const isDefault = result.defaultProjectId === p.projectId;
    const markers: string[] = [];
    if (isActive) markers.push("active");
    if (isDefault) markers.push("default");
    const marker = markers.length > 0 ? `(${markers.join(", ")})` : "";
    return {
      cells: [
        { spans: [span(p.projectId, isActive ? "tool" : "muted", isActive)] },
        { spans: [plain(p.displayName)] },
        { spans: [span(p.projectDir, "muted")] },
        { spans: [span(marker, isActive ? "info" : "muted")] },
      ],
    };
  });
  return columns(
    [
      { header: "ID", role: "muted", headerRole: "muted", minWidth: 8 },
      { header: "Name", minWidth: 12 },
      { header: "Path", role: "muted", headerRole: "muted", minWidth: 16 },
      { header: "", headerRole: "muted", minWidth: 8 },
    ],
    rows,
  );
}

export function buildProjectCommand(ctx: ModuleContext): Command {
  const cmd = new Command("project").description(
    "Inspect and select the daemon's active project",
  );

  cmd
    .command("ls")
    .description("List configured projects and mark the active one")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.projects.list();
      if (!result.ok) {
        if (opts.json) {
          writeJson(result);
        } else {
          printToStderr(line(span("Daemon is not running. `kota project` requires a live daemon.", "error")));
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        writeJson({
          projects: result.projects,
          defaultProjectId: result.defaultProjectId,
          activeProjectId: result.activeProjectId,
        });
        return;
      }
      print(buildProjectsListNode(result));
    });

  cmd
    .command("use [projectId]")
    .description(
      "Switch the daemon's active project. Pass --clear to reset to the registry default.",
    )
    .option("--clear", "Clear the active selection (route fall back to default)")
    .option("--json", "Output as JSON")
    .action(async (
      projectId: string | undefined,
      opts: { clear?: boolean; json?: boolean },
    ) => {
      if (opts.clear && projectId) {
        printToStderr(line(span("Cannot pass both <projectId> and --clear.", "error")));
        process.exitCode = 1;
        return;
      }
      if (!opts.clear && !projectId) {
        printToStderr(line(span("Pass <projectId> to switch, or --clear to reset.", "error")));
        process.exitCode = 1;
        return;
      }
      const target = opts.clear ? null : projectId!;
      const result = await ctx.client.projects.use(target);
      if (!result.ok) {
        if (opts.json) {
          writeJson(result);
        } else if (result.reason === "not_found") {
          printToStderr(line(span(`Unknown project: "${result.projectId}".`, "error")));
        } else {
          printToStderr(line(span("Daemon is not running. `kota project use` requires a live daemon.", "error")));
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        writeJson(result);
        return;
      }
      if (result.activeProjectId === null) {
        print(line(plain("Active selection cleared. Routes fall back to the registry default.")));
      } else {
        print(line(plain("Active project → "), span(result.activeProjectId, "accent")));
      }
    });

  const authority = cmd
    .command("authority")
    .description("Inspect or mutate machine-owned trust and scope policy");

  authority
    .command("show <scopeId>")
    .description("Show trust, policy, provenance, and authority audit records")
    .option("--json", "Output as JSON")
    .action(async (scopeId: string, opts: { json?: boolean }) => {
      if (!ctx.client.projects.inspectAuthority) {
        printToStderr(line(span("Scope authority requires a live, current daemon.", "error")));
        process.exitCode = 1;
        return;
      }
      const result = await ctx.client.projects.inspectAuthority(scopeId);
      if (!result.ok) {
        if (opts.json) writeJson(result);
        else printToStderr(line(span(authorityError(result), "error")));
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        writeJson(result.authority);
        return;
      }
      print(stack(
        line(plain("Scope: "), span(result.authority.scopeId, "accent")),
        line(plain("Trust: "), span(
          `${result.authority.trust.trusted ? "trusted" : "untrusted"} (${result.authority.trust.source})`,
          result.authority.trust.trusted ? "success" : "warn",
        )),
        line(plain("Revision: "), span(String(result.authority.revision), "muted")),
        line(plain("Policy source: "), span(
          result.authority.policyFragment?.reason ?? "inherited defaults",
          "muted",
        )),
        line(plain("Audit records: "), span(String(result.authority.audit.length), "muted")),
      ));
    });

  authority
    .command("set <scopeId>")
    .description("Validate and atomically apply trust and/or policy")
    .option("--trust <state>", "Set trust to trusted or untrusted")
    .option("--policy <json>", "Set a complete or partial scope policy fragment")
    .option("--clear-policy", "Clear the scope's policy fragment")
    .requiredOption("--reason <text>", "Operator audit reason")
    .option("--validate-only", "Validate and preview without writing")
    .option("--json", "Output as JSON")
    .action(async (
      scopeId: string,
      opts: {
        trust?: string;
        policy?: string;
        clearPolicy?: boolean;
        reason: string;
        validateOnly?: boolean;
        json?: boolean;
      },
    ) => {
      if (
        !ctx.client.projects.inspectAuthority ||
        !ctx.client.projects.validateAuthority ||
        !ctx.client.projects.applyAuthority
      ) {
        printToStderr(line(span("Scope authority requires a live, current daemon.", "error")));
        process.exitCode = 1;
        return;
      }
      if (opts.policy && opts.clearPolicy) {
        printToStderr(line(span("Cannot pass both --policy and --clear-policy.", "error")));
        process.exitCode = 1;
        return;
      }
      const trust = parseTrust(opts.trust);
      if (opts.trust !== undefined && trust === undefined) {
        printToStderr(line(span("--trust must be trusted or untrusted.", "error")));
        process.exitCode = 1;
        return;
      }
      let policy: ScopePolicyFragment | null | undefined;
      try {
        policy = opts.clearPolicy
          ? null
          : opts.policy ? JSON.parse(opts.policy) as ScopePolicyFragment : undefined;
      } catch {
        printToStderr(line(span("--policy must be valid JSON.", "error")));
        process.exitCode = 1;
        return;
      }
      if (trust === undefined && policy === undefined) {
        printToStderr(line(span("Pass --trust, --policy, or --clear-policy.", "error")));
        process.exitCode = 1;
        return;
      }
      const inspected = await ctx.client.projects.inspectAuthority(scopeId);
      if (!inspected.ok) {
        if (opts.json) writeJson(inspected);
        else printToStderr(line(span(authorityError(inspected), "error")));
        process.exitCode = 1;
        return;
      }
      const mutation = {
        expectedRevision: inspected.authority.revision,
        reason: opts.reason,
        ...(trust !== undefined ? { trust } : {}),
        ...(policy !== undefined ? { policy } : {}),
      };
      const preview = await ctx.client.projects.validateAuthority(scopeId, mutation);
      if (opts.validateOnly || !preview.ok) {
        if (opts.json) writeJson(preview);
        else if (preview.ok) print(line(span("Authority change is valid.", "success")));
        else printToStderr(line(span(authorityError(preview), "error")));
        if (!preview.ok) process.exitCode = 1;
        return;
      }
      if (process.env.KOTA_SESSION_ID !== undefined || !process.stdin.isTTY) {
        printToStderr(line(span(
          "Applying scope authority requires an interactive operator terminal.",
          "error",
        )));
        process.exitCode = 1;
        return;
      }
      let confirmedDangerousChange = false;
      if (preview.confirmationRequired) {
        confirmedDangerousChange = await confirmAction(
          `Apply trust or dangerous policy widening to scope ${scopeId}?`,
        );
        if (!confirmedDangerousChange) {
          printToStderr(line(span("Scope authority change was not confirmed.", "warn")));
          process.exitCode = 1;
          return;
        }
      }
      const result = await ctx.client.projects.applyAuthority(
        scopeId,
        mutation,
        confirmedDangerousChange ? "confirm-dangerous" : "apply",
      );
      if (opts.json) writeJson(result);
      else if (result.ok) print(line(span(
        "Authority change applied.",
        "success",
      )));
      else printToStderr(line(span(authorityError(result), "error")));
      if (!result.ok) process.exitCode = 1;
    });

  return cmd;
}

function parseTrust(value: string | undefined): boolean | undefined {
  if (value === "trusted") return true;
  if (value === "untrusted") return false;
  return undefined;
}

function authorityError(result: { reason: string; message?: string }): string {
  if (result.reason === "daemon_required") return "Daemon is not running.";
  return result.message ?? `Scope authority failed: ${result.reason}`;
}
