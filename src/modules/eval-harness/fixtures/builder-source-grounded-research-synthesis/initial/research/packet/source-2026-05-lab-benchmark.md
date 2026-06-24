---
source_id: lab-benchmark-2026-05
date: 2026-05-18
status: scoped-conflict
decision_signal: cloud-ocr
---

# Lab benchmark comparison

The lab benchmark found Cloud OCR outperformed the local markdown parser on
synthetic table extraction. It recommended Cloud OCR when the primary success
metric is table recall on non-sensitive benchmark documents.

The benchmark explicitly excluded offline execution, customer-ticket privacy,
and the support triage release's markdown-heavy transcript corpus. Its result
conflicts with the newer release constraints, so it should be weighed as a
narrow-scoped benchmark rather than as the deployment decision.
