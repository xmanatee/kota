import test from "node:test";
import assert from "node:assert/strict";
import { readNote } from "../src/note-reader.mjs";

test("reads the welcome note", () => {
  assert.deepEqual(readNote("welcome"), {
    id: "welcome",
    body: "Welcome to the secure notes portal.",
  });
});

test("reads the release plan note", () => {
  assert.deepEqual(readNote("release-plan"), {
    id: "release-plan",
    body: "Roll out the signed release checklist by Friday.",
  });
});
