# knowledge-capture should LEARN, not just log

Today `knowledge-capture` writes one markdown file per successful builder/improver run into `.kota/data/` (type `run-insight`, body = task title + commit msg + files changed + duration + cost). Retrieval is keyword text-search. It's a per-run journal, not an accumulating knowledge base.

What's missing: genuine *learnings* — non-obvious rules, patterns, and guidelines that can't be derived from one or two bash commands or a single commit. The kind of thing that would belong in a project-level `AGENTS.md` or `LESSONS.md`, but discovered autonomously from recurring signals across many runs.

Investigate and decide:
- What's the right data shape for a "lesson" vs. a "run-insight"? (e.g. lessons have a supporting-evidence list of run IDs, get updated over time, get retired when stale.)
- Where should lessons live on disk? `data/lessons/`? A single rolling `data/LESSONS.md`? A typed entry in the knowledge store?
- Should distillation be a new step inside knowledge-capture, or a separate periodic workflow (e.g. weekly)?
- What signals justify promoting a pattern to a lesson? (Repeated failure mode across N runs, repair-loop check that keeps firing, cost anomaly in the same area, etc.)
- How does the builder/improver/explorer read lessons at prompt-construction time? Should they be injected as context, or queried via recall?
- De-duplication and expiry: how do we avoid a lessons file that just grows forever?

Also confirm: am I right that knowledge-capture today is *not* learning, or is there a distillation path I missed?

Generally i think there shouldn't be dedicated files with "lessons" but AGENTS.md files must be maintained nicely... they should contain all the info on problematic or non-trivial things in the code or guidelines of methodology or architechture...

Also this knowledge keeping must be evidence based: we should be able to distinguish between "agent forgets instructions" or "instructions aren't clear" or "there are no instructions".... Generally this system should be more scope-based and contextual and not lazy like now...