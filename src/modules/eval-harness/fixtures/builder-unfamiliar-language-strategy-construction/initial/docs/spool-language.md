# Spool Language

Spool programs are plain text files. Blank lines and lines starting with `#`
are ignored. Every other line is one instruction with space-separated tokens.
The interpreter keeps a single tape string and reads one JSON-like case object.

Legal instructions:

```text
READ <field>
CLEAN36
SHIFT36 <numeric-field> <step>
RAIL <bucket-count> <offset-field> <order...>
CHECKSUM36 <numeric-field> <width>
GROUP <width> <separator>
EMIT
```

Rules:

- `READ phrase` loads the case field as text.
- `CLEAN36` uppercases the tape and removes every character outside
  `A-Z0-9`.
- `SHIFT36 seed 3` shifts each tape glyph in alphabet
  `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`. The shift amount is
  `case.seed + 3 * oneBasedIndex`.
- `RAIL 3 seed 2 0 1` partitions characters into three buckets using
  `(zeroBasedIndex + case.seed) mod 3`, then concatenates buckets in the
  given order.
- `CHECKSUM36 seed 2` appends a two-glyph base36 checksum. The checksum value
  is `(case.seed + sum(value(glyph) * oneBasedIndex)) mod 1296`, using the
  current tape after rail reassembly.
- `GROUP 4 .` inserts `.` every four glyphs.
- `EMIT` returns the current tape.

Invalid instructions fail the verifier. Spool has no string-output or
conditional instruction; a correct solution should be a general route-key
program rather than a lookup table.
