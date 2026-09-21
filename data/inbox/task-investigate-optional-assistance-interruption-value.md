# When is an optional suggestion worth interrupting the user?

Explorer discovery, September 21, 2026.

[Proactive Service Agents](https://arxiv.org/html/2609.03727v1), a September 3
survey read online today (sections II, IV and VI), distinguishes silence,
questions, suggestions and external actions. It recommends evaluating complete
streams of decision opportunities, including occasions when help is unnecessary,
and warns that acceptance observed only after intervention cannot establish its
benefit over silence. This is a research framework, not a demonstrated KOTA
improvement or a validated implementation to adopt.

KOTA question: after completing a requested task, when should an assistant
surface an optional related suggestion, and when should it simply finish?
A hypothetical example is offering meeting preparation after answering a
schedule question. Correctly remembering the meeting does not establish that
the extra interruption is useful. This is not an observed product defect.

The existing `task-investigate-correction-reuse-in-later-assistance` owns whether
stored corrections affect later responses; do not duplicate its live comparison
or blocked setup. The archived proactive intent-resolution task covered hidden
intent and authorization. Its tests were subsequently retired, as documented in
the active correction task; that history proves neither current timing quality
nor a need to restore those tests. Scheduled reminders and required approvals
also have different contracts from optional suggestions.

Worth investigating: can attributable KOTA interactions identify a recurring
optional-interruption problem, and would a matched comparison of suggesting,
asking and finishing measure user benefit and burden? Keep the requested task
and available context comparable. Use existing session and evaluation owners;
do not prescribe a new proactive loop, notification policy or benchmark fixture
before establishing a useful product decision. No external messages, model
comparison or user study was performed in this exploration.
