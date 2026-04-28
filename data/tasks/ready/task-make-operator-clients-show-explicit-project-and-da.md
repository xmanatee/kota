---
id: task-make-operator-clients-show-explicit-project-and-da
title: Make operator clients show explicit project and daemon identity
status: ready
priority: p1
area: client
summary: Prevent wrong-project daemon confusion by making macOS, mobile, web, and CLI clients show the connected project identity, daemon control path/source, and mismatch/offline reasons instead of a generic daemon offline state.
created_at: 2026-04-28T22:40:50.126Z
updated_at: 2026-04-28T22:40:50.126Z
---

## Problem

The first macOS symptom was "Daemon offline" while a daemon was actually
running. The app was reading `.kota/daemon-control.json` from a different
configured project directory, so it looked offline for the current work even
though KOTA was alive elsewhere.

This is a general thin-client problem: clients often show a binary online/offline
state without enough daemon identity context for the operator to see which
project, control file, port, token source, or remote URL is being used.

## Desired Outcome

Operator clients make daemon identity explicit:

- show the connected project path/name and daemon base URL/port in an unobtrusive
  way;
- distinguish no control file, stale control file, token rejected, wrong project,
  daemon not responding, and remote URL configured;
- provide a clear project switch/reconnect affordance where the client supports
  local discovery;
- surface mismatch diagnostics in macOS, CLI status/doctor, and any other
  client that can reasonably show connection details;
- align with the existing blocked broader project-selection work rather than
  contradicting it.

## Constraints

- Do not expose bearer tokens in UI, logs, screenshots, or diagnostics.
- Keep clients thin; they may read only the documented daemon-control discovery
  file locally.
- Do not require multi-project orchestration to land first. This task is about
  making the current connection identity and failure mode clear.
- Coordinate with `data/tasks/blocked/task-surface-project-selection-in-operator-clients-for-.md`
  if that task becomes unblocked.
- Add rendered evidence for macOS and a transcript for CLI/doctor behavior.

## Done When

- macOS no longer collapses wrong-project/no-control-file/stale-daemon cases
  into only "Daemon offline".
- CLI status or doctor reports enough connection identity to diagnose the same
  mismatch without inspecting UserDefaults or `.kota/daemon-control.json`
  manually.
- At least one automated test covers stale/wrong-project discovery behavior.
- The displayed diagnostics redact secrets and remain concise.
- Existing daemon discovery and remote URL behavior keep working.

## Source / Intent

2026-04-28 incident: the macOS menu bar showed "Daemon offline" because
`projectDirectory` pointed at another app directory while the daemon was running
in `/Users/xmanatee/Desktop/mono/apps/kota`. Once the project directory was
corrected, the app connected. The root UX issue is that the client did not make
the selected project/daemon identity obvious enough to diagnose the mismatch.

## Initiative

Daemon identity clarity: operator clients should make "which daemon for which
project?" visible and diagnosable.

## Acceptance Evidence

- macOS screenshot/rendered artifact showing connected project identity and a
  wrong-project/offline diagnostic state.
- CLI status/doctor transcript showing the same class of diagnostic without
  exposing secrets.
- Test output for stale/missing/wrong-project daemon-control discovery behavior.
