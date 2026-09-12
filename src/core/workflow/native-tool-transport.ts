import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { ToolResultEntry } from "#core/tools/tool-runner-types.js";

const requestSchema = z
  .object({
    name: z.string().min(1).max(128),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();
const resultSchema = z.object({
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});
const MAX_REQUEST_BYTES = 64 * 1024;
export type NativeToolExecutor = (
  name: string,
  input: Record<string, unknown>,
  id: string,
  signal: AbortSignal,
) => Promise<ToolResultEntry>;

/** Leaves are untrusted; parents are invocation-owned and not writable by the worker. */
function readRequest(path: string): z.infer<typeof requestSchema> {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_REQUEST_BYTES)
      throw new Error("Invalid native tool request file");
    const buffer = Buffer.alloc(MAX_REQUEST_BYTES + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > MAX_REQUEST_BYTES)
      throw new Error("Native tool request exceeds size limit");
    return requestSchema.parse(
      JSON.parse(buffer.subarray(0, size).toString("utf8")),
    );
  } finally {
    closeSync(fd);
  }
}

/** Part of the native authorization lifetime, not a queue or detached executor. */
export function nativeToolRequests(
  requests: string,
  responses: string,
  requireActive: () => void,
  execute: NativeToolExecutor | undefined,
) {
  const seen = new Set<string>();
  const pending = new Map<
    string,
    { controller: AbortController; settled: Promise<void> }
  >();
  let closed = false;
  return {
    poll(names: ReadonlySet<string>) {
      for (const [name, active] of pending) {
        try {
          requireActive();
          if (!names.has(name))
            throw new Error("Native tool requester cancelled");
        } catch (error) {
          active.controller.abort(error);
        }
      }
      for (const name of names) {
        if (closed || !/^tool-[a-f0-9]{32}$/.test(name) || seen.has(name))
          continue;
        seen.add(name);
        const controller = new AbortController();
        const settled = (async () => {
          let result: ToolResultEntry;
          try {
            requireActive();
            if (!execute)
              throw new Error(
                "Native tool execution unavailable for this invocation",
              );
            if (pending.size > 0)
              throw new Error(
                "A native tool invocation is already running; await its result",
              );
            const request = readRequest(join(requests, name));
            result = await execute(
              request.name,
              request.input,
              name,
              controller.signal,
            );
          } catch (error) {
            result = {
              tool_use_id: name,
              content: error instanceof Error ? error.message : String(error),
              is_error: true,
            };
          }
          // Return the same bounded text contract on every native transport.
          const temporary = join(responses, `${name}.tmp`);
          writeFileSync(
            temporary,
            JSON.stringify({
              tool_use_id: name,
              content: result.content.slice(0, 100_000),
              is_error: result.is_error,
            }),
            { flag: "wx" },
          );
          renameSync(temporary, join(responses, name));
        })().finally(() => pending.delete(name));
        pending.set(name, { controller, settled });
        void settled.catch(() => {});
      }
    },
    async close() {
      closed = true;
      for (const active of pending.values())
        active.controller.abort(new Error("Native invocation ended"));
      await Promise.all([...pending.values()].map((active) => active.settled));
    },
  };
}

export async function requestNativeTool(
  serviceRoot: string,
  name: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolResultEntry> {
  signal?.throwIfAborted();
  const capability = join(serviceRoot, "responses", "tool-protocol");
  if (!existsSync(capability) || readFileSync(capability, "utf8") !== "1") {
    throw new Error(
      "The hosting runtime does not support native tool calls. Publish the runtime update and use a newly admitted invocation.",
    );
  }
  const id = `tool-${randomBytes(16).toString("hex")}`;
  const request = join(serviceRoot, "requests", id);
  const temporary = `${request}.tmp`;
  const response = join(serviceRoot, "responses", id);
  const content = JSON.stringify(requestSchema.parse({ name, input }));
  if (Buffer.byteLength(content) > MAX_REQUEST_BYTES)
    throw new Error("Native tool request exceeds size limit");
  writeFileSync(temporary, content, { flag: "wx" });
  renameSync(temporary, request);
  try {
    while (true) {
      signal?.throwIfAborted();
      if (existsSync(response))
        return resultSchema.parse(JSON.parse(readFileSync(response, "utf8")));
      if (!existsSync(serviceRoot))
        throw new Error("Native invocation ended before returning a result");
      await delay(50, undefined, { signal });
    }
  } finally {
    rmSync(request, { force: true });
  }
}
