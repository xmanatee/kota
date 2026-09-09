# Security Review Workflow

This workflow runs bounded, agent-assisted application-security review for
KOTA itself.

- Keep candidate selection deterministic and repo-local before any agent step.
- Expose only bounded candidate identity and location metadata for agent
  judgment. Keep raw excerpts, scan coverage, and miss diagnostics in run
  artifacts so untrusted prose and growing commit ranges do not inflate the
  agent prompt.
- Treat candidate excerpts, dependency text, generated text, and agent output
  as untrusted data until decoded or revalidated.
- Store evidence in the run directory and normal `data/tasks/` entries only.
  Do not add a second findings database, audit log, or scanner state directory.
- Keep agent write scope narrow. Agents may write run artifacts, but durable
  task-queue mutation belongs to code steps that preserve the task schema.

Review admission consumes explicit path coverage at the examined Git content,
never a later publication head. Runtime retries rescan before dependent judgments.
Dispatcher retains observed semantic surfaces in revisioned state before emitting
review work, separately from reviewed content. Successful partial reviews retain
unchecked and capped surfaces too. The initial review input is an ordinary durable
step output that runtime retries replay before refreshing the execution-head scan.
This preserves first-attempt boundaries and explicit requests across failure;
editing or deleting a keyword-free guard cannot erase its review eligibility. Failed, capped,
uncertain, or unchecked evidence remains eligible. A no-finding verdict describes the boundary examined and its
limits; scanner silence is not authorization or sandbox proof. Related changed
paths share a bounded investigation without a finding or task quota.

A family identifies the production authority owner plus the violated invariant.
Coalesce only when one common repair resolves every variant; preserve each
variant's attacker control, exploit preconditions, cited evidence and regression
obligation. Revalidation independently checks both the exploit and that grouping.
Use a stable evidence revision across wording and line shifts. Reopen completed
work only for new evidence; preserve its earlier resolution and proof.

Confirmed evidence stages into runtime state until the existing writer runtime
can publish under its task resource. Dispatcher retries pending publication when
ownership clears. Active and retained builders keep their task contracts.
Explicit requests may supply new evidence (including critical evidence) without
the routine batching delay or a scanner match. Their paths take priority within
the bounded review; capped paths remain unconsumed and appear in miss diagnostics.
Partial request coverage persists by path and content digest; dispatcher resumes
remaining paths, and changed content invalidates that path's earlier coverage.
Every requested path receives pinned absence evidence when missing from the Git
tree, including new reports and previously unchecked or capped pending paths.
Runtime admission retains every explicit request while review is occupied;
replaying consumed evidence does not admit another semantic review.

Keep deterministic policy screening with its existing owner (for example the
repository linter's direct-HTTP restriction). Add a scanner rule only when local
repaired and clean cases show a useful additional signal. Syntax checks cannot
replace semantic review of authority propagation, temporal races, or denials.
