import { tmpdir } from "node:os";
import { join } from "node:path";

// Daemon fixtures must never read or write the developer's operator credential.
process.env.KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH ??= join(
  tmpdir(),
  `kota-vitest-scope-authority-token-${process.pid}.json`,
);
