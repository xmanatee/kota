# Progress Reviewer Workflow

This workflow owns bounded evidence review for scoped activity.

- Collect structured evidence first, then let the reviewer assess it.
- Bind runtime-authored evidence to its pre-agent digest. The reviewer receives
  a machine-enforced per-run `agent-output/` directory while sibling evidence,
  step state, and run metadata remain runtime-owned inputs rather than
  agent-authored authority. Its project write scope is `deny-all`.
- Keep the reviewer evaluative: it may create normal follow-up tasks or owner
  questions, but it must not directly mutate product code.
- Every review artifact must state its scope, trigger kind, evidence window,
  included evidence, excluded evidence, and applied actions.
- Dedupe before creating tasks or owner questions so recurring reviews do not
  spam the queue.
