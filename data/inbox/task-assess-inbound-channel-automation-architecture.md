# Assess inbound channel automation architecture

Owner wants KOTA to cleanly support configured external channels as daemon
entry points, not only as notification sinks.

Scope to assess and normalize:

- Telegram client/bot as an inbound daemon entry point.
- Gmail/email inbox and outbound email.
- Calendar signals and calendar actions.
- X / ex-Twitter links, DMs, mentions, or other relevant social signals where
  access is configured.
- Other relevant platforms/channels that should map into the same architecture.

Desired shape:

- A message, email, calendar event, Telegram update, X/social signal, or similar
  inbound event can trigger a bounded automation workflow.
- The workflow can decide whether to create/update a task, capture memory or
  knowledge, answer/reply, schedule or update calendar state, ask the owner, or
  take no action.
- Channel modules should stay thin: authenticate, normalize inbound signals,
  enforce sender/chat/account trust, and emit typed events. They should not each
  invent their own planner, task classifier, calendar logic, or agent loop.
- The daemon owns dispatch, project scoping, workflow queueing, auditability,
  retries, and autonomy/approval posture.
- Owner-question and approval paths must remain first-class: if automation needs
  owner input, the owner can see the context, answer from a configured channel
  or CLI, and the waiting workflow resumes from that answer.

Check current reality before designing:

- Telegram already has interactive sessions, slash commands, owner-question
  notifications, inline owner-question answers, and reply-to-message answers.
- Email currently appears outbound-notification focused.
- Existing owner-question queue, approval queue, webhook/GitHub mention intake,
  capture, recall, answer, task, and calendar/scheduler surfaces may already
  provide pieces of the architecture.

Outcome:

- Create a normalized architecture task or design slice only if there is a real
  gap after inspecting existing channel modules.
- Prefer one simple typed inbound-event contract plus per-channel adapters over
  bespoke automation paths per platform.

