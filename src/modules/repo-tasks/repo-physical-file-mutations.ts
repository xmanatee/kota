import {
  readVerifiedRepoMarkdownFileWithIdentity,
  removeAnchoredRepoMarkdownFile,
  unsafeRepoMutationPath,
  writeAnchoredRepoMarkdownFile,
} from "./repo-mutation-path-safety.js";

export function writeVerifiedRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  content: string;
}): void {
  writeAnchoredRepoMarkdownFile({ ...args, expectation: "any" });
}

function rollbackInstalledDestination(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  expectedSnapshot: ReturnType<typeof writeAnchoredRepoMarkdownFile>;
}): void {
  removeAnchoredRepoMarkdownFile(args);
}

export function moveVerifiedRepoMarkdownFile(
  args: {
    projectDir: string;
    sourceRootDir: string;
    sourcePath: string;
    destinationRootDir: string;
    destinationPath: string;
    sourceContent: string;
    destinationContent: string;
  },
): void {
  const source = readVerifiedRepoMarkdownFileWithIdentity({
    projectDir: args.projectDir,
    rootDir: args.sourceRootDir,
    filePath: args.sourcePath,
  });
  if (source === null) {
    throw new Error(`Repo mutation source does not exist: ${args.sourcePath}`);
  }
  if (source.content !== args.sourceContent) {
    throw unsafeRepoMutationPath(
      args.sourcePath,
      "source content changed before the move",
    );
  }

  const destinationSnapshot = writeAnchoredRepoMarkdownFile({
    projectDir: args.projectDir,
    rootDir: args.destinationRootDir,
    filePath: args.destinationPath,
    content: args.destinationContent,
    expectation: "missing",
  });
  try {
    removeAnchoredRepoMarkdownFile({
      projectDir: args.projectDir,
      rootDir: args.sourceRootDir,
      filePath: args.sourcePath,
      expectedSnapshot: source.snapshot,
    });
  } catch (removeError) {
    try {
      rollbackInstalledDestination({
        projectDir: args.projectDir,
        rootDir: args.destinationRootDir,
        filePath: args.destinationPath,
        expectedSnapshot: destinationSnapshot,
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [removeError, rollbackError],
        "Repo mutation source removal failed and the destination could not be safely rolled back",
      );
    }
    throw removeError;
  }

}

export function removeVerifiedRepoMarkdownFile(
  args: {
    projectDir: string;
    rootDir: string;
    filePath: string;
  },
): void {
  const source = readVerifiedRepoMarkdownFileWithIdentity(args);
  if (source === null) {
    throw new Error(`Repo mutation source does not exist: ${args.filePath}`);
  }
  removeAnchoredRepoMarkdownFile({
    ...args,
    expectedSnapshot: source.snapshot,
  });
}
