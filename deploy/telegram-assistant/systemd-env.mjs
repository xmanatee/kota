// Encode the deploy's literal KEY=VALUE inputs for EnvironmentFile. Input keys
// are validated by install.sh before this adapter runs; values never execute.
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const encoded = lines.filter((line) => line.trim() && !line.trimStart().startsWith("#"))
  .map((line) => {
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `${key}="${value}"`;
  });
writeFileSync(process.argv[3], `${encoded.join("\n")}\n`, { mode: 0o600 });
