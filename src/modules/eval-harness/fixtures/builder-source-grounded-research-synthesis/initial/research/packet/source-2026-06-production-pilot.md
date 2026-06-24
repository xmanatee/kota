---
source_id: pilot-results-2026-06
date: 2026-06-14
status: decisive
decision_signal: local-first-markdown
---

# Production pilot results

The June production pilot ran the support triage corpus through both candidate
paths. The local-first markdown parser met the release threshold: 96 percent
usable extraction on markdown-heavy transcripts and zero network dependency.

Cloud OCR failed the offline canary because the managed service requires a live
network call. The pilot recommends `local-first-markdown` for the Q3 offline
release and leaving Cloud OCR as a later table-heavy enhancement candidate
after security approval.
