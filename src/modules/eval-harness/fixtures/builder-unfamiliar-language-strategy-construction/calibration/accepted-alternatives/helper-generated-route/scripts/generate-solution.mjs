import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("programs", { recursive: true });
writeFileSync(
  "programs/solution.spool",
  [
    "# Helper-generated Spool route; comments are ignored by the verifier.",
    "READ phrase",
    "CLEAN36",
    "SHIFT36 seed 3",
    "RAIL 3 seed 2 0 1",
    "CHECKSUM36 seed 2",
    "GROUP 4 .",
    "EMIT",
    "",
  ].join("\n"),
);
