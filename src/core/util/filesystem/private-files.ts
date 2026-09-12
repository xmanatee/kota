import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { PRIVATE_FILE_HELPER_SOURCE } from "./private-file-helper-source.js";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), snapshot: z.string().nullable() }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

type PrivateFileRequest = {
  path: string;
  roots: readonly string[];
} & (
  | { operation: "prepare" }
  | { operation: "publish"; snapshot: string | null; content: string }
);

function runPrivateFileHelper(request: PrivateFileRequest): string | null {
  const unavailable = (reason: string) => new Error(`Private file persistence is unavailable: ${reason}`);
  if (process.platform !== "linux") throw unavailable("requires Linux anonymous staging");
  const result = spawnSync("/usr/bin/python3", ["-I", "-c", PRIVATE_FILE_HELPER_SOURCE], {
    input: JSON.stringify(request),
    encoding: "utf8",
    env: {},
    maxBuffer: 16 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw unavailable("isolated filesystem helper failed");
  let response: z.infer<typeof responseSchema>;
  try {
    response = responseSchema.parse(JSON.parse(result.stdout));
  } catch {
    throw unavailable("invalid filesystem helper response");
  }
  if (!response.ok) throw unavailable(response.reason);
  return response.snapshot;
}

/**
 * Obtain private bytes only after capability admission, then revalidate in the
 * process that writes them. The caller owns policy; undefined roots mean an
 * unrestricted caller. This is entry replacement, not filesystem compare-and-swap.
 */
export async function publishPrivateFile(args: {
  filePath: string;
  allowedWriteRoots: readonly string[] | undefined;
  collect: () => Promise<string>;
}): Promise<void> {
  const path = resolve(args.filePath);
  const roots = args.allowedWriteRoots?.map((root) => resolve(root)) ?? [dirname(path)];
  const snapshot = runPrivateFileHelper({ operation: "prepare", path, roots });
  const content = await args.collect();
  runPrivateFileHelper({ operation: "publish", path, roots, snapshot, content });
}
