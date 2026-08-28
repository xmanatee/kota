import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DAEMON_CONTRACT_VERSION,
  DAEMON_ROUTE_GRAPH,
  DAEMON_WIRE_ROOT_TYPE,
  DAEMON_WIRE_SOURCE,
} from "./daemon-contract-graph.mjs";
import { buildDaemonContractSchema } from "./daemon-contract-schema.mjs";
import { generateDaemonTypeScriptBinding } from "./daemon-contract-typescript.mjs";
import { generateKotaClientAggregate } from "./kota-client-typescript.mjs";
import { generateSwiftBinding } from "./ui-surface-swift.mjs";

const DEFAULT_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "clients/conformance/daemon-contract-bindings.manifest.json";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseArguments(argv) {
  let root = DEFAULT_ROOT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") { check = true; continue; }
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--root requires a path");
      root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { root, check };
}

function expectedArtifacts(root) {
  const schema = buildDaemonContractSchema(root);
  const typeScript = generateDaemonTypeScriptBinding(schema);
  const artifacts = new Map([
    ["schema/daemon-contract.schema.json", `${JSON.stringify(schema, null, 2)}\n`],
    ["clients/conformance/daemon-contract.generated.ts", typeScript],
    ["src/client/daemon-contract.generated.ts", typeScript],
    ["clients/apple/Sources/KotaShared/Generated/DaemonContract.generated.swift", generateSwiftBinding(schema, {
      command: "pnpm build:client-bindings",
      source: DAEMON_WIRE_SOURCE,
      aliases: [
        "typealias AttentionResponse = RenderedAttention",
        "typealias CapabilityMetaValue = CapabilityReadinessMetaValue",
        "typealias ConfiguredScopeEntry = ConfiguredScope",
        "typealias DigestAgingOperatorCaptureItem = AgingOperatorCaptureItem",
        "typealias DigestBlockedPromoterMoveItem = BlockedPromoterMoveItem",
        "typealias DigestBuilderCommitItem = BuilderCommitItem",
        "typealias DigestDecomposerSplitItem = DecomposerSplitItem",
        "typealias DigestExplorerAdditionItem = ExplorerAdditionItem",
        "typealias DigestFailedRunItem = FailedRunItem",
        "typealias DigestPendingOwnerQuestionItem = PendingOwnerQuestionItem",
        "typealias DigestQueueCountDelta = QueueDeltaDelta",
        "typealias DigestQueueCounts = QueueCounts",
        "typealias DigestQueueDelta = QueueDelta",
        "typealias HistorySearchResponse = HistorySearchResult",
        "typealias KnowledgeSearchResponse = KnowledgeSearchResult",
        "typealias MemoryEntry = MemoryListEntry",
        "typealias MemorySearchResponse = MemorySearchResult",
        "typealias RecallSearchResponse = RecallResult",
        "typealias SetupCapabilityStatus = ModuleSetupCapabilityStatus",
        "typealias SetupConfigFieldStatus = ModuleSetupConfigFieldStatus",
        "typealias SetupFormField = ModuleSetupFormField",
        "typealias SetupPendingAction = ModuleSetupPendingAction",
        "typealias SetupRequirementStatus = ModuleSetupRequirementStatus",
        "typealias SetupScope = ModuleSetupScope",
        "typealias SetupSecretRefStatus = ModuleSetupSecretStatus",
        "typealias SetupSensitivity = ModuleSetupSensitivity",
        "typealias SetupStatusResponse = ModuleSetupStatusResponse",
        "typealias SetupRequirementState = ModuleSetupStatusState",
        "typealias TasksSearchResponse = RepoTaskSearchResult",
      ],
    })],
    ["src/client/kota-client.generated.ts", generateKotaClientAggregate()],
  ]);
  const canonicalSources = [
    DAEMON_WIRE_SOURCE,
    "scripts/daemon-contract-graph.mjs",
  ].map((path) => ({ path, sha256: sha256(readFileSync(resolve(root, path), "utf8")) }));
  const manifest = {
    version: 1,
    protocol: DAEMON_CONTRACT_VERSION,
    rootType: DAEMON_WIRE_ROOT_TYPE,
    canonicalSources,
    routes: DAEMON_ROUTE_GRAPH.map(({ id, method, path, type, parser }) => ({ id, method, path, type, parser })),
    outputs: [...artifacts.entries()].map(([path, content]) => ({ path, sha256: sha256(content) })),
  };
  artifacts.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return artifacts;
}

function checkArtifacts(root, artifacts) {
  const stale = [];
  for (const [path, content] of artifacts) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== content) stale.push(path);
  }
  if (stale.length > 0) {
    throw new Error(`Generated daemon contract bindings are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun pnpm build:client-bindings.`);
  }
}

function writeArtifacts(root, artifacts) {
  for (const [path, content] of artifacts) {
    const absolute = resolve(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== content) writeFileSync(absolute, content);
  }
}

const { root, check } = parseArguments(process.argv.slice(2));
const artifacts = expectedArtifacts(root);
if (check) checkArtifacts(root, artifacts);
else writeArtifacts(root, artifacts);
