# Tune empty-queue explorer-builder loop

Source / intent: Broad daemon review on 2026-04-28 found recent workflow
reliability is excellent, but the empty-queue cycle often becomes:

1. dispatcher sees empty/thin queue
2. explorer creates one task
3. builder ships one task
4. repeat

Recent run stats since 2026-04-27: 1,429 runs, 1,425 successes, about $501
agent cost. Builder consumed about $393 and explorer about $103.

Desired outcome: Assess whether the loop should batch more strategically,
raise the bar for explorer-generated work, or slow/shape empty-queue churn
without adding blunt daily spend caps. Preserve the good reliability and the
repo rule that autonomy should improve queue/prompt/validation quality before
defaulting to hard caps.
