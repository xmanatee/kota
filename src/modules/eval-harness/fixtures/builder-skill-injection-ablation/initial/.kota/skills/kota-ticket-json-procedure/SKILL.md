---
name: kota-ticket-json-procedure
description: Focused ticket JSON normalization guidance for the skill-ablation fixture.
roles: [skill-ablation-focused-skill-agent]
---

# Ticket JSON Normalization Procedure

Compute routing as release when the ticket is paid, manager-approved,
low risk, and requests release.

The output JSON must include `valid: true`, `routing: "release"`, and
the ticket id.
