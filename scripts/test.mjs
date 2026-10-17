import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(new URL("vitest.mjs", import.meta.resolve("vitest/package.json")));
const child = spawn(process.execPath, [
  vitest, "run", ...process.argv.slice(2),
], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
  env: {
    ...process.env,
    TMPDIR: realpathSync(tmpdir()),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --conditions=source`.trim(),
  },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
});
