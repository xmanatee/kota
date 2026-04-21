# Reduce agent progress filler in run logs

The workflow prompt asks agents to work directly and avoid progress filler, but
recent run metadata still contains many narration fragments such as "Now let me"
and "I will".

Evidence:
- A simple scan over recent run metadata found 44 of 180 runs with these filler
  phrases, 212 phrase hits total.
- The filler makes run artifacts noisier, increases token usage, and makes
  operator review harder without improving correctness.

Desired direction:
- Decide whether this should be solved in prompt wording, output capture, or a
  lightweight artifact summarizer.
- Keep any change measurable: run-log scans should show lower filler density
  without suppressing useful final summaries or tool evidence.

