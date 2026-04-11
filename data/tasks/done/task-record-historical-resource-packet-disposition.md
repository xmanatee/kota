---
id: task-record-historical-resource-packet-disposition
title: Record durable disposition for the historical external resource packet
status: done
priority: p2
area: research
summary: The large external resource packet was compressed into a few outcomes; create a concise durable disposition so every provided resource is accounted for.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

The earlier external-resource packet contained many links across skills,
agent runtimes, memory systems, channels, adapters, and example tools. Some
ideas were adopted, such as skill import, Vercel adapter support, Google
Workspace, MCP resources, and module-first architecture references.

However, there is no durable per-resource or grouped disposition showing which
resources were researched, which ideas were adopted, which were deferred, and
which were intentionally ignored. Some resources appear to have been dropped or
compressed without enough traceability.

Relevant history starts around commits `3f672081` and `39b31d12`, where the
packet was turned into broad research inbox tasks and then compressed into a
small number of implementation tasks.

## Desired Outcome

Create a concise durable record that accounts for the whole packet at a useful
group level, with per-resource notes where needed. The record should identify
adopted ideas, open follow-up tasks, and resources that should remain reference
only.

## Constraints

- Do not overcomplicate inbox structure.
- Do not create one task per link unless a link clearly deserves independent
  implementation work.
- Keep notes short and useful for future explorer/builder runs.
- If research requires internet access, use it only to understand applicability
  and avoid copying external projects wholesale.

## Done When

- Every resource from the packet is represented in a durable note, doc, or task
  disposition.
- Any real implementation follow-ups are captured as focused tasks.
- Already-adopted ideas are linked to existing code/docs/tasks where practical.
- Inaccessible or low-value resources are explicitly marked with a short reason.
