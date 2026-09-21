---
status: blocked
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

## Investigation — September 21, 2026

Disposition: **insufficient evidence; live observation blocked on a host grant or
an equivalent attributable export**. No workbook defect, successful edit, or
preservation guarantee has been established. No production change or new
capability task is justified by the evidence collected so far.

Source inspected at `a0f11e3743b39c226ea27c74e39522f03fac6ddf`:

- `src/modules/filesystem/file-read-formats.ts` recognizes `.xlsx` and returns
  a pandas/openpyxl inspection hint. This is format routing, not workbook
  extraction, an editor, or a correctness check.
- `src/modules/read-document/index.ts` and its scoped guidance own text
  extraction from PDF, DOCX, RTF, ODT, EPUB and HTML; they do not claim XLSX
  editing or recalculation.
- `src/modules/execution/index.ts` registers shell, process, Python/Node REPL
  and computer-use tools. `code-exec.ts` returns execution text and captured
  plot images. General code can manipulate a workbook when the necessary
  libraries are available, but this surface supplies no workbook-specific
  preservation or recalculation contract.
- `src/modules/google-workspace/drive.ts` exports Google spreadsheets as CSV
  and returns text. That read path does not establish local XLSX round-trip
  fidelity. `src/modules/telegram/client.ts` flushes agent output through
  text messages; it is not evidence of outbound workbook delivery. A local
  file path, an MCP resource, and a successfully delivered file are distinct
  observations. No channel delivery was attempted.

Searches for workbook/spreadsheet/XLSX evidence in source, active and archived
tasks, inbox, eval fixtures and harness-parity found no attributable inventory
edit journey. Matches concerned format routing, Drive metadata/read behavior,
and unrelated uses of the word spreadsheet. The supplied `issue-evidence.json`
contains a MiMo research task mutation, not a workbook request or output.
This is a bounded evidence search, not a claim that no historical user session
has ever edited a workbook; private conversation stores were not inspected.

The openpyxl formula and loading documentation linked above was re-read online:
formula text is not calculation, `data_only` reads saved results, and the loader
warns about lost shapes. The benchmark README was also re-read and requires
refreshing output caches with LibreOffice. These establish verification risks,
not a KOTA failure. No benchmark was imported or executed.

The current sandbox Python could not discover openpyxl, pandas, xlsxwriter,
formulas or pycel. Neither `libreoffice` nor `soffice` resolved on PATH; standard
LibreOffice and Excel application paths were not observed. These facts apply
only to this builder environment and do not establish host-wide absence.

The supported native command
`pnpm kota eval contained '{"operation":"inspect"}'` reached the host tool and
returned exit 1, `is_error: true`, with the explicit instruction to configure
`KOTA_EVAL_CONTAINED_PROFILES` in the trusted host environment. It did not
return an applicable profile. This was an actual authority-owner response,
not a deduction from sandbox access denial. The request, exact tool response,
source identity and local capability observations are retained in
`workbook-capability-inspection.json` under the artifacts of builder run
`2026-09-21T04-53-16-898Z-builder-kys0mz` (tool use
`tool-4c72b5ca7672f7323bff07d7db33743a`). No agent workbook request was executed;
there are no original/delivered files, actual workbook response or fresh
spreadsheet-engine results to report.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An applicable host-authorized KOTA workbook observation with recalculation, or equivalent attributable request, response, workbook and verification evidence.

The path is an evidence-discovery hint, not a required capture location.

An operator-controlled execution grant that permits this local inventory
observation through KOTA's existing contained evaluation owner, with an
available workbook editor and a named recalculation engine, or equivalent
attributable evidence from an already authorized KOTA session. Setup belongs
to `src/modules/eval-harness/contained-evaluation.md`; the worker cannot supply
host profiles, credentials or host access. An equivalent export can come from
any authorized location and must identify the task/session/run and actual
request, response, input and delivered file. No particular office suite,
model, capture directory, or new module is required. Do not restart the parent
daemon or grant candidate code host authority to collect this observation.

On resumption, use a small inventory with two edited quantities, an unchanged
item, cross-sheet totals, and an unrelated sheet with constants and a formula.
For example, quantities 2/3/4 at unit prices 5/7/11 total 75; changing only the
first two quantities to 6/1 must produce 81 after fresh recalculation. Preserve
the original and the actual delivered workbook before recalculating copies.
Record the engine/version and distinguish pre-existing caches, delivered
caches, formula text, and freshly calculated results. Check requested values
and dependent totals separately from unrelated cell values/formulas, sheet
structure, formatting and any features actually present. Allow equivalent
formulas and intended dependent-value changes; use independently computed
expected totals. Retain the real request/response and file delivery evidence.
A handcrafted edit by the investigator alone would not establish the assistant
journey, and a single successful example would not prove arbitrary-workbook
fidelity.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T05:03:03.133Z -->
