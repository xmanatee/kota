# Raise explorer idea quality bar

Source / intent: Broad daemon review on 2026-04-28 found explorer research is
useful and the watchlist is high quality, but recent outputs skew toward small
p2 surface-completion tasks once the queue is empty.

Desired outcome: Improve explorer so it more often proposes high-leverage,
strategic, architecture-improving work when the queue is thin, instead of
mainly opening one more fan-out or parity task. It should still preserve honest
source handling and avoid speculative tasks from unread/gated resources.

Possible acceptance evidence:

- Explorer output contains explicit rationale for why the new task is more
  valuable than existing blocked architecture work.
- Thin-queue exploration can choose to promote/decompose existing strategic
  blockers instead of adding unrelated work.
- Run artifacts make the idea-quality decision inspectable.
