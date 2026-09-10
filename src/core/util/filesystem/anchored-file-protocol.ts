import { z } from "zod";

const identitySchema = z.object({
  dev: z.number().int().safe(),
  ino: z.number().int().safe(),
});

const fileSnapshotSchema = identitySchema.extend({
  size: z.number().int().safe().nonnegative(),
  mtimeMs: z.number().finite(),
  ctimeMs: z.number().finite(),
});

export type FileIdentity = z.infer<typeof identitySchema>;
export type FileSnapshot = z.infer<typeof fileSnapshotSchema>;
export type VerifiedFile = { content: string; snapshot: FileSnapshot };
export type VerifiedDirectoryEntry = VerifiedFile & { name: string };

export type FileAccess = {
  rootPath: string;
  boundaryDir: string;
  filePath: string;
};

export type MutationExpectation =
  | { expectation: "any" }
  | { expectation: "missing" }
  | { expectation: "existing"; expectedSnapshot: FileSnapshot };

export type PreparedDirectory = {
  createParent: boolean;
  parentParts: string[];
  parentPath: string;
  rootIdentity: FileIdentity;
  rootPath: string;
};

export type HelperRequest = PreparedDirectory &
  (
    | { operation: "list"; nameSuffix: string | null }
    | { operation: "read"; fileName: string }
    | ({ operation: "write"; fileName: string; content: string } & MutationExpectation)
    | { operation: "remove"; fileName: string; expectedSnapshot: FileSnapshot }
  );

const verifiedFileSchema = z.object({
  content: z.string(),
  snapshot: fileSnapshotSchema,
});

export const helperResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    entries: z.array(verifiedFileSchema.extend({ name: z.string() })).optional(),
    snapshot: z.discriminatedUnion("exists", [
      z.object({ exists: z.literal(false) }),
      verifiedFileSchema.extend({ exists: z.literal(true) }),
    ]).optional(),
    installedSnapshot: fileSnapshotSchema.optional(),
    removed: z.literal(true).optional(),
  }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);

export function unsafeFilesystemPath(path: string, reason: string): Error {
  return new Error(`Unsafe filesystem path ${path}: ${reason}`);
}
