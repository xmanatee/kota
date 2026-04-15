Currently the output of `pnpm build && node dist/cli.js daemon` seems to be 
```
KOTA Daemon  pid 58013  up 5h 21m  running
────────────────────────────────────────────────────

  Completed  77      Sessions  0
  Cost       $1470.04Defs      9
  Paused     yes

Pending 1

Last
  attention-digest  success  5h ago

────────────────────────────────────────────────────
  Daemon starting...
  Control API on http://127.0.0.1:60543
  Queued 2 recovery workflows for dirty worktree left by "attention-digest" (2026-04-15T06-35-18-177Z-attention-digest-hxmdrg): R  data/tasks/backlog/task-add-workflow-execution-tracing-with-structured-spa.md -> data/tasks/done/task-add-workflow-execution-tracing-with-structured-spa.md, M  package.json, M  pnpm-lock.yaml, M  src/core/agent-sdk/executor.ts, M  src/core/agent-sdk/types.ts (+6 more)
  Dispatching workflow "attention-digest"
  Starting workflow "attention-digest" (2026-04-15T06-35-33-592Z-attention-digest-p6l628)
  [kota-slack] No config — channel disabled
  Starting step "digest" (code) in workflow "attention-digest"
  Channel started: slack-channel
  [module:webhook-channel] webhook-channel: channel started
  Channel started: webhook-channel
  Daemon running (pid 58013)
  Scheduler poll: 30000ms
  Workflows: 9
  Pending schedules: 0
  Completed step "digest" (code) in workflow "attention-digest" [3ms]
  Completed workflow "attention-digest" (2026-04-15T06-35-33-592Z-attention-digest-p6l628)
  Recovery already attempted for dirty worktree left by "attention-digest" (2026-04-15T06-35-33-592Z-attention-digest-p6l628). Dispatch paused: R  data/tasks/backlog/task-add-workflow-execution-tracing-with-structured-spa.md -> data/tasks/done/task-add-workflow-execution-tracing-with-structured-spa.md, M  package.json, M  pnpm-lock.yaml, M  src/core/agent-sdk/executor.ts, M  src/core/agent-sdk/types.ts (+6 more)
  Queued workflow "dispatcher" from event "runtime.idle"
```

I don't like it... to many ugly id's, unnecessary details, weird alignment/formatting, no clean separation, no adjustment to the terminal height/width, full timestamps, e.t.c.

Really research and investigate what are the options to make it clean and nice and maintainable and extendable... possibly i may want to make it interactive in future (with some controls)... it should also be clean and clear and actually usefull... 

(if it's to big of a change you can split it into multiple tasks...)