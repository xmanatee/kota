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
