import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionKey, SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { SessionRecoveryError } from "#core/agent-harness/session-continuity.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

const schema = z.object({
  key: z.object({ projectKey: z.string(), sessionId: z.string(), subpath: z.string().optional() }),
  entries: z.array(z.looseObject({ type: z.string(), uuid: z.string().optional(), timestamp: z.string().optional() })),
});

/** The SDK's native mirror/resume port; opaque provider entries stay adapter-owned. */
export function createClaudeSessionStore(directory: string, onSessionId?: (id: string) => void): SessionStore {
  const path = (key: SessionKey) => join(directory, `${createHash("sha256").update(JSON.stringify([key.projectKey, key.sessionId, key.subpath ?? null])).digest("hex")}.json`);
  const read = (file: string) => {
    const source = readFileSync(file, "utf8");
    try { return schema.parse(JSON.parse(source) as unknown); }
    catch { throw new SessionRecoveryError("The owned Claude transcript is corrupt; the original file was retained."); }
  };
  return {
    async append(key, entries) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = path(key);
      const previous = existsSync(file) ? read(file).entries : [];
      const ids = new Set(previous.flatMap((entry) => entry.uuid === undefined ? [] : [entry.uuid]));
      for (const entry of entries) {
        if (entry.uuid !== undefined && ids.has(entry.uuid)) continue;
        previous.push(entry);
        if (entry.uuid !== undefined) ids.add(entry.uuid);
      }
      writeJsonFileAtomic(file, { key, entries: previous }, undefined, { mode: 0o600 });
      if (key.subpath === undefined) onSessionId?.(key.sessionId);
    },
    async load(key) {
      const file = path(key);
      return existsSync(file) ? read(file).entries : null;
    },
    async listSubkeys(key) {
      if (!existsSync(directory)) return [];
      return readdirSync(directory).filter((name) => name.endsWith(".json")).flatMap((name) => {
        const candidate = read(join(directory, name)).key;
        return candidate.projectKey === key.projectKey && candidate.sessionId === key.sessionId && candidate.subpath !== undefined ? [candidate.subpath] : [];
      });
    },
  };
}
