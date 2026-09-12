import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type NativeToolExecutor,
  nativeToolRequests,
  requestNativeTool,
} from "./native-tool-transport.js";

let root: string;
let service: ReturnType<typeof nativeToolRequests> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "native-tools-"));
  mkdirSync(join(root, "requests"));
  mkdirSync(join(root, "responses"));
  writeFileSync(join(root, "responses", "tool-protocol"), "1");
});
afterEach(async () => {
  clearInterval(timer);
  await service?.close();
  service = undefined;
  rmSync(root, { recursive: true, force: true });
});
function start(execute: NativeToolExecutor, active = () => {}) {
  service = nativeToolRequests(
    join(root, "requests"),
    join(root, "responses"),
    active,
    execute,
  );
  timer = setInterval(
    () => service!.poll(new Set(readdirSync(join(root, "requests")))),
    5,
  );
}
it("returns a bounded tool result and never reexecutes a replayed request identity", async () => {
  const execute = vi.fn<NativeToolExecutor>(async (_name, input, id) => ({
    tool_use_id: id,
    content: JSON.stringify(input),
  }));
  start(execute);
  const result = await requestNativeTool(root, "inspect", { value: 42 });
  expect(result.content).toBe('{"value":42}');
  writeFileSync(
    join(root, "requests", result.tool_use_id),
    JSON.stringify({ name: "inspect", input: { value: "changed" } }),
  );
  service!.poll(new Set(readdirSync(join(root, "requests"))));
  expect(execute).toHaveBeenCalledTimes(1);
});
it("denies revoked authority and linked request leaves before executing", async () => {
  const execute = vi.fn<NativeToolExecutor>();
  start(execute, () => {
    throw new Error("attempt revoked");
  });
  expect(await requestNativeTool(root, "inspect", {})).toMatchObject({
    is_error: true,
    content: "attempt revoked",
  });
  expect(execute).not.toHaveBeenCalled();
  clearInterval(timer);
  await service!.close();
  start(execute);
  const id = `tool-${"a".repeat(32)}`;
  const target = join(root, "payload");
  writeFileSync(target, JSON.stringify({ name: "inspect", input: {} }));
  symlinkSync(target, join(root, "requests", id));
  await vi.waitFor(() =>
    expect(
      JSON.parse(readFileSync(join(root, "responses", id), "utf8")),
    ).toMatchObject({ is_error: true }),
  );
  expect(execute).not.toHaveBeenCalled();
});
it("cancels removed requests and drains their cleanup before admitting another invocation", async () => {
  let releaseCleanup!: () => void;
  let cancelled = false;
  const execute = vi.fn<NativeToolExecutor>(
    async (_name, _input, id, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            resolve();
          },
          { once: true },
        ),
      );
      await new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      return { tool_use_id: id, content: "cancelled", is_error: true };
    },
  );
  start(execute);
  const controller = new AbortController();
  const call = requestNativeTool(root, "run", {}, controller.signal);
  const observed = expect(call).rejects.toThrow();
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  controller.abort();
  await observed;
  await vi.waitFor(() => expect(cancelled).toBe(true));
  expect(await requestNativeTool(root, "run", {})).toMatchObject({
    is_error: true,
    content: expect.stringContaining("already running"),
  });
  let closed = false;
  const closing = service!.close().then(() => {
    closed = true;
  });
  expect(closed).toBe(false);
  releaseCleanup();
  await closing;
  expect(execute).toHaveBeenCalledTimes(1);
});
it("returns runner failure and rejects a host without transport support immediately", async () => {
  start(async () => {
    throw new Error("evaluation setup failed");
  });
  expect(await requestNativeTool(root, "run", {})).toMatchObject({
    is_error: true,
    content: "evaluation setup failed",
  });
  rmSync(join(root, "responses", "tool-protocol"));
  await expect(requestNativeTool(root, "run", {})).rejects.toThrow(
    "hosting runtime does not support",
  );
});
