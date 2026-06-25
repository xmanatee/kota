# Source Recheck Evidence

Checked on 2026-06-25 during repair attempt 2 with the browser read tool.

## OpenAI overview

URL: https://openai.com/index/codex-maxxing-long-running-work/

Fetch/read result: reachable HTML page. The page is dated 2026-06-22 and
introduces the whitepaper as guidance for work that continues beyond one
prompt. Processed signal for this task: the overview frames the product value
as preserving context, managing complex workflows, sustaining progress across
long-running projects, breaking goals into verifiable steps, and deciding when
human oversight is valuable.

KOTA mapping: the continuity surface should be an operator review point for
existing durable state, not a replacement runtime. It should show progress,
review targets, and unblock decisions clearly enough that an operator can
resume oversight without reconstructing the workstream from separate commands.

## OpenAI whitepaper

URL: https://cdn.openai.com/pdf/8a9f00cf-d379-4e20-b06f-dd7ba5196a11/OAI_WhitePaper_Codex-maxxing26.pdf

Fetch/read result: reachable 27-page PDF. Processed signal for this task:
the guide's durable-work sections center on threads as a home for work,
memory as reviewable context, browser/computer surfaces for artifact work,
remote control for unblocking long tasks, recurring automations as wake-up
loops, goals with concrete verification, and an artifact side panel where the
human and agent inspect the same object.

KOTA mapping: KOTA already has tasks, sessions, workflow runs, schedules,
approvals, owner questions, owner decisions, setup requirements, memory,
knowledge, and run artifacts. The implemented surface composes those stores
into one daemon-backed projection so the operator sees recent work, review
links, recurring follow-ups, memory/knowledge hints, and the next action.

## Jason Liu source article

URL: https://jxnl.co/writing/2026/05/10/codex-maxxing/

Fetch/read result: reachable HTML article dated 2026-05-10. Processed signal
for this task: the source article says the behavior change came from giving
work an operating loop made of durable threads, shared memory, tools, steering
and resume paths, plus an artifact review surface. Its goals section stresses
that long-running work needs a real finish line and verification, and its side
panel section treats artifact inspection and annotation as part of the loop.

KOTA mapping: the surface needs concrete state, not a narrative summary. That
is why it renders distinct empty, healthy, blocked, and failed states; includes
route actions to existing task/run/artifact/setup/decision surfaces; and leaves
verification to tests plus the rendered CLI transcript in this run directory.
