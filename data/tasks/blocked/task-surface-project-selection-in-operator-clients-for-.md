---
id: task-surface-project-selection-in-operator-clients-for-
title: Surface project selection in operator clients for multi-project supervision
status: blocked
priority: p2
area: architecture
summary: Once the daemon can manage multiple project roots, native/web/CLI clients need a first-class project selector and per-project view so operators can supervise more than one repo at a time
created_at: 2026-04-18T00:40:56.393Z
updated_at: 2026-04-18T02:44:19.138Z
---

## Problem

The in-progress `task-enable-kota-to-operate-on-external-projects` work is making the daemon project-aware: `DaemonConfig.projectDir` is honored across the workflow runtime, run store, and agent step `cwd`, and the new `resolveProjectDir()` helper gives every operator surface one consistent answer for "which project is this daemon pointing at". But clients today are still implicitly single-project: the CLI daemon mode, the daemon-backed web chat, the macOS menu-bar app, and the mobile client all assume one repo per daemon. The moment a real operator runs KOTA against a second project — the stated goal of that doing task — there is no way for a client to list known projects, switch between them, or show sessions scoped to one. This will become a visible gap the first time the daemon is pointed at an external target.

## Desired Outcome

- The daemon control API exposes the current project and a way to list/select other projects the operator has registered with this daemon.
- Operator clients (CLI daemon mode, web, macOS, mobile) can show the active project, list sessions grouped by project, and switch between projects without restarting the daemon.
- Cross-project views (active runs, owner questions, approval queue) render per-project rather than as a flat mixed list, so the operator can supervise one project at a time.

## Constraints

- Keep multi-project state in the daemon, not duplicated in each client. Clients query the daemon; they do not read `.kota/` files directly.
- Use the existing control-API and event-subscription patterns; do not add a second side channel just for project switching.
- Do not block on external-project work being fully done; a first pass can land as soon as the daemon reliably runs one project-aware session end-to-end.
- Keep the project-selector surface small and consistent across clients. No per-client bespoke model for "which project is active".
- Respect existing module boundaries: daemon-ops owns the control surface, not individual clients.

## Done When

- The daemon control API has typed endpoints and events for listing configured projects, reporting the active project, and switching projects.
- At least the CLI daemon mode and the web client render project-scoped views and expose a project selector; macOS and mobile clients have an open follow-up if they lag.
- A session, run, or owner question is always attributable to one project in the API output, not ambiguous across projects.
- Tests cover the project-switch control path and the per-project filtering of sessions/runs.
- Docs in the relevant client and daemon-ops `AGENTS.md` describe the model at the conventions level, not as a catalog of endpoints.

## Source / Intent

Owner direction asked KOTA to operate beyond the KOTA repo and supervise
external projects. This task preserves the client/operator side of that
requirement so project-aware daemon internals do not ship without an
understandable supervision surface.

## Initiative

Multi-project operator supervision: either one daemon hosts project-scoped
runtimes or clients supervise multiple single-project daemons, but sessions,
runs, questions, and approvals must always be attributable to one project.

## Acceptance Evidence

- The chosen runtime shape is recorded in this task before implementation
  resumes.
- API and client tests prove sessions/runs/questions are filtered or attributed
  by project without cross-project leakage.
- CLI daemon-mode and web-client views show the active project and expose the
  same project-selection model.

## Blocker

This task is blocked until the owner picks the multi-project runtime shape.
The owner was asked on 2026-04-18 and timed out; re-asking once the proposal
below is visible is the remaining step.

Unblock by: owner picks Variant A or B below, then this task splits into at
least the three follow-ups sketched under "Follow-up decomposition":
(a) daemon-side project identity and attribution;
(b) CLI daemon-mode selector and project-scoped views;
(c) web client selector and project-scoped views. Native macOS and mobile
parity land as their own follow-ups.

## Proposal

The daemon is single-project today: `DaemonConfig.projectDir` is consumed once
at construction and every daemon-owned subsystem — scheduler, task store, run
store, module-log store, workflow runtime, notification gate, owner-question
queue, approval queue, event bus, push-token store, and every control-API
handler — binds to that one root. Both variants below satisfy the existing
wording of this task; only one can be the durable answer.

### Variant A — daemon hosts many project runtimes

Durable ownership: the daemon becomes the multi-project host. It owns a
project registry (configured roots, their display name, and identity),
constructs a per-project runtime bundle (workflow runtime, run store, task
store, scheduler, module-log store, notification gate, approval queue,
owner-question queue, push-token store) inside one process, and routes every
bus event, session, run, owner question, approval, and push through a
`projectId` scope. Runtime state files move under `<projectDir>/.kota/`
per-project; nothing leaves the daemon process.

Attribution policy: every session, run, event, owner question, approval, and
scheduled item carries a `projectId`. The control-API surface gains project
scope as a first-class parameter on list/subscribe/mutate. Clients never stitch
attribution themselves.

Channel-to-project attachment: a channel adapter attaches to a project at
registration. Multi-project transports (e.g. Telegram bot, webhook channel)
resolve the target project per-message from typed identity metadata rather than
assuming one project per daemon. Channel identity remains project-scoped so
operator inputs cannot cross project boundaries.

Client impact: every client (CLI daemon mode, web, macOS, mobile) gains one
project-selector surface backed by the same control-API endpoints. Per-project
views are a filter on daemon output, not a bespoke per-client model.

Migration shape: the first PR registers the project-registry primitive, adds
`projectId` to every daemon-owned store and event payload, and threads scope
through the control API with a single default project preserving
KOTA-on-itself. Subsequent PRs land the CLI selector, the web selector, and
native client catch-up. Risk is high but one-directional: every subsystem that
binds to `projectDir` at construction needs a per-project factory; missing one
silently leaks cross-project state. Mitigation: add a typed invariant test that
scans for singleton store binding and fails if a new store forgets to declare
project scope.

### Variant B — one daemon per project, client-side registry

Durable ownership: the daemon stays single-project. Each project runs its own
daemon process with its own socket, state directory, and lifecycle. A
client-machine registry (shared across the operator's clients) maps projectId →
daemon address + token. Clients wrap the existing daemon control client with a
multi-daemon façade that fans out list/subscribe calls and merges responses.

Attribution policy: every session, run, event, owner question, and approval
stays unambiguous because each daemon owns exactly one project. The client is
responsible for tagging inbound responses with the projectId it fetched from,
and for keeping per-daemon SSE subscriptions isolated.

Channel-to-project attachment: channels stay single-project. Multi-project
transports that need to reach more than one daemon must either run a separate
bot/webhook per project or live outside the daemon entirely.

Client impact: every client carries the multi-daemon façade (connection pool,
registry reader, per-daemon token handling) and a project selector. The
registry is shared state across clients on one operator machine — clients read
it; the daemon does not own it. "Switch without restarting the daemon" means
switching the selected daemon socket, not restarting a process.

Migration shape: the first PR introduces the client registry format, the
multi-daemon client façade, and the CLI/web selector that drives it. The
daemon stays untouched. Risk is low for core but high for client surfaces: the
façade must handle unreachable daemons, token drift, and event fan-in without
leaking across projects. Mitigation: façade has a narrow typed interface
identical to the single-daemon client, with a project scope as the only added
parameter, and is covered by a fan-in test that asserts no event leaks across
sockets.

### Hybrid — daemon-owned registry, one active project

The daemon owns the registry file but runs exactly one project runtime at a
time. Switching tears down the current bundle and stands up the next one in
the same process. Does not deliver simultaneous supervision: operators cannot
watch two projects' queues at once. Not a long-term answer if the goal is
multi-project visibility; useful only as an intermediate step toward Variant A
if operator demand for simultaneous views is unclear.

### Follow-up decomposition (either variant)

- **(a) Daemon-side project identity and attribution.** In Variant A: project
  registry primitive, per-project runtime bundle, `projectId` on every store,
  event, and API payload. In Variant B: project identity in the control-API
  startup report plus stable projectId generation so the client registry has
  something durable to key on.
- **(b) CLI daemon-mode selector.** Project-scoped views in `kota status`,
  `kota session`, `kota events`, and any daemon-ops readout. Both variants
  land in the daemon-ops module.
- **(c) Web client selector.** Project-scoped routes and SSE subscription
  scoping in the web dashboard. Native macOS and mobile parity follows as
  their own tasks.
