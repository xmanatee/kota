# Backlog

This state is the normalized reserve queue.

- Keep only normalized tasks here: valid future work that is not selected for
  immediate execution.
- Priority is independent from this state.
- Tasks with unfinished `depends_on` predecessors may live here; they are
  reserve work and are not promotable until those predecessors are done.
- Do not use backlog for rough captures, blocked work, or forgotten work.
- Promote an item when it should enter the short execution queue; drop it when
  it is no longer worth doing.
