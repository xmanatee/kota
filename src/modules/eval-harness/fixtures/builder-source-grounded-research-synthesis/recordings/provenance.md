# Recording Provenance

Source run: `2026-06-24T04-39-44-641Z-builder-gfdmek`

Source project workspace:
`/var/folders/t4/jr0r_vd10sq3tbdzf9d2g9400000gn/T/kota-eval-builder-source-grounded-research-synthesis-3v4rbh`

This fixture is intentionally `smoke-fixture` provenance because it covers a
new research-synthesis measurement gap rather than a known historical KOTA
failure. The replay recordings are nevertheless produced through the normal
`record-agent-step` authoring path from a completed source workflow run in the
fixture project, not hand-written from the in-flight KOTA fixture-authoring run.

Relevant source artifacts:

- `.kota/eval-runs/2026-06-24T04-39-43-613Z/builder-source-grounded-research-synthesis-0/fixture-run.json`
- `/var/folders/t4/jr0r_vd10sq3tbdzf9d2g9400000gn/T/kota-eval-builder-source-grounded-research-synthesis-3v4rbh/.kota/runs/2026-06-24T04-39-44-641Z-builder-gfdmek/steps/build.json`
- `/var/folders/t4/jr0r_vd10sq3tbdzf9d2g9400000gn/T/kota-eval-builder-source-grounded-research-synthesis-3v4rbh/.kota/runs/2026-06-24T04-39-44-641Z-builder-gfdmek/steps/commit.json`
- `/var/folders/t4/jr0r_vd10sq3tbdzf9d2g9400000gn/T/kota-eval-builder-source-grounded-research-synthesis-3v4rbh/.kota/runs/2026-06-24T04-39-44-641Z-builder-gfdmek/critic-review.json`

Extraction commands:

```sh
pnpm kota eval run --fixture builder-source-grounded-research-synthesis --repeats 1 --keep
node /Users/xmanatee/Desktop/mono/apps/kota/bin/kota.mjs eval record-agent-step --run-id 2026-06-24T04-39-44-641Z-builder-gfdmek --step build --fixture builder-source-grounded-research-synthesis
node /Users/xmanatee/Desktop/mono/apps/kota/bin/kota.mjs eval record-agent-step --run-id 2026-06-24T04-39-44-641Z-builder-gfdmek --judge critic-review --fixture builder-source-grounded-research-synthesis
```

The `record-agent-step --step build` invocation reported source commit
`005ecdaae924`, extracted four repo-tree operations from that commit, and
found three run-directory artifacts in the completed source run. The curated
recording retains only `commit-message.txt`, which is the current
agent-authored run-directory contract. The source commit touched only:

- `data/tasks/done/task-synthesize-support-triage-ingestion-decision.md`
- `data/tasks/ready/task-synthesize-support-triage-ingestion-decision.md`
- `research-synthesis-result.json`
- `research-synthesis-verification.json`
