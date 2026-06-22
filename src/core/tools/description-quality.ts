import type {
  KotaTool,
  KotaToolInputSchema,
  KotaToolOutputSchema,
} from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import {
  extractExplicitFieldReferences,
  hasNegativeGuidance,
  hasPurposeVerb,
  isGenericDescription,
  mentionsInputExpectation,
  mentionsOutputExpectation,
  normalizeDescription,
  schemaPropertyNames,
  wordsIn,
} from "./description-quality-rules.js";
import type { McpToolAnnotations, ToolEffect } from "./effect.js";

export type ToolDescriptionQualitySource = "local" | "remote-mcp";

export type ToolDescriptionQualityDiagnosticCode =
  | "description-missing"
  | "description-too-short"
  | "description-generic"
  | "missing-purpose"
  | "effect-boundary-missing"
  | "io-expectation-missing"
  | "negative-guidance-missing"
  | "schema-mismatch";

export type ToolDescriptionQualityDiagnostic = {
  code: ToolDescriptionQualityDiagnosticCode;
  message: string;
};

export type ToolDescriptionQualityReport = {
  source: ToolDescriptionQualitySource;
  toolName: string;
  diagnostics: readonly ToolDescriptionQualityDiagnostic[];
  serverConfigName?: string;
  serverDisplayName?: string;
  declarationFingerprint?: string;
};

export type LocalToolDescriptionQualityInput = {
  tool: KotaTool;
  effect?: ToolEffect;
};

export type RemoteMcpToolDescriptionQualityInput = {
  name: string;
  description?: string;
  inputSchema: KotaToolInputSchema;
  outputSchema?: KotaToolOutputSchema;
  annotations?: McpToolAnnotations;
};

type AnalyzerInput = {
  source: ToolDescriptionQualitySource;
  toolName: string;
  description?: string;
  inputSchema: KotaToolInputSchema;
  outputSchema?: KotaToolOutputSchema;
  effect?: ToolEffect;
  annotations?: McpToolAnnotations;
};

const MAX_DIAGNOSTICS_PER_TOOL = 6;

export function analyzeToolDefDescriptionQuality(
  toolDef: Pick<ToolDef, "tool" | "effect">,
): ToolDescriptionQualityDiagnostic[] {
  return analyzeLocalToolDescriptionQuality({
    tool: toolDef.tool,
    effect: toolDef.effect,
  });
}

export function analyzeLocalToolDescriptionQuality(
  input: LocalToolDescriptionQualityInput,
): ToolDescriptionQualityDiagnostic[] {
  return analyzeDescriptionQuality({
    source: "local",
    toolName: input.tool.name,
    description: input.tool.description,
    inputSchema: input.tool.input_schema,
    ...(input.tool.output_schema ? { outputSchema: input.tool.output_schema } : {}),
    ...(input.effect ? { effect: input.effect } : {}),
  });
}

export function analyzeRemoteMcpToolDescriptionQuality(
  tool: RemoteMcpToolDescriptionQualityInput,
): ToolDescriptionQualityDiagnostic[] {
  return analyzeDescriptionQuality({
    source: "remote-mcp",
    toolName: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  });
}

export function localToolDescriptionQualityReport(
  input: LocalToolDescriptionQualityInput,
): ToolDescriptionQualityReport {
  return {
    source: "local",
    toolName: input.tool.name,
    diagnostics: analyzeLocalToolDescriptionQuality(input),
  };
}

export function remoteMcpToolDescriptionQualityReport(input: {
  serverConfigName: string;
  serverDisplayName: string;
  tool: RemoteMcpToolDescriptionQualityInput;
  declarationFingerprint: string;
}): ToolDescriptionQualityReport {
  return {
    source: "remote-mcp",
    toolName: input.tool.name,
    serverConfigName: input.serverConfigName,
    serverDisplayName: input.serverDisplayName,
    declarationFingerprint: input.declarationFingerprint,
    diagnostics: analyzeRemoteMcpToolDescriptionQuality(input.tool),
  };
}

function analyzeDescriptionQuality(
  input: AnalyzerInput,
): ToolDescriptionQualityDiagnostic[] {
  const diagnostics: ToolDescriptionQualityDiagnostic[] = [];
  const description = normalizeDescription(input.description);

  if (!description) {
    diagnostics.push({
      code: "description-missing",
      message: "Description is missing; agents cannot infer the tool's purpose.",
    });
    addEffectBoundaryDiagnostic(diagnostics, input);
    return diagnostics.slice(0, MAX_DIAGNOSTICS_PER_TOOL);
  }

  const words = wordsIn(description);
  if (words.length < 7) {
    diagnostics.push({
      code: "description-too-short",
      message: "Description is too short for reliable tool selection.",
    });
  }

  if (isGenericDescription(description, words)) {
    diagnostics.push({
      code: "description-generic",
      message: "Description uses generic tool wording without a concrete purpose.",
    });
  }

  if (!hasPurposeVerb(words)) {
    diagnostics.push({
      code: "missing-purpose",
      message: "Description does not name a concrete action agents can select for.",
    });
  }

  addEffectBoundaryDiagnostic(diagnostics, input);
  addIoExpectationDiagnostic(diagnostics, input, description);
  addNegativeGuidanceDiagnostic(diagnostics, input, description);
  addSchemaMismatchDiagnostic(diagnostics, input, description);

  return diagnostics.slice(0, MAX_DIAGNOSTICS_PER_TOOL);
}

function addEffectBoundaryDiagnostic(
  diagnostics: ToolDescriptionQualityDiagnostic[],
  input: AnalyzerInput,
): void {
  if (input.source === "local") {
    if (!input.effect) {
      diagnostics.push({
        code: "effect-boundary-missing",
        message: "Structured effect and authority boundary metadata is missing.",
      });
    }
    return;
  }

  const annotations = input.annotations;
  if (
    !annotations ||
    (
      annotations.readOnlyHint === undefined &&
      annotations.destructiveHint === undefined &&
      annotations.idempotentHint === undefined &&
      annotations.openWorldHint === undefined
    )
  ) {
    diagnostics.push({
      code: "effect-boundary-missing",
      message: "MCP annotations do not advertise read-only, destructive, idempotency, or open-world hints.",
    });
  }
}

function addIoExpectationDiagnostic(
  diagnostics: ToolDescriptionQualityDiagnostic[],
  input: AnalyzerInput,
  description: string,
): void {
  const hasRequiredInput = (input.inputSchema.required ?? []).length > 0;
  const missingInput = hasRequiredInput && !mentionsInputExpectation(description, input.inputSchema);
  const missingOutput = input.outputSchema && !mentionsOutputExpectation(description);
  if (missingInput || missingOutput) {
    diagnostics.push({
      code: "io-expectation-missing",
      message: "Description does not explain required input or structured output expectations.",
    });
  }
}

function addNegativeGuidanceDiagnostic(
  diagnostics: ToolDescriptionQualityDiagnostic[],
  input: AnalyzerInput,
  description: string,
): void {
  if (!isHighAuthorityTool(input)) return;
  if (hasNegativeGuidance(description)) return;
  diagnostics.push({
    code: "negative-guidance-missing",
    message: "High-authority tool description lacks negative-use guidance.",
  });
}

function isHighAuthorityTool(input: AnalyzerInput): boolean {
  const normalizedName = input.toolName.toLowerCase();
  if (normalizedName.includes("delegate") || normalizedName.includes("handoff")) return true;

  if (input.source === "remote-mcp") {
    const annotations = input.annotations;
    if (!annotations) return false;
    return annotations.destructiveHint === true ||
      annotations.openWorldHint === true ||
      annotations.readOnlyHint === false;
  }

  const effect = input.effect;
  if (!effect) return false;
  return effect.kind === "destructive" ||
    effect.openWorld ||
    effect.scope === "external-network" ||
    effect.scope === "local-fs" && effect.kind !== "read" ||
    effect.scope === "operator-surface" ||
    effect.scope === "process-env";
}

function addSchemaMismatchDiagnostic(
  diagnostics: ToolDescriptionQualityDiagnostic[],
  input: AnalyzerInput,
  description: string,
): void {
  const propertyNames = new Set(schemaPropertyNames(input.inputSchema));
  const referencedFields = extractExplicitFieldReferences(description);
  const missing = referencedFields.find((field) => !propertyNames.has(field));
  if (!missing) return;
  diagnostics.push({
    code: "schema-mismatch",
    message: `Description references input field "${missing}" that is not in the input schema.`,
  });
}
