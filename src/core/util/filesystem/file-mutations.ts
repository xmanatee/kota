import { type FileAccess, unsafeFilesystemPath } from "./anchored-file-protocol.js";
import {
  readAnchoredTextFile,
  removeAnchoredTextFile,
  writeAnchoredTextFile,
} from "./anchored-files.js";

export function moveAnchoredTextFile(
  args: {
    rootPath: string;
    sourceBoundaryDir: string;
    sourcePath: string;
    destinationBoundaryDir: string;
    destinationPath: string;
    sourceContent: string;
    destinationContent: string;
  },
): void {
  const source = readAnchoredTextFile({
    rootPath: args.rootPath,
    boundaryDir: args.sourceBoundaryDir,
    filePath: args.sourcePath,
  });
  if (source === null) {
    throw new Error(`File move source does not exist: ${args.sourcePath}`);
  }
  if (source.content !== args.sourceContent) {
    throw unsafeFilesystemPath(
      args.sourcePath,
      "source content changed before the move",
    );
  }

  const destinationSnapshot = writeAnchoredTextFile({
    rootPath: args.rootPath,
    boundaryDir: args.destinationBoundaryDir,
    filePath: args.destinationPath,
    content: args.destinationContent,
    expectation: "missing",
  });
  try {
    removeAnchoredTextFile({
      rootPath: args.rootPath,
      boundaryDir: args.sourceBoundaryDir,
      filePath: args.sourcePath,
      expectedSnapshot: source.snapshot,
    });
  } catch (removeError) {
    try {
      removeAnchoredTextFile({
        rootPath: args.rootPath,
        boundaryDir: args.destinationBoundaryDir,
        filePath: args.destinationPath,
        expectedSnapshot: destinationSnapshot,
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [removeError, rollbackError],
        "File move source removal failed and the destination could not be safely rolled back",
      );
    }
    throw removeError;
  }
}

export function removeVerifiedTextFile(args: FileAccess): void {
  const source = readAnchoredTextFile(args);
  if (source === null) {
    throw new Error(`File source does not exist: ${args.filePath}`);
  }
  removeAnchoredTextFile({
    ...args,
    expectedSnapshot: source.snapshot,
  });
}
