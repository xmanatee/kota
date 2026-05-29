import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_NOTES_DIR = fileURLToPath(new URL("../data/notes/", import.meta.url));
const NOTE_ID_PATTERN = /^[a-z0-9-]+$/;

function noteError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveNotePath(noteId, notesDir) {
  if (typeof noteId !== "string" || !NOTE_ID_PATTERN.test(noteId)) {
    throw noteError(
      "INVALID_NOTE_ID",
      "Note id must contain only lowercase letters, numbers, and hyphens",
    );
  }
  const root = resolve(notesDir);
  const candidate = resolve(root, `${noteId}.txt`);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw noteError("INVALID_NOTE_ID", "Note id resolves outside the notes directory");
  }
  return candidate;
}

export function readNote(noteId, options = {}) {
  const notesDir = options.notesDir ?? DEFAULT_NOTES_DIR;
  const filePath = resolveNotePath(noteId, notesDir);
  try {
    const body = readFileSync(filePath, "utf8").trimEnd();
    return { id: noteId, body };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw noteError("NOTE_NOT_FOUND", "Note not found");
    }
    throw err;
  }
}
