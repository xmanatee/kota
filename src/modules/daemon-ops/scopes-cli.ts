/**
 * `kota scope` operator subcommands.
 *
 * `list` lists configured scopes, marks the default, and points at the
 * currently active selection (or "—" when no selection is in force).
 * `select` switches the daemon's active selection so subsequent inspection
 * calls without `--scope` use that scope. Pass `--clear` to
 * reset the selection back to the registry default.
 *
 * Output flows through the rendering module so the table degrades cleanly
 * on a non-TTY pipe and matches the rest of `daemon-ops` chrome.
 */

import { Command } from "commander";
import type {
  ScopeOnboardingChoices,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
} from "#core/daemon/scope-onboarding.js";
import type { ScopePolicyFragment } from "#core/daemon/scope-policy.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { confirmAction } from "#core/util/confirm.js";
import { columns, line, plain, type RenderNode, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";
import type { ScopesListResult } from "./client.js";
import {
  describeOnboardingInspection,
  describeOnboardingOperation,
  describeOnboardingPlan,
} from "./scope-onboarding-presentation.js";

function onboardingLines(lines: readonly string[]): RenderNode {
  return stack(...lines.map((text) => line(plain(text))));
}

function onboardingPlanLines(plan: ScopeOnboardingPlan): readonly string[] {
  const improvement = plan.permissions.improvement;
  return [
    ...describeOnboardingPlan(plan),
    `Improvement: ${improvement.posture}, review=${improvement.review}, ` +
      `builder=${improvement.builder}, autonomy=${plan.permissions.autonomy}, ` +
      `writes=${plan.permissions.writes.mode}.`,
  ];
}

function onboardingOperationLines(
  operation: ScopeOnboardingOperation,
): readonly string[] {
  const readiness = operation.readiness;
  const improvement = readiness.improvement;
  return [
    ...describeOnboardingOperation(operation),
    `Improvement: ${improvement.posture}, review=${improvement.review}, ` +
      `builder=${improvement.builder}, autonomy=${improvement.autonomyMode}, ` +
      `writes=${improvement.writes.mode}.`,
    `Readiness blockers: ${readiness.reasons.length}.`,
    ...readiness.reasons.map((reason) =>
      `${reason.code}${reason.capability ? ` (${reason.capability})` : ""}: ${reason.message}`
    ),
  ];
}

function buildScopesListNode(result: Extract<ScopesListResult, { ok: true }>): RenderNode {
  if (result.scopes.length === 0) {
    return line(span("No scopes configured.", "muted"));
  }
  const rows = result.scopes.map((scope) => {
    const isActive = result.activeScopeId === scope.scopeId;
    const isDefault = result.defaultScopeId === scope.scopeId;
    const markers: string[] = [];
    if (isActive) markers.push("active");
    if (isDefault) markers.push("default");
    const marker = markers.length > 0 ? `(${markers.join(", ")})` : "";
    return {
      cells: [
        { spans: [span(scope.scopeId, isActive ? "tool" : "muted", isActive)] },
        { spans: [plain(scope.displayName)] },
        { spans: [span(scope.scopeRoot, "muted")] },
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

export function buildScopeCommand(ctx: ModuleContext): Command {
  const cmd = new Command("scope").description(
    "Inspect and select the daemon's active scope",
  );

  cmd
    .command("list")
    .description("List configured scopes and mark the active one")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const result = await ctx.client.scopes.list();
      if (!result.ok) {
        if (opts.json) {
          writeJson(result);
        } else {
          printToStderr(line(span("Daemon is not running. `kota scope` requires a live daemon.", "error")));
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        writeJson({
          scopes: result.scopes,
          defaultScopeId: result.defaultScopeId,
          activeScopeId: result.activeScopeId,
        });
        return;
      }
      print(buildScopesListNode(result));
    });

  cmd
    .command("select [scopeId]")
    .description(
      "Switch the daemon's active scope. Pass --clear to reset to the registry default.",
    )
    .option("--clear", "Clear the active selection (route fall back to default)")
    .option("--json", "Output as JSON")
    .action(async (
      scopeId: string | undefined,
      opts: { clear?: boolean; json?: boolean },
    ) => {
      if (opts.clear && scopeId) {
        printToStderr(line(span("Cannot pass both <scopeId> and --clear.", "error")));
        process.exitCode = 1;
        return;
      }
      if (!opts.clear && !scopeId) {
        printToStderr(line(span("Pass <scopeId> to switch, or --clear to reset.", "error")));
        process.exitCode = 1;
        return;
      }
      const target = opts.clear ? null : scopeId!;
      const result = await ctx.client.scopes.use(target);
      if (!result.ok) {
        if (opts.json) {
          writeJson(result);
        } else if (result.reason === "not_found") {
          printToStderr(line(span(`Unknown scope: "${result.scopeId}".`, "error")));
        } else if (result.reason === "not_hosted") {
          printToStderr(line(span(
            `Scope "${result.scopeId}" cannot be selected while it is ${result.state}.`,
            "error",
          )));
        } else {
          printToStderr(line(span("Daemon is not running. `kota scope select` requires a live daemon.", "error")));
        }
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        writeJson(result);
        return;
      }
      if (result.activeScopeId === null) {
        print(line(plain("Active selection cleared. Routes fall back to the registry default.")));
      } else {
        print(line(plain("Active scope → "), span(result.activeScopeId, "accent")));
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
      if (!ctx.client.scopes.inspectAuthority) {
        printToStderr(line(span("Scope authority requires a live, current daemon.", "error")));
        process.exitCode = 1;
        return;
      }
      const result = await ctx.client.scopes.inspectAuthority(scopeId);
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
        !ctx.client.scopes.inspectAuthority ||
        !ctx.client.scopes.validateAuthority ||
        !ctx.client.scopes.applyAuthority
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
      const inspected = await ctx.client.scopes.inspectAuthority(scopeId);
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
      const preview = await ctx.client.scopes.validateAuthority(scopeId, mutation);
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
      const result = await ctx.client.scopes.applyAuthority(
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

  cmd
    .command("inspect <directory>")
    .description("Inspect a folder without changing it")
    .option("--json", "Output as JSON")
    .action(async (directory: string, opts: { json?: boolean }) => {
      const client = ctx.client.scopes.inspectOnboarding;
      if (!client) return onboardingUnavailable(opts.json);
      const result = await client(directory);
      if (opts.json) writeJson(result);
      else if (!result.ok) printToStderr(line(span(onboardingError(result), "error")));
      else print(onboardingLines(describeOnboardingInspection(result.inspection)));
      if (!result.ok) process.exitCode = 1;
    });

  addOnboardingChoiceOptions(
    cmd
      .command("configure <directory>")
      .description("Return the exact onboarding changes and readiness blockers")
      .option("--json", "Output as JSON"),
  ).action(async (
    directory: string,
    opts: OnboardingChoiceOptions & { json?: boolean },
  ) => {
    const client = ctx.client.scopes.planOnboarding;
    if (!client) return onboardingUnavailable(opts.json);
    const choices = parseOnboardingChoices(opts);
    if (!choices.ok) return onboardingInputError(choices.message, opts.json);
    const result = await client(directory, choices.value);
    if (opts.json) writeJson(result);
    else if (!result.ok) printToStderr(line(span(onboardingError(result), "error")));
    else print(onboardingLines(onboardingPlanLines(result.plan)));
    if (!result.ok) process.exitCode = 1;
  });

  addOnboardingChoiceOptions(
    cmd
      .command("add <directory>")
      .description("Plan, confirm, and transactionally onboard a folder")
      .option("--json", "Output as JSON"),
  ).action(async (
    directory: string,
    opts: OnboardingChoiceOptions & { json?: boolean },
  ) => {
    const { planOnboarding, applyOnboarding } = ctx.client.scopes;
    if (!planOnboarding || !applyOnboarding) return onboardingUnavailable(opts.json);
    const choices = parseOnboardingChoices(opts);
    if (!choices.ok) return onboardingInputError(choices.message, opts.json);
    const planned = await planOnboarding(directory, choices.value);
    if (!planned.ok) {
      if (opts.json) writeJson(planned);
      else printToStderr(line(span(onboardingError(planned), "error")));
      process.exitCode = 1;
      return;
    }
    if (process.env.KOTA_SESSION_ID !== undefined || !process.stdin.isTTY) {
      onboardingInputError(
        "Applying scope onboarding requires an interactive operator terminal.",
        opts.json,
      );
      return;
    }
    if (!opts.json) print(onboardingLines(onboardingPlanLines(planned.plan)));
    const confirmed = await confirmAction(
      `Apply onboarding plan ${planned.plan.planId} for ${planned.plan.directoryRoot}?`,
    );
    if (!confirmed) {
      onboardingInputError("Scope onboarding was not confirmed.", opts.json);
      return;
    }
    const dangerous = planned.plan.choices.trust ||
      planned.plan.choices.improvementPosture !== "observe" ||
      planned.plan.choices.writes.mode !== "none";
    const result = await applyOnboarding(
      planned.plan,
      dangerous ? "confirm-dangerous" : "apply",
    );
    if (opts.json) writeJson(result);
    else if (!result.ok) {
      printToStderr(line(span(onboardingError(result), "error")));
      if ("operation" in result && result.operation) {
        printToStderr(onboardingLines(onboardingOperationLines(result.operation)));
      }
    } else print(onboardingLines(onboardingOperationLines(result.operation)));
    if (!result.ok) process.exitCode = 1;
  });

  cmd
    .command("status <operationId>")
    .description("Show a durable onboarding operation")
    .option("--json", "Output as JSON")
    .action(async (operationId: string, opts: { json?: boolean }) => {
      const client = ctx.client.scopes.getOnboardingStatus;
      if (!client) return onboardingUnavailable(opts.json);
      const result = await client(operationId);
      if (opts.json) writeJson(result);
      else if (!result.ok) printToStderr(line(span(onboardingError(result), "error")));
      else print(onboardingLines(onboardingOperationLines(result.operation)));
      if (!result.ok) process.exitCode = 1;
    });

  cmd
    .command("retry <operationId>")
    .description("Retry an incomplete onboarding transaction")
    .option("--json", "Output as JSON")
    .action(async (operationId: string, opts: { json?: boolean }) => {
      const { getOnboardingStatus, retryOnboarding } = ctx.client.scopes;
      if (!getOnboardingStatus || !retryOnboarding) return onboardingUnavailable(opts.json);
      const status = await getOnboardingStatus(operationId);
      if (!status.ok) {
        if (opts.json) writeJson(status);
        else printToStderr(line(span(onboardingError(status), "error")));
        process.exitCode = 1;
        return;
      }
      if (process.env.KOTA_SESSION_ID !== undefined || !process.stdin.isTTY) {
        onboardingInputError(
          "Retrying scope onboarding requires an interactive operator terminal.",
          opts.json,
        );
        return;
      }
      const confirmed = await confirmAction(`Retry onboarding operation ${operationId}?`);
      if (!confirmed) return onboardingInputError("Scope onboarding retry was not confirmed.", opts.json);
      const plan = status.operation.acceptedPlan;
      const dangerous = plan.choices.trust ||
        plan.choices.improvementPosture !== "observe" ||
        plan.choices.writes.mode !== "none";
      const result = await retryOnboarding(
        operationId,
        plan.scopeId,
        dangerous ? "confirm-dangerous" : "apply",
      );
      if (opts.json) writeJson(result);
      else print(line(span(
        result.ok ? "Scope onboarding retry completed." : onboardingError(result),
        result.ok ? "success" : "error",
      )));
      if (!result.ok) process.exitCode = 1;
    });

  cmd
    .command("cancel <operationId>")
    .description("Roll back and cancel an incomplete onboarding transaction")
    .option("--json", "Output as JSON")
    .action(async (operationId: string, opts: { json?: boolean }) => {
      const client = ctx.client.scopes.cancelOnboarding;
      if (!client) return onboardingUnavailable(opts.json);
      if (!process.stdin.isTTY) {
        onboardingInputError("Cancelling scope onboarding requires an interactive terminal.", opts.json);
        return;
      }
      const confirmed = await confirmAction(`Cancel and roll back onboarding operation ${operationId}?`);
      if (!confirmed) return onboardingInputError("Scope onboarding cancellation was not confirmed.", opts.json);
      const result = await client(operationId);
      if (opts.json) writeJson(result);
      else print(line(span(
        result.ok ? "Scope onboarding cancelled." : onboardingError(result),
        result.ok ? "success" : "error",
      )));
      if (!result.ok) process.exitCode = 1;
    });

  cmd
    .command("drain <scopeId>")
    .description("Stop a scope accepting work and report removal blockers")
    .option("--json", "Output as JSON")
    .action(async (scopeId: string, opts: { json?: boolean }) => {
      if (!process.stdin.isTTY) {
        onboardingInputError("Draining a scope requires an interactive terminal.", opts.json);
        return;
      }
      const confirmed = await confirmAction(`Drain scope ${scopeId}?`);
      if (!confirmed) return onboardingInputError("Scope drain was not confirmed.", opts.json);
      const result = await ctx.client.scopes.drain(scopeId);
      if (opts.json) writeJson(result);
      else if (result.ok) print(line(span(`Scope ${scopeId} drained.`, "success")));
      else printToStderr(line(span(onboardingError(result), "error")));
      if (!result.ok) process.exitCode = 1;
    });

  cmd
    .command("remove <scopeId>")
    .description("Stop hosting a drained scope without deleting its folder")
    .option("--json", "Output as JSON")
    .action(async (scopeId: string, opts: { json?: boolean }) => {
      if (!process.stdin.isTTY) {
        onboardingInputError("Removing a scope requires an interactive terminal.", opts.json);
        return;
      }
      const confirmed = await confirmAction(
        `Remove scope ${scopeId} from KOTA? Its folder will not be deleted.`,
      );
      if (!confirmed) return onboardingInputError("Scope removal was not confirmed.", opts.json);
      const result = await ctx.client.scopes.remove(scopeId);
      if (opts.json) writeJson(result);
      else if (result.ok) print(line(span(
        `Scope ${scopeId} is no longer hosted. Its folder was not deleted.`,
        "success",
      )));
      else printToStderr(line(span(onboardingError(result), "error")));
      if (!result.ok) process.exitCode = 1;
    });

  return cmd;
}

type OnboardingChoiceOptions = {
  name?: string;
  trusted?: boolean;
  improvement?: string;
  writes?: string;
  writePath?: string[];
};

function addOnboardingChoiceOptions(command: Command): Command {
  return command
    .option("--name <displayName>", "Scope display name")
    .option("--trusted", "Explicitly trust the scope")
    .option("--improvement <posture>", "Continuous improvement: observe, propose, or build")
    .option("--writes <mode>", "Write boundary: none, scope-directory, paths, or unrestricted")
    .option("--write-path <path...>", "Allowed path(s) when --writes paths is selected");
}

function parseOnboardingChoices(
  opts: OnboardingChoiceOptions,
): { ok: true; value: ScopeOnboardingChoices } | { ok: false; message: string } {
  if (
    opts.improvement !== undefined &&
    opts.improvement !== "observe" &&
    opts.improvement !== "propose" &&
    opts.improvement !== "build"
  ) return { ok: false, message: "--improvement must be observe, propose, or build." };
  if (
    opts.writes !== undefined &&
    opts.writes !== "none" &&
    opts.writes !== "scope-directory" &&
    opts.writes !== "paths" &&
    opts.writes !== "unrestricted"
  ) return { ok: false, message: "--writes must be none, scope-directory, paths, or unrestricted." };
  if (opts.writes === "paths" && (opts.writePath?.length ?? 0) === 0) {
    return { ok: false, message: "--writes paths requires at least one --write-path." };
  }
  if (opts.writes !== "paths" && opts.writePath !== undefined) {
    return { ok: false, message: "--write-path is only valid with --writes paths." };
  }
  let writes: ScopeOnboardingChoices["writes"];
  if (opts.writes === "paths") writes = { mode: "paths", paths: opts.writePath! };
  else if (opts.writes === "none") writes = { mode: "none" };
  else if (opts.writes === "scope-directory") writes = { mode: "scope-directory" };
  else if (opts.writes === "unrestricted") writes = { mode: "unrestricted" };
  return {
    ok: true,
    value: {
      ...(opts.name !== undefined ? { displayName: opts.name } : {}),
      ...(opts.trusted === true ? { trust: true } : {}),
      ...(opts.improvement !== undefined ? { improvementPosture: opts.improvement } : {}),
      ...(writes !== undefined ? { writes } : {}),
    },
  };
}

function onboardingUnavailable(json: boolean | undefined): void {
  onboardingInputError("Scope onboarding requires a live, current daemon.", json);
}

function onboardingInputError(message: string, json: boolean | undefined): void {
  if (json) writeJson({ ok: false, reason: "invalid_input", message });
  else printToStderr(line(span(message, "error")));
  process.exitCode = 1;
}

function onboardingError(result: { reason: string; message?: string }): string {
  if (result.reason === "daemon_required") return "Daemon is not running.";
  return result.message ?? `Scope onboarding failed: ${result.reason}`;
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
