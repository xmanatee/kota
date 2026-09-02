import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import {
  type EvidenceDataClass,
  type EvidenceJsonObject,
  type EvidenceJsonValue,
  type EvidenceRedactionMarker,
  projectEvidenceJsonObject,
  projectEvidenceJsonValueAsDataClass,
  projectEvidenceText,
} from "#core/evidence/policy.js";
import { safeJsonStringify } from "./run-io.js";
import { WORKFLOW_RUN_METADATA_VERSION } from "./run-metadata.js";
import type {
  WorkflowRunMetadata,
  WorkflowStepResult,
} from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

type ProjectedTextClass = Extract<
  EvidenceDataClass,
  "private-reasoning" | "provider-payload" | "tool-io"
>;

export function formatProjectedEvidenceText(
  value: EvidenceRedactionMarker | string,
): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function projectProviderPayloadText(
  text: string,
): EvidenceRedactionMarker | string {
  return projectEvidenceText(text, "internal-storage", "provider-payload");
}

export function projectToolIoText(
  text: string,
): EvidenceRedactionMarker | string {
  return projectEvidenceText(text, "internal-storage", "tool-io");
}

export function projectWorkflowRunTriggerForStorage(
  trigger: WorkflowRunTrigger,
): EvidenceJsonObject {
  return projectSerializableObject(trigger);
}

export function projectWorkflowRunMetadataForStorage(
  metadata: WorkflowRunMetadata,
): EvidenceJsonObject {
  const projected = projectSerializableObject(metadata);
  projected.metadataVersion = WORKFLOW_RUN_METADATA_VERSION;
  projected.trigger = projectWorkflowRunTriggerForStorage(metadata.trigger);
  projected.steps = metadata.steps.map(projectWorkflowStepResultForStorage);
  return projected;
}

export function projectWorkflowStepResultForStorage(
  result: WorkflowStepResult,
): EvidenceJsonObject {
  const projected = projectSerializableObject(result);
  if (result.type !== "agent") return projected;
  const output = projected.output;
  if (!isEvidenceJsonObject(output)) return projected;
  if (typeof output.content === "string") {
    output.content = projectEvidenceJsonValueAsDataClass(
      output.content,
      "internal-storage",
      "provider-payload",
    );
  }
  return projected;
}

export function projectKotaAgentMessageForStorage(
  message: KotaAgentMessage,
): EvidenceJsonObject {
  switch (message.type) {
    case "text":
      return {
        ...agentMessageEnvelope(message),
        text: formatProjectedEvidenceText(projectText(message.text, "provider-payload")),
      };
    case "thinking":
      return {
        ...agentMessageEnvelope(message),
        thinking: formatProjectedEvidenceText(projectText(message.thinking, "private-reasoning")),
      };
    case "tool_call":
      return {
        ...agentMessageEnvelope(message),
        toolUseId: message.toolUseId,
        toolName: message.toolName,
        input: projectText(safeJsonStringify(message.input), "tool-io"),
      };
    case "tool_result":
      return {
        ...agentMessageEnvelope(message),
        toolUseId: message.toolUseId,
        isError: message.isError,
        ...(message.resultContentProvenance !== undefined
          ? { resultContentProvenance: message.resultContentProvenance }
          : {}),
        content: formatProjectedEvidenceText(
          projectText(
            typeof message.content === "string"
              ? message.content
              : safeJsonStringify(message.content),
            "tool-io",
          ),
        ),
      };
    case "status": {
      const projected: EvidenceJsonObject = {
        ...agentMessageEnvelope(message),
        category: message.category,
      };
      if (message.description !== undefined) {
        projected.description = formatProjectedEvidenceText(
          projectText(message.description, "provider-payload"),
        );
      }
      if (message.toolName !== undefined) projected.toolName = message.toolName;
      if (message.commandTrace !== undefined) {
        projected.commandTrace = {
          algorithm: message.commandTrace.algorithm,
          exactDigests: [...message.commandTrace.exactDigests],
          prefixDigests: [...message.commandTrace.prefixDigests],
        };
      }
      if (message.output !== undefined) {
        projected.output = message.output.map((entry) =>
          formatProjectedEvidenceText(projectText(entry, "provider-payload"))
        );
      }
      if (message.text !== undefined) {
        projected.text = formatProjectedEvidenceText(
          projectText(message.text, "provider-payload"),
        );
      }
      return projected;
    }
    case "result": {
      const projected: EvidenceJsonObject = {
        ...agentMessageEnvelope(message),
        isError: message.isError,
      };
      if (message.text !== undefined) {
        projected.text = formatProjectedEvidenceText(
          projectText(message.text, "provider-payload"),
        );
      }
      if (message.subtype !== undefined) projected.subtype = message.subtype;
      if (message.numTurns !== undefined) projected.numTurns = message.numTurns;
      projected.usage = message.usage;
      return projected;
    }
    case "raw":
      return {
        ...agentMessageEnvelope(message),
        adapter: message.adapter,
        payload: projectText(safeJsonStringify(message.payload), "provider-payload"),
      };
  }
}

function projectText(
  text: string,
  dataClass: ProjectedTextClass,
): EvidenceRedactionMarker | string {
  return projectEvidenceText(text, "internal-storage", dataClass);
}

function agentMessageEnvelope(message: KotaAgentMessage): EvidenceJsonObject {
  return {
    type: message.type,
    ...(message.sessionId !== undefined ? { sessionId: message.sessionId } : {}),
  };
}

function projectSerializableObject(value: object): EvidenceJsonObject {
  return projectEvidenceJsonObject(
    JSON.parse(safeJsonStringify(value)) as EvidenceJsonObject,
    "internal-storage",
  );
}

function isEvidenceJsonObject(value: EvidenceJsonValue | undefined): value is EvidenceJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
