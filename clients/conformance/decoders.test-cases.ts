/**
 * Test-runner-agnostic case definitions for the cross-client conformance
 * decoders. Each case names a top-level fixture path, the decoder under
 * test, and an `expectThrow` flag for the negative cases.
 *
 * Web (Vitest) and mobile (Jest) both consume this list so each surface
 * is exercised in lockstep across both clients without duplicating the
 * case enumeration in three places.
 */

import {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
  parseAttentionResponse,
  parseCaptureResult,
  parseDigestResponse,
  parseHistorySearchResponse,
  parseKnowledgeSearchResponse,
  parseMemorySearchResponse,
  parseProjectRegistryProjection,
  parseRecallResult,
  parseRetractResult,
  parseScopeRegistryProjection,
  parseScopePolicyRouteResponse,
  parseSetupStatusResponse,
  parseTasksSearchResponse,
  parseUnknownProjectError,
  parseUiSurfaceBundle,
  parseVoiceFailure,
  parseVoiceTranscribeResult,
} from "./decoders";

export type ConformanceCase = {
  name: string;
  /** Dot-separated path into the canonical fixture object. */
  path: string;
  /** Decoder under test; receives the resolved subtree. */
  parse: (raw: unknown) => unknown;
  /** When true, the case verifies the decoder rejects unknown discriminators. */
  expectThrow?: true;
  /** Optional positive-arm assertion run after decoding. */
  assertPositive?: (decoded: unknown) => void;
};

export const CONFORMANCE_CASES: ConformanceCase[] = [
  // project registry projection
  {
    name: "projects: cross-project registry projection",
    path: "projects",
    parse: parseProjectRegistryProjection,
    assertPositive: (decoded) => {
      const p = decoded as {
        defaultProjectId: string;
        projects: Array<{ projectId: string; displayName: string }>;
      };
      if (p.projects.length !== 2) {
        throw new Error("expected 2 projects in projection");
      }
      if (
        !p.projects.some((entry) => entry.projectId === p.defaultProjectId)
      ) {
        throw new Error(
          "default projectId must match one of the listed projects",
        );
      }
    },
  },
  {
    name: "projects: identity carries projection",
    path: "identity.projects",
    parse: parseProjectRegistryProjection,
  },
  {
    name: "projects: typed unknown_project rejection",
    path: "unknownProjectError",
    parse: parseUnknownProjectError,
  },
  {
    name: "scopes: global root plus directory-backed children",
    path: "scopes",
    parse: parseScopeRegistryProjection,
    assertPositive: (decoded) => {
      const p = decoded as {
        rootScopeId: string;
        defaultScopeId: string;
        scopes: Array<{ scopeId: string; parentScopeId?: string; directoryRoot?: string }>;
      };
      if (p.rootScopeId !== "global") {
        throw new Error("expected global root scope");
      }
      if (!p.scopes.some((entry) => entry.scopeId === p.defaultScopeId)) {
        throw new Error("defaultScopeId must match a listed scope");
      }
      if (p.scopes.filter((entry) => entry.directoryRoot).length !== 3) {
        throw new Error("expected three directory-backed scopes");
      }
      const nested = p.scopes.find((entry) => entry.scopeId === "p-kota-fixture-feature");
      if (nested?.parentScopeId !== "p-kota-fixture-default") {
        throw new Error("expected nested feature scope under the default directory scope");
      }
    },
  },
  {
    name: "scopePolicy: resolved policy with rendered decisions",
    path: "scopePolicy.resolved",
    parse: parseScopePolicyRouteResponse,
    assertPositive: (decoded) => {
      const response = decoded as {
        policy: {
          scopeId: string;
          lineage: string[];
          directoryRoot?: string;
          channels: { blockedSources: string[]; source: { scopeId: string } };
          retention: { source: { scopeId: string } };
        };
        decisionExamples: Array<{ outcome: string; rendered: string }>;
      };
      if (response.policy.scopeId !== "p-kota-fixture-feature") {
        throw new Error("expected fixture policy for p-kota-fixture-feature");
      }
      if (response.policy.lineage.join("/") !== "global/p-kota-fixture-default/p-kota-fixture-feature") {
        throw new Error("expected nested scope policy lineage");
      }
      if (response.policy.directoryRoot !== "/Users/operator/projects/kota/feature") {
        throw new Error("expected directory root on nested scope policy");
      }
      if (!response.policy.channels.blockedSources.includes("fixture-blocked-chat")) {
        throw new Error("expected blocked channel source in fixture policy");
      }
      if (response.policy.retention.source.scopeId !== "global") {
        throw new Error("expected retention to demonstrate inherited global policy");
      }
      if (!response.decisionExamples.some((entry) => entry.outcome === "confirm")) {
        throw new Error("expected a rendered owner-confirmation decision");
      }
      if (
        !response.decisionExamples.some((entry) =>
          entry.outcome === "deny" && entry.rendered.includes("scope directory write boundary")
        )
      ) {
        throw new Error("expected a rendered local write-boundary denial");
      }
      if (!response.decisionExamples.every((entry) => entry.rendered.includes("->"))) {
        throw new Error("expected rendered decision text");
      }
    },
  },
  {
    name: "scopePolicy: unknown decision outcome rejected",
    path: "scopePolicy.negative_unknownOutcome",
    parse: parseScopePolicyRouteResponse,
    expectThrow: true,
  },
  {
    name: "setupRequirements: status arms for config, secret, oauth, and browser profile",
    path: "setupRequirements.status",
    parse: parseSetupStatusResponse,
    assertPositive: (decoded) => {
      const r = decoded as {
        requirements: Array<{ kind: string; state: string; sensitivity: string }>;
      };
      if (r.requirements.length !== 6) {
        throw new Error("expected 6 setup requirement statuses");
      }
      if (!r.requirements.some((entry) => entry.kind === "oauth" && entry.state === "pending")) {
        throw new Error("expected pending OAuth setup arm");
      }
      if (!r.requirements.some((entry) => entry.state === "expired")) {
        throw new Error("expected expired setup arm");
      }
      if (!r.requirements.some((entry) => entry.state === "revoked")) {
        throw new Error("expected revoked setup arm");
      }
      if (!r.requirements.some((entry) => entry.sensitivity === "browser-profile")) {
        throw new Error("expected browser-profile sensitivity arm");
      }
    },
  },
  {
    name: "setupRequirements: unknown state rejected",
    path: "setupRequirements.negative_unknownState",
    parse: parseSetupStatusResponse,
    expectThrow: true,
  },
  {
    name: "setupRequirements: unknown kind rejected",
    path: "setupRequirements.negative_unknownKind",
    parse: parseSetupStatusResponse,
    expectThrow: true,
  },
  {
    name: "setupRequirements: unknown setup mode rejected",
    path: "setupRequirements.negative_unknownSetupMode",
    parse: parseSetupStatusResponse,
    expectThrow: true,
  },
  {
    name: "setupRequirements: unknown field value kind rejected",
    path: "setupRequirements.negative_unknownFieldValueKind",
    parse: parseSetupStatusResponse,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: Status and Inbox operator surfaces",
    path: "uiSurfaces.statusInbox",
    parse: parseUiSurfaceBundle,
    assertPositive: (decoded) => {
      const bundle = decoded as {
        protocolVersion: string;
        surfaces: Array<{
          surfaceId: string;
          intent: string;
          nodes: Array<{
            kind: string;
            target?: { kind: string; path?: string; url?: string; surfaceId?: string };
            tabs?: Array<{ id: string; nodes: Array<{ kind: string }> }>;
            streamId?: string;
            source?: { kind: string; path: string; eventTypes: string[] };
          }>;
          actions: Array<{
            actionId: string;
            operation: { kind: string; method?: string; path?: string; namespace?: string };
            effect: string;
            confirmation: { mode: string };
            readiness: { state: string; reason?: string; moduleName?: string; requirementId?: string };
            parameters?: {
              fields: Array<{ id: string; input: string }>;
              schema: {
                required?: string[];
                properties: Record<string, unknown> & {
                  name?: unknown;
                  tags?: unknown;
                  payload?: unknown;
                  workflow?: unknown;
                  autonomy_mode?: unknown;
                  autonomyMode?: unknown;
                  session_id?: unknown;
                  conversation_id?: unknown;
                  preset?: unknown;
                  model?: unknown;
                  effort?: unknown;
                };
              };
            };
            conditions?: Array<{ kind: string; state: string }>;
            result: { errors: Array<{ reason: string }> };
          }>;
        }>;
      };
      if (bundle.protocolVersion !== "ui.surface.v1") {
        throw new Error("expected ui.surface.v1 protocol");
      }
      if (bundle.surfaces.map((surface) => surface.intent).join(",") !== "Status,Inbox,Work,Setup") {
        throw new Error("expected Status, Inbox, Work, and Setup intent surfaces");
      }
      const inbox = bundle.surfaces.find((surface) => surface.surfaceId === "inbox");
      const approvalAction = inbox?.actions.find((action) => action.actionId === "approval.open");
      if (!approvalAction) {
        throw new Error("expected inbox approval action");
      }
      if (
        approvalAction.operation.kind !== "daemon-route" ||
        approvalAction.operation.path !== "/approvals?status=pending" ||
        approvalAction.effect !== "read" ||
        approvalAction.confirmation.mode !== "none"
      ) {
        throw new Error("expected approval.open to be a typed read-only approval route action");
      }
      const demo = bundle.surfaces.find((surface) => surface.surfaceId === "operator-control");
      if (!demo) {
        throw new Error("expected operator-control demo surface");
      }
      const expectedKinds = ["metrics", "text", "link", "tabs", "table", "table", "progress", "log", "log-stream", "form", "form", "form", "table", "table", "action-list"];
      if (demo.nodes.map((node) => node.kind).join(",") !== expectedKinds.join(",")) {
        throw new Error("expected operator-control to exercise shared semantic node kinds");
      }
      const link = demo.nodes.find((node) => node.kind === "link");
      if (link?.target?.kind !== "daemon-route" || link.target.path !== "/ui/surfaces") {
        throw new Error("expected link node to target the shared UI daemon route");
      }
      const tabs = demo.nodes.find((node) => node.kind === "tabs");
      if (tabs?.tabs?.map((tab) => tab.id).join(",") !== "requests,runs,setup") {
        throw new Error("expected tabs node to expose request, run, and setup panes");
      }
      const logStream = demo.nodes.find((node) => node.kind === "log-stream");
      if (
        logStream?.streamId !== "daemon-events" ||
        logStream.source?.kind !== "sse" ||
        logStream.source.path !== "/events" ||
        !logStream.source.eventTypes.includes("workflow.run.completed")
      ) {
        throw new Error("expected log-stream node to declare its SSE source");
      }
      const launch = demo.actions.find((action) => action.actionId === "workflow.launch");
      if (!launch || launch.operation.path !== "/workflow/trigger") {
        throw new Error("expected workflow.launch daemon route action");
      }
      if (launch.confirmation.mode !== "required" || launch.readiness.state !== "ready") {
        throw new Error("expected workflow.launch confirmation and readiness metadata");
      }
      if (launch.parameters?.schema.required?.join(",") !== "name") {
        throw new Error("expected workflow.launch typed parameter schema");
      }
      if (
        !launch.parameters?.schema.properties.name ||
        !launch.parameters.schema.properties.tags ||
        !launch.parameters.schema.properties.payload ||
        launch.parameters.schema.properties.workflow
      ) {
        throw new Error("expected workflow.launch to use daemon trigger parameters");
      }
      if (!launch.result.errors.some((entry) => entry.reason === "workflow-disabled")) {
        throw new Error("expected workflow.launch typed error outcomes");
      }
      const session = demo.actions.find((action) => action.actionId === "session.launch");
      if (session?.parameters?.schema.required?.join(",") !== "autonomy_mode") {
        throw new Error("expected session.launch typed parameter schema");
      }
      if (
        !session.parameters?.schema.properties.autonomy_mode ||
        !session.parameters.schema.properties.session_id ||
        !session.parameters.schema.properties.conversation_id ||
        session.parameters.schema.properties.autonomyMode
      ) {
        throw new Error("expected session.launch to use daemon session parameters");
      }
      const defaults = demo.actions.find((action) => action.actionId === "launch.defaults.configure");
      if (!defaults || !defaults.parameters || defaults.parameters.schema.required?.join(",") !== "preset,model,effort") {
        throw new Error("expected launch defaults typed parameter schema");
      }
      if (
        !defaults.parameters.schema.properties.preset ||
        !defaults.parameters.schema.properties.model ||
        !defaults.parameters.schema.properties.effort ||
        defaults.readiness.state !== "disabled" ||
        defaults.readiness.reason !== "controller-unavailable"
      ) {
        throw new Error("expected launch defaults to expose preset/model/effort controls with recorded limitation");
      }
      const setup = demo.actions.find((action) => action.actionId === "setup.oauth.start");
      if (
        setup?.readiness.state !== "needs-setup" ||
        setup.readiness.moduleName !== "google-workspace" ||
        setup.readiness.requirementId !== "oauth-credentials"
      ) {
        throw new Error("expected setup OAuth action to carry needs-setup readiness metadata");
      }
      const setupSurface = bundle.surfaces.find((surface) => surface.surfaceId === "setup");
      if (!setupSurface) {
        throw new Error("expected dedicated setup surface");
      }
      if (!setupSurface.nodes.some((node) => node.kind === "form")) {
        throw new Error("expected setup surface to render setup forms");
      }
      const secretAction = setupSurface.actions.find((action) =>
        action.actionId === "setup.telegram.bot-credentials.store-secret"
      );
      if (
        !secretAction ||
        secretAction.operation.kind !== "daemon-route" ||
        secretAction.operation.path !== "/setup/requirements/telegram/bot-credentials/secret" ||
        secretAction.parameters?.fields[0]?.input !== "secret"
      ) {
        throw new Error("expected setup secret action to use typed secret input and setup route");
      }
      const configAction = setupSurface.actions.find((action) =>
        action.actionId === "setup.google-workspace.oauth-config.submit-form"
      );
      if (configAction?.parameters?.schema.properties["client-id-ref"] === undefined) {
        throw new Error("expected setup form action to carry non-sensitive config field schema");
      }
      if (!setupSurface.actions.some((action) =>
        action.conditions?.some((condition) => condition.kind === "setup" && condition.state === "expired")
      )) {
        throw new Error("expected setup actions to cover expired requirement state");
      }
      if (!setupSurface.actions.some((action) =>
        action.conditions?.some((condition) => condition.kind === "setup" && condition.state === "revoked")
      )) {
        throw new Error("expected setup actions to cover revoked requirement state");
      }
    },
  },
  {
    name: "uiSurfaces: unknown node kind rejected",
    path: "uiSurfaces.negative_unknownNodeKind",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown action effect rejected",
    path: "uiSurfaces.negative_unknownActionEffect",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown operation kind rejected",
    path: "uiSurfaces.negative_unknownOperationKind",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown readiness state rejected",
    path: "uiSurfaces.negative_unknownReadinessState",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown attachment point rejected",
    path: "uiSurfaces.negative_unknownAttachmentKind",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown link target rejected",
    path: "uiSurfaces.negative_unknownLinkTargetKind",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown log stream source rejected",
    path: "uiSurfaces.negative_unknownLogStreamSourceKind",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  {
    name: "uiSurfaces: unknown setup condition state rejected",
    path: "uiSurfaces.negative_unknownSetupConditionState",
    parse: parseUiSurfaceBundle,
    expectThrow: true,
  },
  // recall
  {
    name: "recall: success across knowledge/memory/history/tasks/answer sources",
    path: "recall.successMixedSources",
    parse: parseRecallResult,
    assertPositive: (decoded) => {
      const r = decoded as { ok: true; hits: Array<{ source: string }> };
      if (!r.ok || r.hits.length !== 5) {
        throw new Error("expected 5-hit ok result");
      }
      if (!r.hits.some((h) => h.source === "answer")) {
        throw new Error(
          "expected the mixed-source arm to include a source: 'answer' hit",
        );
      }
    },
  },
  {
    name: "recall: success with answer hit carrying failure arm",
    path: "recall.successAnswerHitFailureArm",
    parse: parseRecallResult,
    assertPositive: (decoded) => {
      const r = decoded as {
        ok: true;
        hits: Array<{ source: string; result?: { ok: boolean } }>;
      };
      if (!r.ok || r.hits.length !== 1 || r.hits[0]!.source !== "answer") {
        throw new Error("expected single answer-hit result");
      }
      if (r.hits[0]!.result?.ok !== false) {
        throw new Error("expected nested answer-hit result to be ok=false");
      }
    },
  },
  {
    name: "recall: semantic_unavailable failure arm",
    path: "recall.semanticUnavailable",
    parse: parseRecallResult,
  },
  {
    name: "recall: unknown source rejected",
    path: "recall.negative_unknownSource",
    parse: parseRecallResult,
    expectThrow: true,
  },
  {
    name: "recall: unknown nested answer-hit result reason rejected",
    path: "recall.negative_unknownAnswerResultReason",
    parse: parseRecallResult,
    expectThrow: true,
  },
  {
    name: "recall: unknown reason rejected",
    path: "recall.negative_unknownReason",
    parse: parseRecallResult,
    expectThrow: true,
  },

  // answer
  {
    name: "answer: success with citations across knowledge/memory/answer sources",
    path: "answer.success",
    parse: parseAnswerResult,
    assertPositive: (decoded) => {
      const r = decoded as {
        ok: true;
        citations: Array<{ source: string; id: string }>;
        hits: Array<{ source: string }>;
      };
      if (!r.ok || r.citations.length === 0) throw new Error("expected citations");
      if (!r.citations.some((c) => c.source === "answer")) {
        throw new Error(
          "expected the success arm to include a source: 'answer' citation",
        );
      }
      if (!r.hits.some((h) => h.source === "answer")) {
        throw new Error(
          "expected the success arm to include a matching source: 'answer' hit",
        );
      }
    },
  },
  {
    name: "answer: no_hits arm",
    path: "answer.noHits",
    parse: parseAnswerResult,
  },
  {
    name: "answer: semantic_unavailable arm",
    path: "answer.semanticUnavailable",
    parse: parseAnswerResult,
  },
  {
    name: "answer: synthesis_failed arm",
    path: "answer.synthesisFailed",
    parse: parseAnswerResult,
  },
  {
    name: "answer: unknown reason rejected",
    path: "answer.negative_unknownReason",
    parse: parseAnswerResult,
    expectThrow: true,
  },
  {
    name: "answer: unknown citation source rejected",
    path: "answer.negative_unknownCitationSource",
    parse: parseAnswerResult,
    expectThrow: true,
  },

  // answerHistory
  {
    name: "answerHistory: list with mixed ok/no_hits results",
    path: "answerHistory.list",
    parse: parseAnswerHistoryListResult,
    assertPositive: (decoded) => {
      const r = decoded as { entries: Array<unknown> };
      if (r.entries.length !== 2) throw new Error("expected 2 entries");
    },
  },
  {
    name: "answerHistory: show=found",
    path: "answerHistory.showFound",
    parse: parseAnswerHistoryShowResult,
  },
  {
    name: "answerHistory: show=not_found",
    path: "answerHistory.showNotFound",
    parse: parseAnswerHistoryShowResult,
  },
  {
    name: "answerHistory: unknown show reason rejected",
    path: "answerHistory.negative_unknownReason",
    parse: parseAnswerHistoryShowResult,
    expectThrow: true,
  },

  // capture
  {
    name: "capture: success memory",
    path: "capture.successMemory",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success knowledge",
    path: "capture.successKnowledge",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success tasks",
    path: "capture.successTasks",
    parse: parseCaptureResult,
  },
  {
    name: "capture: success inbox",
    path: "capture.successInbox",
    parse: parseCaptureResult,
  },
  {
    name: "capture: ambiguous arm with suggestions",
    path: "capture.ambiguous",
    parse: parseCaptureResult,
  },
  {
    name: "capture: no_contributors arm",
    path: "capture.noContributors",
    parse: parseCaptureResult,
  },
  {
    name: "capture: contributor_failed arm",
    path: "capture.contributorFailed",
    parse: parseCaptureResult,
  },
  {
    name: "capture: unknown target rejected",
    path: "capture.negative_unknownTarget",
    parse: parseCaptureResult,
    expectThrow: true,
  },
  {
    name: "capture: unknown reason rejected",
    path: "capture.negative_unknownReason",
    parse: parseCaptureResult,
    expectThrow: true,
  },

  // retract
  {
    name: "retract: success memory",
    path: "retract.successMemory",
    parse: parseRetractResult,
  },
  {
    name: "retract: success knowledge",
    path: "retract.successKnowledge",
    parse: parseRetractResult,
  },
  {
    name: "retract: success tasks moved to dropped",
    path: "retract.successTasks",
    parse: parseRetractResult,
  },
  {
    name: "retract: success inbox",
    path: "retract.successInbox",
    parse: parseRetractResult,
  },
  {
    name: "retract: no_contributors arm",
    path: "retract.noContributors",
    parse: parseRetractResult,
  },
  {
    name: "retract: not_found arm",
    path: "retract.notFound",
    parse: parseRetractResult,
  },
  {
    name: "retract: contributor_failed arm",
    path: "retract.contributorFailed",
    parse: parseRetractResult,
  },
  {
    name: "retract: unknown target rejected",
    path: "retract.negative_unknownTarget",
    parse: parseRetractResult,
    expectThrow: true,
  },
  {
    name: "retract: unknown reason rejected",
    path: "retract.negative_unknownReason",
    parse: parseRetractResult,
    expectThrow: true,
  },

  // semantic search
  {
    name: "knowledgeSearch: success",
    path: "knowledgeSearch.success",
    parse: parseKnowledgeSearchResponse,
  },
  {
    name: "knowledgeSearch: semantic_unavailable",
    path: "knowledgeSearch.semanticUnavailable",
    parse: parseKnowledgeSearchResponse,
  },
  {
    name: "knowledgeSearch: unknown reason rejected",
    path: "knowledgeSearch.negative_unknownReason",
    parse: parseKnowledgeSearchResponse,
    expectThrow: true,
  },
  {
    name: "memorySearch: success",
    path: "memorySearch.success",
    parse: parseMemorySearchResponse,
  },
  {
    name: "memorySearch: semantic_unavailable",
    path: "memorySearch.semanticUnavailable",
    parse: parseMemorySearchResponse,
  },
  {
    name: "memorySearch: unknown reason rejected",
    path: "memorySearch.negative_unknownReason",
    parse: parseMemorySearchResponse,
    expectThrow: true,
  },
  {
    name: "historySearch: success",
    path: "historySearch.success",
    parse: parseHistorySearchResponse,
  },
  {
    name: "historySearch: semantic_unavailable",
    path: "historySearch.semanticUnavailable",
    parse: parseHistorySearchResponse,
  },
  {
    name: "historySearch: unknown reason rejected",
    path: "historySearch.negative_unknownReason",
    parse: parseHistorySearchResponse,
    expectThrow: true,
  },
  {
    name: "historySearch: unknown conversation source rejected",
    path: "historySearch.negative_unknownSource",
    parse: parseHistorySearchResponse,
    expectThrow: true,
  },
  {
    name: "tasksSearch: success",
    path: "tasksSearch.success",
    parse: parseTasksSearchResponse,
  },
  {
    name: "tasksSearch: semantic_unavailable",
    path: "tasksSearch.semanticUnavailable",
    parse: parseTasksSearchResponse,
  },
  {
    name: "tasksSearch: unknown reason rejected",
    path: "tasksSearch.negative_unknownReason",
    parse: parseTasksSearchResponse,
    expectThrow: true,
  },

  // attention + digest + voice
  {
    name: "attention: data + items + text",
    path: "attention",
    parse: parseAttentionResponse,
  },
  {
    name: "digest: full envelope",
    path: "digest",
    parse: parseDigestResponse,
  },
  {
    name: "voice: transcribe success",
    path: "voice.transcribeSuccess",
    parse: parseVoiceTranscribeResult,
  },
  {
    name: "voice: transcribe failure (stt-unavailable)",
    path: "voice.transcribeFailureSttUnavailable",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: transcribe failure (stt-failed)",
    path: "voice.transcribeFailureSttFailed",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: synthesize failure (tts-unavailable)",
    path: "voice.synthesizeFailureTtsUnavailable",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: synthesize failure (tts-format-unsupported with supported list)",
    path: "voice.synthesizeFailureTtsFormatUnsupported",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
  },
  {
    name: "voice: unknown failure code rejected",
    path: "voice.negative_unknownCode",
    parse: (raw) => parseVoiceFailure(raw as Record<string, unknown>),
    expectThrow: true,
  },
];

/** Resolve a dotted path through the canonical fixture tree. */
export function readFixturePath(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current === null || typeof current !== "object") {
      throw new Error(`fixture path ${path} broke at segment "${key}"`);
    }
    const val = (current as Record<string, unknown>)[key];
    if (val === undefined) {
      throw new Error(`fixture path ${path} missing segment "${key}"`);
    }
    return val;
  }, tree);
}
