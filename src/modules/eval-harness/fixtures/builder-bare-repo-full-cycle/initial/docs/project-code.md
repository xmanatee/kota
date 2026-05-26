# Project Code Normalization

`normalizeProjectCode(input)` returns a stable slug for project labels.

Rules:

- Accept only string input; throw `TypeError("project code must be a string")`
  for non-strings.
- Trim leading and trailing whitespace.
- Lowercase ASCII letters.
- Treat each run of non-alphanumeric characters as a separator.
- Drop separators at the start or end.
- Join remaining alphanumeric segments with one hyphen.
- Throw `TypeError("project code requires letters or digits")` when no
  alphanumeric segment remains.

Required verification cases:

- `normalizeProjectCode("  North_Wind / 42 ")` returns `"north-wind-42"`.
- `normalizeProjectCode("Alpha__BETA---99")` returns `"alpha-beta-99"`.
- `normalizeProjectCode("!!!")` throws the empty-code `TypeError`.

The runnable project command should be:

```sh
pnpm test
```

Use Node's built-in test runner and set the package script exactly to:

```json
"test": "node --test test/project-code.test.mjs"
```
