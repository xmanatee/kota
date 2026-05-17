# pr-reviewer-agent-call-replay fixture

End-to-end replay of pr-reviewer's read-only `review` agent step plus the
deterministic `github_comment` output path. The fixture forwards a
`github.pull_request` payload, replays the review agent from
`recordings/review.json`, then posts through a fixture-local GitHub module so
the subprocess never needs host credentials or network access.

## Why this fixture is a smoke fixture

pr-reviewer fires only on `github.pull_request` webhooks, and KOTA's own
dogfood loop has not produced a real pr-reviewer run on this branch yet. With
no real failure to encode, the fixture's honest provenance is
`smoke-fixture`. The recording is synthesized from the workflow's current
contract: structured JSON with `recommendation` and `body`.

## Shape

- `initial/.kota/config.json` allows `github_comment` for this isolated
  fixture project, so the explicit approval step is skipped and the subprocess
  can complete deterministically.
- `initial/.kota/modules/github-comment-fixture/index.js` contributes
  read-only `github_get_pr` / `github_list_prs` fakes and a `github_comment`
  recorder. The recorder writes
  `.kota/external-calls/github_comment.jsonl`.
- `recordings/review.json` returns the strict JSON shape the workflow's
  `outputFormat: "json"` schema requires.

## Predicate rationale

- Metadata predicates assert the `review`, `prepare-comment`, `post-comment`,
  and `emit-review-posted` steps succeeded.
- `run-emits-event` asserts the final `workflow.pr.review.posted` payload.
- File predicates assert exactly the fixture-local `github_comment` recorder
  was called for PR `42` in `kota-test/example`.
