import type { ModuleSetupStatusResponse } from "#core/modules/setup-requirements.js";
import {
  group,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";

function setupStateRole(state: string): SemanticRole {
  if (state === "ready" || state === "complete" || state === "satisfied") return "success";
  if (state === "action_required" || state === "missing" || state === "pending") return "warn";
  if (state === "failed" || state === "error") return "error";
  return "muted";
}

function remediationNodes(
  requirement: ModuleSetupStatusResponse["requirements"][number],
): RenderNode[] {
  if (requirement.state === "ready") return [];
  if (requirement.state === "pending" && requirement.pendingAction?.status === "pending") {
    const needsSecretInput = requirement.secretRefs?.some((ref) => !ref.present) === true;
    const nodes = [line(
      plain("command "),
      span(
        `kota setup complete ${requirement.pendingAction.actionId}` +
          (needsSecretInput ? " --secret-values-stdin" : ""),
        "info",
      ),
    )];
    if (needsSecretInput) {
      nodes.push(line(
        plain("stdin JSON keys "),
        span(requirement.secretRefs!.map((ref) => ref.name).join(", "), "accent"),
      ));
    }
    return nodes;
  }
  const nodes: RenderNode[] = [];
  if (requirement.secretRefs && requirement.secretRefs.length > 0) {
    nodes.push(line(
      plain("command "),
      span(
        `kota setup secret ${requirement.moduleName} ${requirement.requirementId} --secret-values-stdin`,
        "info",
      ),
    ));
  }
  if (requirement.setup.mode === "form") {
    nodes.push(line(
      plain("command "),
      span(`kota setup submit ${requirement.moduleName} ${requirement.requirementId} --help`, "info"),
    ));
  }
  if (requirement.setup.mode === "url") {
    nodes.push(line(
      plain("command "),
      span(`kota setup start ${requirement.moduleName} ${requirement.requirementId}`, "info"),
    ));
  }
  return nodes;
}

function requirementNodes(
  requirement: ModuleSetupStatusResponse["requirements"][number],
): RenderNode[] {
  const nodes: RenderNode[] = [
    line(
      span(requirement.state, setupStateRole(requirement.state)),
      plain("  "),
      plain(requirement.title),
    ),
    line(span(requirement.reason, "muted"), plain(" — "), span(requirement.message, "muted")),
  ];
  for (const ref of requirement.secretRefs ?? []) {
    nodes.push(line(
      plain("secret "),
      span(ref.name, "accent"),
      plain(": "),
      span(ref.present ? "present" : "missing", ref.present ? "success" : "warn"),
    ));
  }
  for (const field of requirement.configFields ?? []) {
    nodes.push(line(
      plain("config "),
      span(field.configPath, "accent"),
      plain(": "),
      span(field.present ? "present" : "missing", field.present ? "success" : "warn"),
    ));
  }
  if (requirement.pendingAction) {
    nodes.push(line(
      plain("action "),
      span(requirement.pendingAction.actionId, "accent"),
      plain(": "),
      span(requirement.pendingAction.status, setupStateRole(requirement.pendingAction.status)),
    ));
  }
  return [...nodes, ...remediationNodes(requirement)];
}

export function printSetupList(result: ModuleSetupStatusResponse, json: boolean): void {
  if (json) {
    writeJson(result, { pretty: true });
    return;
  }
  const visibility = line(
    plain("Visibility: "),
    span(result.visibility, result.visibility === "full" ? "success" : "warn"),
    ...(result.visibility === "metadata"
      ? [plain(" — action, config, and secret details are hidden by scope policy")]
      : result.visibility === "hidden"
        ? [plain(" — setup requirements are hidden by scope policy")]
        : []),
  );
  if (result.visibility === "hidden") {
    print(visibility);
    return;
  }
  if (result.requirements.length === 0) {
    print(stack(visibility, line(plain("No setup requirements declared."))));
    return;
  }
  const requirements = result.requirements.map((requirement) =>
    group(
      `${requirement.moduleName}/${requirement.requirementId}`,
      stack(...requirementNodes(requirement)),
    )
  );
  print(stack(visibility, ...requirements));
}
