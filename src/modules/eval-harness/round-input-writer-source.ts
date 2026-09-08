/**
 * Node has no openat/renameat API. A dedicated process pins each destination
 * directory as its cwd, checking it against an O_NOFOLLOW directory descriptor
 * before doing any relative writes. Replacing an ancestor path cannot redirect
 * those writes. The workspace's parent is host-owned; candidates can rename
 * descendants only within their workspace mount.
 */
export const ROUND_INPUT_WRITER_SOURCE = `
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, sep } from "node:path";

function enterDirectory(path) {
  const fd = openSync(path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    process.chdir(path);
    const entered = statSync(".");
    if (!opened.isDirectory() || opened.dev !== entered.dev || opened.ino !== entered.ino) {
      throw new Error("destination directory changed during traversal");
    }
  } finally {
    closeSync(fd);
  }
}

try {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) {
    throw new Error("symlink-safe directory traversal is unavailable");
  }
  const [root, target, mode] = process.argv.slice(1);
  const parts = target.split(sep);
  if (!isAbsolute(root) || isAbsolute(target) ||
      parts.some(part => !part || part === "." || part === "..")) {
    throw new Error("invalid round input destination");
  }
  const contents = readFileSync(0);
  enterDirectory(root);
  for (const component of parts.slice(0, -1)) {
    try {
      mkdirSync(component);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    enterDirectory(component);
  }
  const filename = parts[parts.length - 1];
  try {
    if (!lstatSync(filename).isFile()) {
      throw new Error("round input destination must be a regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Exclusive creation and descriptor writes never truncate an existing link.
  // Rename replaces the leaf itself, including a link swapped in concurrently.
  const temporary = ".kota-round-input-" + randomUUID();
  const fd = openSync(temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    Number(mode));
  try {
    writeFileSync(fd, contents);
    renameSync(temporary, filename);
  } finally {
    closeSync(fd);
    try { unlinkSync(temporary); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
} catch (error) {
  process.stderr.write("Round input copy refused: " + error.message);
  process.exitCode = 1;
}
`;
