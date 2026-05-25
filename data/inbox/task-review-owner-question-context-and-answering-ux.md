# Review owner-question context and answering UX

Owner asked how they should know about open owner questions, whether enough
context is available, and whether automation resumes automatically after an
answer.

Current mechanism to inspect before normalizing:

- `ask_owner` is enqueue-only for interactive agents.
- Workflow-owned escalations should use `askOwnerSteps`, which enqueues,
  waits on `owner.question.resolved`, then consumes the resolved queue item.
- `kota owner-question list/count/answer/dismiss/history` is the CLI surface.
- Telegram sends owner-question notifications, proposed-answer inline buttons,
  dismissal, and reply-to-message free-form answers.
- Email formats `owner.question.asked` with question/reason/source and CLI
  commands.

Likely UX gap to verify:

- Notifications include question/reason/source/id, but may not include the full
  `context` field that agents provide.
- CLI list includes context, but truncates it; history focuses on
  question/answer and may not provide enough surrounding run/task context.
- Owner should be able to open a question and see: source workflow/session,
  run id if available, task id if available, full context, proposed answers,
  timeout/default behavior, and exact effect of answer vs dismiss.

Desired outcome:

- Owner can easily discover pending questions from configured channels and CLI.
- Owner can answer from Telegram/CLI/HTTP and trust that waiting workflows
  resume automatically when the question was created through `askOwnerSteps`.
- Interactive fire-and-forget `ask_owner` behavior is documented honestly:
  answer is recorded but there is no suspended workflow to resume unless a
  workflow used the wait recipe.

