---
status: open
priority: p3
---
# Can KOTA return a correctly updated workbook without damaging unrelated content?

Explorer lead, September 21, 2026. This is an unresolved product question, not
an observed KOTA defect or a request to import a benchmark.

[SpreadsheetBench 2, section 2.4 and appendix C](https://arxiv.org/html/2606.29955v1)
separates correctness of requested cell modifications from whole-workbook
correctness, including cells outside the edit target. Its inspection tool exposes
both formulas and evaluated values. Appendix A notes limited domain coverage,
no reported confidence intervals, and potential penalties for equivalent
solutions. These distinctions inform an investigation; its scores do not
measure KOTA.

The [project README](https://github.com/RUCKBReasoning/SpreadsheetBench-2)
requires recalculating input and reference workbooks before experiments and
refreshing output caches with LibreOffice before cell evaluation. Chart
evaluation has a separate Windows Excel/WPS COM dependency. The
[openpyxl formula documentation](https://openpyxl.readthedocs.io/en/stable/simple_formulae.html)
says the library does not evaluate formulas; its
[loading tutorial](https://openpyxl.readthedocs.io/en/stable/tutorial.html#loading-from-a-file)
explains that `data_only` reads stored results and warns that some workbook
features are lost on a save round trip. All four sources were read online;
neither benchmark code nor a KOTA workbook journey was executed.

KOTA relevance: `src/modules/filesystem/file-read-formats.ts` directs `.xlsx`
inspection to pandas with openpyxl. The read-document module extracts document
text. Those source observations neither establish spreadsheet editing quality
nor rule out successful work through general execution tools or installed
capabilities. The archived read-document capability-pack task owns extraction,
not this outcome. Searches of active tasks, inbox, archived spreadsheet-related
work and the external-pattern decision catalog found no matching investigation.

Useful question: when asked to update quantities in a local inventory workbook,
can the assistant deliver the actual updated file with correct cross-sheet
totals while preserving unrelated sheets and formulas? First examine supported
tools and existing attributable examples. If observation is warranted, retain
the original and delivered workbooks, request, actual response and verification
method. Distinguish formula text, cached values and freshly recalculated results;
state the spreadsheet engine used. Check requested changes and unrelated
content separately, allowing equivalent formulas and intended dependent-value
changes. A successful save or unchanged cache is insufficient evidence.

This may resolve to adequate existing behavior, reusable guidance, a concrete
capability gap, or insufficient evidence. Do not prescribe a new module, runner,
fixture, office-suite installation or model change before that finding. Use the
existing authorized execution and evidence owners for any live observation;
the availability of an applicable profile remains unverified in this pass.

## Research Outcome And Acceptance

Determine what current KOTA tools and attributable evidence establish about
delivering the requested workbook edit, and identify any remaining uncertainty
or concrete gap. No urgency was specified; this is a p3 investigation.

- Inspect supported capabilities and existing relevant evidence before deciding
  whether a new observation is needed. Distinguish extraction support from
  editing, recalculation, preservation and delivery of the actual file.
- If an observation is needed, use the local inventory example above through
  an existing authorized KOTA execution path. Retain the request, actual
  response, original and delivered files, relevant execution attribution and
  verification method. Assess requested edits and cross-sheet totals separately
  from preservation of unrelated sheets and formulas; distinguish formula text,
  cached values and fresh recalculation, naming the engine used.
- Record a grounded disposition: adequate existing behavior, reusable guidance,
  a concrete deduplicated capability follow-up, or explicitly insufficient
  evidence. Do not infer a defect from benchmark results or unavailable tools.
  If further observation needs unavailable external authority, record the
  specific prerequisite under the existing blocked-task contract after
  completing independently available investigation.

The source-reading claims above are preserved from the September 21 explorer
capture. Inbox triage did not repeat that research or execute a workbook journey.
The active queue contains no matching workbook investigation; the archived
read-document capability-pack task concerns extraction and does not own this
outcome. Adjacent live model and coding-parity tasks do not make this initial
investigation dependent on their completion.
