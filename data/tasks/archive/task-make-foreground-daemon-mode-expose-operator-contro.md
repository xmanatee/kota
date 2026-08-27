---
status: done
---

# Make foreground daemon mode expose operator control affordances

## Problem

`pnpm dev daemon` / `kota daemon` starts the daemon host and, on a TTY, renders
the daemon dashboard. At creation time the dashboard looked like the main live
operator surface, but it was passive: it did not accept pause/resume/follow/status
commands and did not clearly point to `kota workflow`, `kota status`,
`kota inbox`, `kota ui`, or `kota navigate`.

When dispatch is paused or no work is being dispatched, the dashboard can read
as "stuck" even when the runtime is intentionally waiting or protected. The
operator has to know a separate command map from memory.

## Desired Outcome

Foreground daemon mode must be self-explanatory. An operator watching the
dashboard should immediately know:

- whether the terminal is only hosting/monitoring the daemon or can accept
  controls;
- how to pause/resume dispatch, follow active runs, inspect pending runs,
  open the full operator client, and stop/reload the daemon;
- why dispatch is paused or blocked, including dirty-checkout recovery,
  dispatch windows, no actionable work, or no daemon control API;
- which command or UI action is the canonical path for each control.

If the dashboard remains passive, render a compact controls/help footer and
make `kota daemon --help` explicit that `daemon` is a host/dashboard command,
not the interactive operator console. If controls are added directly to the
dashboard, route them through the same `KotaClient`/daemon control contract as
other clients.

## Constraints

- Do not create a second control protocol or private side channel.
- Keep the daemon runtime itself free of decorative dashboard rendering; layout
  stays in `daemon-ops`.
- Keep log capture usable in non-TTY contexts. Non-TTY daemon output must not
  gain interactive prompts or hidden waits.
- Avoid duplicating long command inventories in docs; help/dashboard output is
  the discoverable operator surface.

## Done When

- Starting `pnpm dev daemon` on a TTY shows a concise controls/help area or
  direct key actions for status, workflow status, pause, resume, follow, open
  the operator client, reload, and stop.
- Paused or blocked dispatch states show the reason and the exact next control
  path, not just `Paused yes` or `dispatch paused`.
- `kota daemon --help` and `kota daemon start --help` distinguish daemon host
  mode from `kota navigate` / bare `kota`.
- The same affordances work when invoked through the built CLI path, not only
  the source-mode dev command.

## Source / Intent

Owner follow-up on 2026-07-07: `pnpm dev daemon` looked like the natural place
to monitor and control autonomy, but it exposed no obvious control/resume path.
Investigation showed `src/modules/daemon-ops/index.ts` starts
`DaemonDashboard` and waits on `daemon.start()`, while controls live in
separate workflow/UI commands.

## Initiative

Operator control plane: daemon foreground mode should not look like an
uncontrollable or stuck surface.

## Acceptance Evidence

- Full transcript under `.kota/runs/<run-id>/transcript.txt` showing
  `pnpm dev daemon --help`, `kota daemon --help`, and a rendered daemon
  dashboard snapshot with the new control affordances.
- Transcript or fixture showing the paused-dispatch dashboard state with the
  exact resume/control path.
- Tests covering dashboard rendering for running, paused, dirty-recovery,
  idle/no-actionable-work, and non-TTY modes.

## Completion Notes

- Added a foreground dashboard controls section that names the host/dashboard
  boundary and the canonical status, inbox, workflow, navigator, UI, and
  daemon command paths.
- Added explicit state guidance for paused dispatch, dispatch windows, agent
  backoff, dirty-checkout recovery, dispatchable work, parked work, and idle
  no-work states.
- Updated `kota daemon --help` and `kota daemon start --help` to distinguish
  daemon host/dashboard mode from `kota navigate` and bare `kota`.
- Evidence transcript: `.kota/runs/2026-07-06T15-29-18-210Z-builder-v70rd2/transcript.txt`.
- Validation run: `pnpm test src/modules/daemon-ops/dashboard.test.ts src/modules/daemon-ops/index.test.ts`, `pnpm typecheck`, `pnpm build`, and targeted `biome check`.
