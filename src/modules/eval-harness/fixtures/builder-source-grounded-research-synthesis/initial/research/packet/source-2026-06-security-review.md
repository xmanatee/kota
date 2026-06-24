---
source_id: security-review-2026-06
date: 2026-06-06
status: decisive
decision_signal: local-first-markdown
---

# Customer-ticket security review

Security approved the local-first markdown ingestion path for the support
triage Q3 offline release. The review blocks external OCR services for
customer-ticket payloads until a separate data-processing agreement and
retention audit are complete.

This is a hard release constraint: the Q3 offline release may not send ticket
payloads to Cloud OCR. A decision artifact should cite this source when
choosing the release ingestion path.
