/** Enter checked directories in a disposable process; parent replacement cannot redirect a leaf read. */
export const EVIDENCE_READER_SOURCE = `
import { constants, openSync, closeSync, lstatSync, statSync, fstatSync, readSync, readFileSync } from "node:fs";
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
try {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const enter = (path, expected) => {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!same(fstatSync(fd), expected)) throw new Error("directory identity changed");
      process.chdir(path);
      if (!same(statSync("."), expected)) throw new Error("directory changed while anchoring");
    } finally { closeSync(fd); }
  };
  enter(request.root, request.identity);
  const parts = request.parts;
  if (!Array.isArray(parts) || parts.length === 0 || parts.some(p => typeof p !== "string" || p === "." || p === ".." || p.includes("/") || !p)) throw new Error("invalid evidence path");
  for (const part of parts.slice(0, -1)) {
    const observed = lstatSync(part);
    if (!observed.isDirectory() || observed.isSymbolicLink()) throw new Error("linked evidence directory");
    enter(part, observed);
  }
  const fd = openSync(parts.at(-1), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const observed = fstatSync(fd);
    if (!observed.isFile() || observed.nlink !== 1) throw new Error("evidence must be a private regular file");
    const bytes = Buffer.alloc(request.limit + 1);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > request.limit || observed.size > request.limit) throw new Error("evidence exceeds export limit");
    const final = fstatSync(fd);
    if (final.size !== observed.size || final.mtimeMs !== observed.mtimeMs || final.ctimeMs !== observed.ctimeMs) throw new Error("evidence changed during capture");
    process.stdout.write(JSON.stringify({ text: bytes.subarray(0, length).toString("utf8") }));
  } finally { closeSync(fd); }
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.code ?? error.message }));
}
`;
