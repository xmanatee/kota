---
title: Enforce builder verification before commit
status: inbox
created_at: 2026-03-25
updated_at: 2026-03-25
---

Builder currently relies mainly on prompt guidance to run full checks before committing. In practice, committed task moves and code changes can still land before the workflow-level verification pipeline fails.

Explore a structural protocol that makes "verified before commit" real instead of advisory. The fix should preserve honest iteration speed without making normal successful runs awkward.
