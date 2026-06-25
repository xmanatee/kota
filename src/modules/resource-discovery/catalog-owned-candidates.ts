import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type { SkillSummary } from "#modules/skill-ops/client.js";
import {
  capabilityText,
  contributionText,
  manifestEffectMetadata,
  manifestRisk,
  mostSignificantManifestEffect,
  risk,
} from "./catalog-effects.js";
import { candidate, compact, metadata } from "./catalog-helpers.js";
import { moduleReadiness, toolReadiness } from "./catalog-readiness.js";
import type { ResourceDiscoveryCandidate } from "./catalog-types.js";

export function moduleCandidates(
  summaries: readonly ModuleSummary[],
): ResourceDiscoveryCandidate[] {
  return summaries.map((summary) => {
    const effects = summary.manifest?.effects ?? [];
    const primaryEffect = mostSignificantManifestEffect(effects);
    return candidate({
      kind: "module",
      id: `module:${summary.name}`,
      name: summary.name,
      description: summary.description ?? `KOTA module ${summary.name}.`,
      ownerModule: summary.name,
      readiness: moduleReadiness(summary, "read_only"),
      inspectPath: `kota module inspect ${summary.name}`,
      accessHint: "Inspect module contributions before using a resource it owns.",
      tags: [summary.source],
      risk: manifestRisk(primaryEffect),
      metadata: metadata({
        tools: summary.toolNames.length,
        workflows: summary.workflowNames.length,
        channels: summary.channelNames.length,
        skills: summary.skillNames.length,
        agents: summary.agentNames.length,
        ...manifestEffectMetadata(effects),
      }),
      extraFields: [
        { label: "capabilities", text: capabilityText(summary.manifest), weight: 3 },
        { label: "contributions", text: contributionText(summary), weight: 2 },
      ],
    });
  });
}

export function toolCandidates(
  tools: readonly KotaTool[],
  effects: ReadonlyMap<string, ToolEffect>,
  toolOwners: ReadonlyMap<string, ModuleSummary>,
): ResourceDiscoveryCandidate[] {
  return tools.map((tool) => {
    const owner = toolOwners.get(tool.name);
    const effect = effects.get(tool.name);
    return candidate({
      kind: "tool",
      id: `tool:${tool.name}`,
      name: tool.name,
      description: tool.description,
      ownerModule: owner?.name ?? "core",
      readiness: toolReadiness(owner, tool.name, effect),
      inspectPath: `tool:${tool.name}`,
      accessHint: `Call the agent tool "${tool.name}" only through normal tool policy and guardrails.`,
      risk: risk(effect),
      metadata: metadata({
        effectKind: effect?.kind ?? "unspecified",
        effectScope: effect?.scope ?? "unspecified",
        openWorld: effect?.openWorld ?? false,
      }),
      extraFields: [
        { label: "capabilities", text: capabilityText(owner?.manifest), weight: 2 },
      ],
    });
  });
}

export function skillCandidates(
  skills: readonly SkillSummary[],
  summariesByModule: ReadonlyMap<string, ModuleSummary>,
): ResourceDiscoveryCandidate[] {
  return skills.map((skill) => {
    const owningSummary = skill.sourceType === "module"
      ? summariesByModule.get(skill.source)
      : undefined;
    const ownerModule = skill.sourceType === "module" ? skill.source : "skill-ops";
    const readiness = skill.status === "shadowed"
      ? {
          status: "unavailable" as const,
          reason: "skill_shadowed",
          message: `Imported skill is shadowed by ${skill.shadowedBy}.`,
        }
      : skill.sourceType === "module"
        ? moduleReadiness(owningSummary, "read_only")
        : {
            status: "read_only" as const,
            message:
              "Imported skill metadata is inspectable; imported skills load only when selected explicitly.",
          };
    const activationHint = skill.activation === "explicit"
      ? "Select explicitly by skill name; imported skills are not included in broad skill sets."
      : "Resolve through normal agent skill loading.";
    return candidate({
      kind: "skill",
      id: `skill:${skill.sourceType}:${skill.name}`,
      name: skill.name,
      description: skill.description ?? `Skill guidance at ${skill.promptPath}.`,
      ownerModule,
      readiness,
      inspectPath: skill.promptPath,
      accessHint: `${activationHint} Use the skill loading surface instead of copying prompt files directly.`,
      tags: [
        skill.sourceType,
        skill.status,
        skill.activation,
        ...(skill.roles ?? []),
      ],
      metadata: metadata({
        source: skill.source,
        sourceType: skill.sourceType,
        status: skill.status,
        activation: skill.activation,
        promptPath: skill.promptPath,
        ...(skill.provenance !== undefined && { provenance: skill.provenance }),
        ...(skill.resourceSummary !== undefined && { resourceSummary: skill.resourceSummary }),
        ...(skill.shadowedBy !== undefined && { shadowedBy: skill.shadowedBy }),
      }),
      extraFields: [
        { label: "source", text: skill.source, weight: 2 },
        { label: "resources", text: skill.resourceSummary ?? "", weight: 1 },
        { label: "provenance", text: skill.provenance ?? "", weight: 1 },
        { label: "capabilities", text: capabilityText(owningSummary?.manifest), weight: 2 },
      ],
    });
  });
}

export function agentCandidates(
  summaries: readonly ModuleSummary[],
): ResourceDiscoveryCandidate[] {
  return summaries.flatMap((summary) =>
    summary.agents.map((agent) =>
      candidate({
        kind: "agent",
        id: `agent:${agent.name}`,
        name: agent.name,
        description: agent.role,
        ownerModule: summary.name,
        readiness: moduleReadiness(summary, "ready"),
        inspectPath: `kota agent inspect ${agent.name}`,
        accessHint:
          "Use registered-agent handoff or workflow steps; do not bypass the agent tool policy.",
        tags: agent.skills === "all" ? ["all-skills"] : agent.skills ?? [],
        metadata: metadata({
          model: agent.model,
          effort: agent.effort,
          writeScope: agent.writeScope.length === 0 ? "unrestricted" : agent.writeScope.join(","),
        }),
        extraFields: [
          { label: "prompt", text: agent.promptPath, weight: 1 },
          {
            label: "tools",
            text: compact([
              agent.tools?.allowed?.join(" ") ?? "",
              agent.tools?.disallowed?.join(" ") ?? "",
            ]),
            weight: 1,
          },
          { label: "capabilities", text: capabilityText(summary.manifest), weight: 2 },
        ],
      })
    )
  );
}
