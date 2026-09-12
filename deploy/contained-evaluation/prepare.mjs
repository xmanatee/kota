// Operator preparation only: emits existing host-profile JSON and Docker Compose
// input. Does not install grants, start containers, read auth, or change a preset.
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containedEvaluationProfiles } from '#modules/eval-harness/contained-evaluation.js';
import { registerAgentHarness } from '#core/agent-harness/registry.js';
import { codexAgentHarness } from '#modules/codex-agent-harness/adapter.js';
import { openaiToolsAgentHarness } from '#modules/openai-tools-agent-harness/adapter.js';
import { openaiToolsScaffoldAgentHarness } from '#modules/openai-tools-agent-harness/scaffold-harness.js';
import { resolveMatrixExecutions } from '#modules/harness-parity/model-matrix.js';
import { containedMatrixSelection } from '#modules/harness-parity/contained-matrix.js';
import { providerEgressEndpointsFor, providerEgressEndpointLabelValue, PROVIDER_EGRESS_NETWORK_LABELS } from '#modules/eval-harness/provider-egress.js';
import { resolveOpenRouterCandidateSet } from '#modules/model-clients/openrouter-catalog.js';
import { loadScenario } from '#modules/harness-parity/scenario.js';
import { loadFixture } from '#modules/eval-harness/fixture.js';

const [scope, image, proxyImage, agyImage, destination] = process.argv.slice(2);
if (!scope || !image || !proxyImage || !agyImage || !destination || process.argv.length !== 7) {
  throw new Error('Usage: node --conditions=source --import tsx deploy/contained-evaluation/prepare.mjs <canonical-scope> <runtime-image> <proxy-image> <agy-image> <new-output-directory>');
}
for (const value of [image, proxyImage, agyImage]) if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]*$/.test(value)) throw new Error('Invalid image reference');
const scopeRoot = realpathSync(scope);
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(destination);
const providers = ['openai', 'openrouter', 'ollama', 'google'];
const backend = (provider) => ({ kind: 'container', executable: 'docker', image: provider === 'google' ? agyImage : image,
  kotaBinaryPath: '/opt/kota/bin/kota.mjs', networkPolicy: { kind: 'provider-egress', provider,
    enforcement: { kind: 'docker-internal-proxy', networkName: `kota-eval-${provider}`, proxyUrl: `http://${provider}-proxy:3128` } } });
const evalFixtures = ['builder-scientific-claim-reproduction', 'builder-algorithmic-resource-budget-canary'];
for (const id of evalFixtures) loadFixture(join(root, 'src/modules/eval-harness/fixtures'), id);
const scenariosRoot = join(root, 'src/modules/harness-parity/scenarios');
const scenarios = readdirSync(scenariosRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
for (const id of scenarios) for (const stage of loadScenario(scenariosRoot, id).spec.stages) {
  if (stage.verification.trustedFiles === undefined) throw new Error(`Scenario ${id} has no contained scorer declaration`);
}
const candidates = resolveOpenRouterCandidateSet('openrouter-lab').map((entry) => ({
  label: entry.providerModelId.replace(/[^a-zA-Z0-9._-]/g, '-'), model: entry.providerModelId, provider: 'openrouter',
}));
candidates.push({ label: 'local-qwen', model: 'ollama/qwen2.5-coder:3b', provider: 'local' });
const matrix = containedMatrixSelection.parse({
  baselines: [{ label: 'codex-gpt-5.5', model: 'gpt-5.5', provider: 'openai' }], candidates,
  harnesses: ['codex', 'openai-tools', 'openai-tools-scaffold'],
  harnessesByLabel: { 'codex-gpt-5.5': ['codex'], ...Object.fromEntries(candidates.map(({ label }) => [label, ['openai-tools', 'openai-tools-scaffold']])) },
  scenarios, evalFixtures, evalIsolationBackends: Object.fromEntries(providers.filter((p) => p !== 'google').map((p) => [p, backend(p)])),
});
for (const harness of [codexAgentHarness, openaiToolsAgentHarness, openaiToolsScaffoldAgentHarness]) registerAgentHarness(harness);
const resolved = resolveMatrixExecutions({ defaultPreset: 'codex' }, matrix);
if (!Array.isArray(resolved)) throw new Error(resolved.message ?? 'Matrix routing failed');
for (const [label, harnesses] of Object.entries(matrix.harnessesByLabel)) {
  for (const harness of harnesses) if (!resolved.some((entry) => entry.spec.label === label && entry.harness.name === harness)) {
    throw new Error(`Incompatible route ${label}/${harness}`);
  }
}
const bounds = { scopeRoots: [scopeRoot], maxRepeats: 3, timeoutMs: 21_600_000, cpuCores: 2, memoryMB: 4096 };
const profiles = {
  codex: { ...bounds, preset: 'codex', fixtureIds: evalFixtures, isolationBackend: backend('openai') },
  rollout: { ...bounds, preset: 'codex', matrix, isolationBackend: backend('openai') },
  agy: { ...bounds, preset: 'antigravity-cli', candidates: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-pro'], isolationBackend: backend('google') },
};
containedEvaluationProfiles(scopeRoot, { KOTA_EVAL_CONTAINED_PROFILES: JSON.stringify(profiles) });
// Output only after all source-owned decoders accept the cohort.
mkdirSync(out); // A new packet never overwrites a previously reviewed grant.
writeFileSync(join(out, 'profiles.json'), `${JSON.stringify(profiles, null, 2)}\n`);
const services = {}, networks = { upstream: {} };
for (const provider of providers) {
  const endpoints = providerEgressEndpointsFor(provider);
  const network = `kota-eval-${provider}`;
  networks[network] = { name: network, internal: true, labels: {
    [PROVIDER_EGRESS_NETWORK_LABELS.policy]: 'provider-egress',
    [PROVIDER_EGRESS_NETWORK_LABELS.provider]: provider,
    [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]: providerEgressEndpointLabelValue(endpoints),
  } };
  const acl = endpoints.flatMap((endpoint, index) => [
    `acl target_${index} dstdomain ${endpoint.host}`,
    `acl port_${index} port ${endpoint.port}`,
    `http_access allow target_${index} port_${index} ${endpoint.protocol === 'https' ? 'CONNECT' : '!CONNECT'}`,
  ]);
  writeFileSync(join(out, `${provider}.conf`), [
    'http_port 3128', 'acl CONNECT method CONNECT', ...acl, 'http_access deny all',
    'cache deny all', 'access_log stdio:/dev/stdout', 'cache_log /dev/stderr', 'pid_filename /tmp/squid.pid',
    'coredump_dir /tmp', 'pinger_enable off', '',
  ].join('\n'));
  services[`${provider}-proxy`] = { image: proxyImage, command: ['squid', '-N', '-f', '/etc/squid/squid.conf'],
    networks: [network, 'upstream'], extra_hosts: ['host.docker.internal:host-gateway'],
    volumes: [`./${provider}.conf:/etc/squid/squid.conf:ro`], read_only: true,
    tmpfs: ['/tmp', '/run', '/var/log/squid', '/var/spool/squid'], cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'], user: 'proxy', restart: 'unless-stopped',
  };
}
writeFileSync(join(out, 'compose.json'), `${JSON.stringify({ services, networks }, null, 2)}\n`);
console.log(`Validated ${Object.keys(profiles).length} scope profiles; ${matrix.baselines.length + matrix.candidates.length} model labels; ${scenarios.length} scenarios and ${evalFixtures.length} eval fixtures. Prepared ${out}. No host grant installed or live readiness claimed.`);
