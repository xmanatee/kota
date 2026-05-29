import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_NOTES_DIR = fileURLToPath(new URL("../data/notes/", import.meta.url));

export function readNote(noteId, options = {}) {
  const notesDir = options.notesDir ?? DEFAULT_NOTES_DIR;
  const filePath = resolve(notesDir, `${noteId}.txt`);
  const body = readFileSync(filePath, "utf8").trimEnd();
  return { id: noteId, body };
}
