# badge-code CLI

`badge-code` turns a short label into a stable badge family and checksum.

Run the candidate implementation:

```sh
node src/badge-code.mjs "Alpha 7"
```

Run the reference oracle:

```sh
node oracle/run-reference.mjs "Alpha 7"
```

The CLI accepts exactly one label argument. `--help` or `-h` prints help and
exits successfully.

Normalization rules:

- Trim leading and trailing whitespace.
- Convert ASCII letters to lowercase.
- Collapse runs of spaces, underscores, or hyphens into one `-`.
- Remove leading and trailing `-` after collapsing.
- Reject a label that contains characters outside ASCII letters, digits,
  spaces, underscores, and hyphens.
- Reject a normalized label with no alphanumeric characters.
- Reject a normalized label longer than 24 characters.

Successful output is one line:

```text
<normalized-label> <family>-<checksum>
```

`family` is one of `amber`, `cobalt`, `fern`, `slate`, or `violet`.
`checksum` is an uppercase base-36 value padded to two characters. The exact
weighted checksum behavior is intentionally not documented; use the reference
oracle to discover it from observations.

Errors print one `error: ...` line to stderr and exit with status `2`.

Examples:

```text
$ node oracle/run-reference.mjs "Alpha 7"
alpha-7 slate-8A

$ node oracle/run-reference.mjs "  north__gate  "
north-gate violet-6I

$ node oracle/run-reference.mjs "MIXED_case-42"
mixed-case-42 slate-GM

$ node oracle/run-reference.mjs "Z9"
z9 violet-0Y
```
