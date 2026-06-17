import { checkRepoHygiene } from "#modules/autonomy/hygiene-check.js";
import { writeStderr, writeStdoutLine } from "#modules/rendering/transport.js";

try {
  writeStdoutLine(checkRepoHygiene(process.cwd()));
} catch (err) {
  writeStderr(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
