# External Resource Packet Disposition

Durable disposition of the external resource packet received in early April
2026. The packet was triaged in commits `3f672081` and `39b31d12`, where inbox
tasks were created and then compressed into implementation and review tasks.

This document accounts for every resource at a group level with per-resource
notes where needed.

**Disposition legend:**
- **Adopted** — idea implemented in KOTA.
- **Deferred** — captured in a follow-up task for future review.
- **Reference only** — noted for awareness; no action planned.

---

## Agent Runtimes, Harnesses, and Workspace Protocols

**Disposition: Reference only — reviewed, no gaps found**

KOTA has its own daemon, agent loop, and module runtime. Deep review of
OpenFang and pi-mono confirmed KOTA's architecture covers the useful patterns
from this group. The remaining differences are language/platform choices (Rust
WASM sandboxes, multi-provider LLM abstraction) that don't map to real gaps
in KOTA's TypeScript single-daemon model.

| Resource | Note |
|----------|------|
| open-harness (MaxGfeller) | Composable SDK patterns; reference only — KOTA's `KotaModule` contribution protocol covers this. |
| openfang (RightNow-AI) | Autonomous "Hands" with scheduling and WASM sandboxing. KOTA's workflow+agent model covers scheduling. The dual-metered sandbox and Ed25519 manifest signing are interesting hardening patterns but require a different runtime substrate. Reference only. |
| goose (aaif-goose) | Install/execute/edit/test workflow; reference only — KOTA's builder workflow with repair loops covers this pattern more thoroughly. |
| hermes-agent (NousResearch) | Large runtime; reference only — ecosystem gravity, not directly applicable. |
| function-calling harness article (autobe.dev) | Tool-call reliability patterns; reference only — KOTA's tool runner with retry already implements reliable invocation. |
| Codex plugin for Claude Code (x.com/reach_vb) | Cross-agent handoff; reference only — interesting for future multi-model work but KOTA's workflow steps already sequence agents. |
| OpenClaw workspace anatomy (x.com/coreyganim) | Workspace-file and protocol design; reference only — KOTA uses `data/`, `.kota/`, and `AGENTS.md` as its own workspace protocol. |
| OpenClaw plugin listing (clawhub.ai/axonflow) | Plugin packaging patterns; reference only — KOTA's module protocol covers contribution discovery. |
| impeccable (pbakaus) | AI harness design language; reference only. |
| pi-mono (badlogic) | Multi-provider LLM abstraction, session trace sharing, multi-UI agent. Reference only — KOTA separates client from daemon already; multi-provider is out of scope (single Anthropic provider). |

**Gap analysis (April 2026):** No actionable gaps. KOTA's daemon lifecycle,
workflow runtime, module protocol, and repair loops match or exceed the
patterns in these runtimes. OpenFang's execution sandboxing is the most
distinct feature but requires WASM — not applicable to KOTA's model. Pi-mono's
session-trace-as-training-data is interesting but belongs to a model-training
concern KOTA does not own.

---

## Channels, Chat SDK, and Delivery Adapters

**Disposition: Adopted + Deferred**

Core ideas adopted: Telegram channel module, Vercel adapter module, and the
channels architecture in the daemon.

| Resource | Note |
|----------|------|
| Vercel CLI for marketplace integrations | **Adopted** — `src/modules/vercel-adapter/`. |
| Vercel Chat SDK (vercel.com/blog) | **Adopted** — adapter pattern used in Vercel module. |
| Chat SDK adapters (chat-sdk.dev/adapters) | **Adopted** — informed adapter design. |
| Chat SDK Telegram adapter (chat-sdk.dev) | **Adopted** — `src/modules/telegram/` implements webhook and polling. |
| Claude Code channels model (code.claude.com) | **Adopted** — `src/core/channels/` implements the channel concept. |
| Telegram UI plugin (clawhub.ai) | **Adopted** — `src/modules/telegram/` with status-poll and approval-callback. |

**API review (April 2026):** The `ChannelDef`/`ChannelAdapter`/`ChannelSession`
API is sufficient for current adapters (Telegram, Slack, Vercel, email). Each
adapter manages its own user-session map and credentials. Minor gaps noted for
future adapters: no user-identity propagation in `ChannelStartContext`, no
channel-level middleware hooks, and adapters reimplement busy-state tracking
independently. These are not blocking — future adapters can follow the existing
pattern. No follow-up task created; revisit if a new adapter hits a real wall.

**Done tasks:** `task-google-workspace-module`, `task-split-google-workspace-module`.

---

## Domain-Specific Service Adapters

**Disposition: Reference only — reviewed, no gaps found**

None of these resources map to a real operator use case in KOTA. No payment,
trading, travel, or Python SDK integration is needed.

| Resource | Note |
|----------|------|
| claw-pay (clawhub.ai) | Payment plugin; reference only — no payment use case. |
| polymarket-trade (clawhub.ai) | Trading plugin; reference only — no trading use case. |
| builders.gojinko.com | Travel APIs via MCP/CLI; reference only — niche. |
| xybernetex-sdk (chrisvx-ctrl) | Python SDK; reference only — no direct applicability. |

**Review (April 2026):** No change from initial disposition. These remain
domain-specific integrations without clear operator benefit in KOTA's
autonomous development workflow.

---

## Local AI, Prediction, and Multimodal Opportunities

**Disposition: Reference only — reviewed, no gaps found**

KOTA uses the Claude API for inference. Local model execution, time-series
forecasting, browser-side inference, and image generation have no operator use
case in KOTA's autonomous development workflow.

| Resource | Note |
|----------|------|
| anemll (x.com/anemll) | On-device model execution; reference only — KOTA uses Claude API, no local inference need. |
| timesfm (google-research) | Time-series forecasting model; reference only — no analytics use case. |
| transformers.js 4.0 (huggingface) | Browser inference; reference only — no client-side inference need. |
| MiroFish (666ghj) | Swarm-intelligence / knowledge-graph; reference only — niche. |
| nano-banana-pro (clawhub.ai/steipete) | Image generation plugin; reference only — no image generation use case. |

**Review (April 2026):** No actionable gaps. Local inference would require a
fundamentally different runtime model. Forecasting and image generation are
outside KOTA's scope as an autonomous development system.

---

## Memory, Context, and Ontology Extensions

**Disposition: Adopted (core ideas) + Deferred (coverage review)**

KOTA has three memory modules (`memory`, `sqlite-memory`, `working-memory`),
MCP resources for memory/knowledge, and a knowledge module. The external
resources confirmed the design direction.

| Resource | Note |
|----------|------|
| OpenViking (volcengine) | Context database for agents; reference only — KOTA's store system covers this. |
| lat.md (1st1) | Markdown knowledge graph; reference only — interesting pattern, KOTA uses file-based knowledge. |
| episodic-claw (clawhub.ai) | Episodic memory plugin; reference only — KOTA's history store covers this. |
| memrok (clawhub.ai) | Memory plugin; reference only. |
| openclaw-cortex-memory (clawhub.ai) | Cortex memory plugin; reference only. |
| ontology (clawhub.ai/oswalpalash) | File-backed ontology with graph storage; reference only — potential future knowledge enhancement. |

**Adopted implementations:** `src/modules/memory/`, `src/modules/sqlite-memory/`, `src/modules/working-memory/`, `src/modules/knowledge/`, `src/core/mcp/resources.ts`.

**Done tasks:** `task-mcp-resources-knowledge-memory`, `task-mcp-server-resources`.

**API review (April 2026):** Memory extensibility is good — `ProviderRegistry`
supports pluggable backends for memory, knowledge, task, and history via typed
provider interfaces. Temporal filtering (`since`) exists on MemoryStore.
`KnowledgeEntry` supports flat metadata with tags, types, and optional `meta`
fields but has no relational/linking capability between entries. Ontology-style
graph storage (lat.md, clawhub ontology) would require a `relationships` field
on `KnowledgeEntry` — not blocking current use cases but would improve
long-horizon reasoning if needed later. Episodic memory patterns are partially
addressed by conversation history compaction and temporal memory filtering.
No follow-up task created — the current flat model is sufficient for KOTA's
needs. Revisit if agent reasoning requires causal or relational knowledge
traversal.

---

## Self-Improving and Proactive Agent Loops

**Disposition: Adopted (core patterns) — reviewed, one gap identified**

KOTA's autonomy module implements self-improving and proactive patterns:
dispatcher, explorer, builder, improver, critic, decomposer, inbox-sorter,
PR reviewer, and attention-digest workflows. The improver triggers on build
commits and workflow failures, reads recent runs, and fixes autonomy surfaces.
The critic provides diff-level code review during repair loops.

| Resource | Note |
|----------|------|
| self-improving-agent playbook (skills.sh/charon-fan) | **Adopted** — pattern realized in `improver` and `critic` workflows. |
| capability-evolver (clawhub.ai/autogame-17) | Reference only — KOTA's improver handles capability evolution via evidence-based prompt/config changes. |
| evolver (clawhub.ai/autogame-17) | Reference only — overlaps with above. |
| self-improving-agent (clawhub.ai/pskoett) | Reference only — pattern adopted via KOTA's own design. |
| self-improving + proactive (clawhub.ai/ivangdavila) | **Adopted** — proactive dispatch via `dispatcher` workflow with queue-state events. |
| proactive-agent (clawhub.ai/halthelobster) | Reference only — overlaps with dispatcher pattern. |
| flow-weaver-openclaw (clawhub.ai/synergenius) | Reference only — workflow patterns; KOTA has its own typed workflow runtime with repair loops. |

**Adopted implementations:** `src/modules/autonomy/workflows/` (9 workflows), `src/modules/autonomy/critic.ts`.

**Gap analysis (April 2026):** One actionable gap identified — **cross-run
outcome aggregation**. The improver reads recent runs via `loadRecentRuns()`
(24-hour window, last 20 runs) but gets raw metadata only: status, cost,
warnings. It cannot easily see patterns like recurring repair-loop failures,
cost trends by workflow, or which check types fail most often. OpenFang's
Predictor Hand tracks calibrated accuracy via Brier scores across runs;
MemPalace's temporal knowledge graph tracks fact validity windows. KOTA does
not need these specific mechanisms, but a lightweight run-outcome summary
(aggregated repair failure rates, cost-per-workflow trends, common error
categories) would give the improver better signal for its fixes. Follow-up
task created: `task-run-outcome-aggregation-for-improver`.

---

## Skills Ecosystem and Skill Protocols

**Disposition: Adopted + Reference**

Skill import was one of the directly adopted ideas from the packet.

| Resource | Note |
|----------|------|
| shadcn/ui skills docs (ui.shadcn.com) | **Adopted** — informed KOTA's skill file format and import protocol. |
| anthropics skills catalog (skills.sh/anthropics) | Reference — ecosystem awareness. |
| claude-md-improver skill (skills.sh) | Reference only — KOTA has its own improver workflow. |
| PDF processing skill (skills.sh) | Reference only — niche. |
| remotion-best-practices skill (skills.sh) | Reference only — domain-specific, not applicable. |
| sandbox-agent skill (skills.sh/rivet-dev) | Reference only — sandbox patterns; KOTA uses direct execution. |
| skill-vetter (clawhub.ai/spclaudehome) | Reference only — interesting for future skill trust/validation. |

**Adopted implementation:** `src/modules/skill-ops/` with CLI integration.

**Done task:** `task-skill-import-command`.

**API review (April 2026):** The skill system works for basic use (import,
list, global injection) but has one concrete gap: `AgentDef.skills` is declared
but never resolved — all module skills are injected globally into every agent
via `getSkillsPrompt()` in loop-init. Agent-scoped skill injection would let
specialized agents receive only relevant guidance. Follow-up task created:
`task-agent-scoped-skill-injection` (backlog, p2). Other gaps (versioning,
dependency declarations, validation) are not blocking at current scale. The
skill-vetter pattern remains interesting for future trust/validation if the
imported skill count grows.

---

## Tooling and Knowledge Adapter Extensions

**Disposition: Adopted (Google Workspace, GitHub) + Reference only — reviewed, no gaps found**

Google Workspace and GitHub modules were built. Remaining tooling references
are fully covered by existing modules.

| Resource | Note |
|----------|------|
| GitHub skill (clawhub.ai/steipete) | **Adopted** — `src/modules/github/`. |
| Google Workspace CLI wrapper (clawhub.ai/steipete/gog) | **Adopted** — `src/modules/google-workspace/` with Gmail, Calendar, Drive. |
| Obsidian plugin (clawhub.ai/steipete) | Reference only — file-based knowledge management covered by `src/modules/knowledge/`. |
| nano-pdf plugin (clawhub.ai/steipete) | Reference only — PDF/document extraction covered by `src/modules/read-document/`. |
| agent-browser-clawdbot (clawhub.ai/matrixy) | Reference only — web fetch/search/HTTP covered by `src/modules/web-access/`. |
| multi-search-engine (clawhub.ai/gpyangyoujun) | Reference only — web search covered by `src/modules/web-access/` (DuckDuckGo/Brave). |

**Adopted implementations:** `src/modules/github/`, `src/modules/google-workspace/`.

**Done tasks:** `task-google-workspace-module`, `task-split-google-workspace-module`.

**Review (April 2026):** All tooling patterns from the original packet are
covered by existing modules. Obsidian → knowledge module, PDF → read-document
module, browser/search → web-access module. No new modules or adapters needed.

---

## Summary

| Group | Resources | Adopted | Deferred | Reference |
|-------|-----------|---------|----------|-----------|
| Agent runtimes & harnesses | 10 | 0 | reviewed ✓ | 10 |
| Channels & adapters | 6 | 6 | 1 task | 0 |
| Domain services | 4 | 0 | reviewed ✓ | 4 |
| Local AI & multimodal | 5 | 0 | reviewed ✓ | 5 |
| Memory & ontology | 6 | 3 (core) | 1 task | 3 |
| Self-improving loops | 7 | 2 | reviewed ✓ (1 follow-up) | 5 |
| Skills ecosystem | 7 | 1 | 1 task | 6 |
| Tooling & adapters | 6 | 2 | reviewed ✓ | 4 |
| **Total** | **50** | **14** | **0 tasks** | **36** |

All resource-group review tasks are complete:
- `task-review-runtime-and-self-improvement-resource-group` — done. One follow-up: `task-run-outcome-aggregation-for-improver`.
- `task-review-channel-memory-and-skill-resource-group` — done. One follow-up: `task-agent-scoped-skill-injection`.
- `task-review-domain-local-ai-and-tooling-resource-group` — done. No follow-ups needed; all resources covered by existing modules or reference-only.
