import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const out = dirname(fileURLToPath(import.meta.url));
const source = async (path) => import(pathToFileURL(join(root, path)).href);
const { AGY_MODEL_EVALUATION_SCENARIOS: scenarios } = await source("src/modules/eval-harness/agy-model-evaluation-types.ts");
const { loadFixture } = await source("src/modules/eval-harness/fixture.ts");
const { validateAgyScenarioFixtures } = await source("src/modules/eval-harness/agy-model-evaluation-fixtures.ts");
const { containedEvaluationProfiles, parseContainedEvaluationRequest } = await source("src/modules/eval-harness/contained-evaluation.ts");
const { providerEgressEndpointsFor, providerEgressEndpointLabelValue, PROVIDER_EGRESS_NETWORK_LABELS: labels } = await source("src/modules/eval-harness/provider-egress.ts");
const { resolveAntigravityCliCatalogModel } = await source("src/modules/antigravity-cli-agent-harness/model-readiness.ts");
const fixturesRoot = join(root, "src/modules/eval-harness/fixtures");
const fixtures = scenarios.map(s => loadFixture(fixturesRoot, s.fixtureId));
validateAgyScenarioFixtures(root, fixtures);
const write = (path, value) => writeFileSync(join(out, path), JSON.stringify(value, null, 2) + "\n");
const candidates = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro"];
const scopeRoot = "/Users/xmanatee/Desktop/mono/apps/kota";
const endpoints = providerEgressEndpointsFor("google");
const networkName = "kota-agy-benchmark-google-internal";
const profiles = { agy: {
  scopeRoots: [scopeRoot], preset: "antigravity-cli",
  fixtureIds: scenarios.map(s => s.fixtureId), candidates, maxRepeats: 3,
  timeoutMs: 21600000, cpuCores: 2, memoryMB: 4096,
  isolationBackend: { kind: "container", executable: "docker",
    image: "kota-agy-benchmark:922e062b692e",
    kotaBinaryPath: "/opt/kota/bin/kota.mjs",
    networkPolicy: { kind: "provider-egress", provider: "google",
      enforcement: { kind: "docker-internal-proxy", networkName, proxyUrl: "http://google-proxy:3128" } }
  }
}};
containedEvaluationProfiles(scopeRoot, { KOTA_EVAL_CONTAINED_PROFILES: JSON.stringify(profiles) });
const request = parseContainedEvaluationRequest({ operation: "agy-models", profile: "agy", candidates, repeatCount: 3 });
write("setup/host-profiles.json", profiles);
write("setup/request.json", request);
write("setup/compose.json", {
  name: "kota-agy-benchmark",
  services: { "google-proxy": {
    build: { context: ".", dockerfile: "Proxy.Dockerfile" },
    image: "kota-agy-benchmark-proxy:922e062b692e",
    networks: ["candidate", "outgoing"], read_only: true,
    tmpfs: ["/tmp", "/run", "/var/log/squid", "/var/spool/squid"],
    cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
    cpus: 0.5, mem_limit: "256m"
  }},
  networks: {
    candidate: { name: networkName, internal: true, labels: {
      [labels.policy]: "provider-egress", [labels.provider]: "google",
      [labels.endpoints]: providerEgressEndpointLabelValue(endpoints)
    }},
    outgoing: { name: "kota-agy-benchmark-proxy-outgoing" }
  }
});
writeFileSync(join(out, "setup/squid.conf"), [
  "http_port 3128", "acl CONNECT method CONNECT", "acl TLS_port port 443",
  "acl provider dstdomain " + endpoints.map(e => e.host).join(" "),
  "acl private dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4 ::/128 ::1/128 fc00::/7 fe80::/10 ff00::/8",
  "http_access deny !CONNECT", "http_access deny !TLS_port",
  "http_access deny !provider", "http_access deny private",
  "http_access allow provider", "http_access deny all",
  "cache deny all", "access_log stdio:/dev/stdout", "cache_log /dev/stderr",
  "cache_store_log none", "pid_filename /tmp/squid.pid",
  "coredump_dir /tmp", "shutdown_lifetime 1 seconds", ""
].join("\n"));
write("scenarios.json", scenarios);
const snapshots = [];
function snapshot(path) {
  const input = join(root, path);
  const target = join(out, "inputs", path);
  const content = readFileSync(input);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(input, target);
  snapshots.push({ path, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length });
}
function walk(path) {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    if (entry.name === ".env" || entry.name.startsWith(".env.")) throw new Error("Environment file excluded from artifact collection");
    const child = join(path, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (entry.isFile()) snapshot(child);
    else throw new Error("Non-regular fixture input: " + child);
  }
}
for (const s of scenarios) walk("src/modules/eval-harness/fixtures/" + s.fixtureId);
for (const path of ["AGENTS.md", "docs/STANDARDS.md", "src/core/agent-harness/native-cli-workflow-rails.ts", "src/modules/eval-harness/AGENTS.md", "src/modules/antigravity-cli-agent-harness/AGENTS.md", "src/modules/antigravity-cli-agent-harness/provider-egress.ts", "src/core/model/preset.ts"]) snapshot(path);
write("input-manifest.json", snapshots);
const observedAt = new Date().toISOString();
write("execution-plan.json", {
  observedAt, sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: "2026-09-12T14-17-30-067Z-builder-xqizqf",
  taskId: "task-execute-agy-model-benchmark-and-document-routing-d",
  scenarios: scenarios.map(s => s.fixtureId), repeatCount: 3,
  requestedEffort: "max", expectedGeminiNativeEffort: "high",
  candidates: candidates.map(model => ({ model, requestedCatalogModel: resolveAntigravityCliCatalogModel(model, "max"), availability: "unobserved", completedRepeats: 0, actualModel: null, actualEffort: null, quota: "unobserved", passAt3: null, passHat3: null })),
  infrastructureState: "prepared-inputs-only",
  executionBlockedAt: "trusted-host-profile-not-configured",
  mediationResponse: "contained-inspect-response.json",
  routingDecision: "needs-more-data"
});
write("preparation-validation.json", {
  observedAt, fixtureCount: fixtures.length, snapshotCount: snapshots.length,
  fixtureLoader: "passed", instructionSources: "passed",
  hostProfileDecoder: "passed", requestDecoder: "passed",
  networkCatalog: endpoints, liveContainerBuild: "not-run", proxyEnforcement: "not-tested",
  inference: "not-run", credentialAvailability: "unobserved"
});
console.log(JSON.stringify({ fixtureCount: fixtures.length, snapshots: snapshots.length, profileDecoder: "passed", requestDecoder: "passed" }));
