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

**Follow-up:** `task-review-channel-memory-and-skill-resource-group` (backlog, p2) covers whether module APIs are broad enough for future adapters.

**Done tasks:** `task-google-workspace-module`, `task-split-google-workspace-module`.

---

## Domain-Specific Service Adapters

**Disposition: Deferred**

These represent optional module opportunities. None adopted yet; no immediate
need identified.

| Resource | Note |
|----------|------|
| claw-pay (clawhub.ai) | Payment plugin; reference only — no payment use case. |
| polymarket-trade (clawhub.ai) | Trading plugin; reference only — no trading use case. |
| builders.gojinko.com | Travel APIs via MCP/CLI; reference only — niche. |
| xybernetex-sdk (chrisvx-ctrl) | Python SDK; reference only — no direct applicability. |

**Follow-up:** `task-review-domain-local-ai-and-tooling-resource-group` (backlog, p3) covers realistic optional module opportunities from this group.

---

## Local AI, Prediction, and Multimodal Opportunities

**Disposition: Reference only + Deferred**

No local inference or forecasting modules adopted. These remain interesting for
future capability expansion.

| Resource | Note |
|----------|------|
| anemll (x.com/anemll) | On-device model execution; reference only — thin lead. |
| timesfm (google-research) | Time-series forecasting model; reference only — interesting for future analytics. |
| transformers.js 4.0 (huggingface) | Browser inference; reference only — relevant if KOTA adds client-side inference. |
| MiroFish (666ghj) | Swarm-intelligence / knowledge-graph; reference only — niche. |
| nano-banana-pro (clawhub.ai/steipete) | Image generation plugin; reference only. |

**Follow-up:** `task-review-domain-local-ai-and-tooling-resource-group` (backlog, p3).

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

**Follow-up:** `task-review-channel-memory-and-skill-resource-group` (backlog, p2).

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

**Follow-up:** `task-review-channel-memory-and-skill-resource-group` (backlog, p2) includes skill ecosystem coverage.

---

## Tooling and Knowledge Adapter Extensions

**Disposition: Adopted (Google Workspace, GitHub) + Reference**

Google Workspace and GitHub modules were built. Other tooling references noted
for awareness.

| Resource | Note |
|----------|------|
| GitHub skill (clawhub.ai/steipete) | **Adopted** — `src/modules/github/`. |
| Google Workspace CLI wrapper (clawhub.ai/steipete/gog) | **Adopted** — `src/modules/google-workspace/` with Gmail, Calendar, Drive. |
| Obsidian plugin (clawhub.ai/steipete) | Reference only — no Obsidian integration planned. |
| nano-pdf plugin (clawhub.ai/steipete) | Reference only — PDF handling not a current priority. |
| agent-browser-clawdbot (clawhub.ai/matrixy) | Reference only — `src/modules/web/` covers browser needs. |
| multi-search-engine (clawhub.ai/gpyangyoujun) | Reference only — `src/modules/web/` covers search. |

**Adopted implementations:** `src/modules/github/`, `src/modules/google-workspace/`.

**Done tasks:** `task-google-workspace-module`, `task-split-google-workspace-module`.

**Follow-up:** `task-review-domain-local-ai-and-tooling-resource-group` (backlog, p3).

---

## Summary

| Group | Resources | Adopted | Deferred | Reference |
|-------|-----------|---------|----------|-----------|
| Agent runtimes & harnesses | 10 | 0 | reviewed ✓ | 10 |
| Channels & adapters | 6 | 6 | 1 task | 0 |
| Domain services | 4 | 0 | 1 task | 4 |
| Local AI & multimodal | 5 | 0 | 1 task | 5 |
| Memory & ontology | 6 | 3 (core) | 1 task | 3 |
| Self-improving loops | 7 | 2 | reviewed ✓ (1 follow-up) | 5 |
| Skills ecosystem | 7 | 1 | 1 task | 6 |
| Tooling & adapters | 6 | 2 | 1 task | 4 |
| **Total** | **50** | **14** | **3 tasks** | **36** |

Two remaining backlog tasks cover the deferred review work:
- `task-review-channel-memory-and-skill-resource-group` (p2)
- `task-review-domain-local-ai-and-tooling-resource-group` (p3)

Completed review tasks:
- `task-review-runtime-and-self-improvement-resource-group` — completed April 2026. One follow-up: `task-run-outcome-aggregation-for-improver`.
