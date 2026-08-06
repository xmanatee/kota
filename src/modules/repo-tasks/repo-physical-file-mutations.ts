import {
  readVerifiedRepoMarkdownFileWithIdentity,
  removeAnchoredRepoMarkdownFile,
  unsafeRepoMutationPath,
  writeAnchoredRepoMarkdownFile,
} from "./repo-mutation-path-safety.js";

type StageControl = {
  stage: () => void;
  shouldDeferStaging: (error: Error) => boolean;
};

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
  } & StageControl,
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

  try {
    args.stage();
  } catch (stageError) {
    if (stageError instanceof Error && args.shouldDeferStaging(stageError)) {
      return;
    }
    const rollbackErrors: Error[] = [
      stageError instanceof Error ? stageError : new Error(String(stageError)),
    ];
    try {
      writeAnchoredRepoMarkdownFile({
        projectDir: args.projectDir,
        rootDir: args.sourceRootDir,
        filePath: args.sourcePath,
        content: args.sourceContent,
        expectation: "missing",
      });
    } catch (restoreError) {
      rollbackErrors.push(
        restoreError instanceof Error
          ? restoreError
          : new Error(String(restoreError)),
      );
    }
    try {
      rollbackInstalledDestination({
        projectDir: args.projectDir,
        rootDir: args.destinationRootDir,
        filePath: args.destinationPath,
        expectedSnapshot: destinationSnapshot,
      });
    } catch (rollbackError) {
      rollbackErrors.push(
        rollbackError instanceof Error
          ? rollbackError
          : new Error(String(rollbackError)),
      );
    }
    if (rollbackErrors.length > 1) {
      throw new AggregateError(
        rollbackErrors,
        "Task staging failed and the move could not be safely rolled back",
      );
    }
    throw stageError;
  }
}

export function removeVerifiedRepoMarkdownFile(
  args: {
    projectDir: string;
    rootDir: string;
    filePath: string;
  } & StageControl,
): void {
  const source = readVerifiedRepoMarkdownFileWithIdentity(args);
  if (source === null) {
    throw new Error(`Repo mutation source does not exist: ${args.filePath}`);
  }
  removeAnchoredRepoMarkdownFile({
    ...args,
    expectedSnapshot: source.snapshot,
  });
  try {
    args.stage();
  } catch (stageError) {
    if (stageError instanceof Error && args.shouldDeferStaging(stageError)) {
      return;
    }
    try {
      writeAnchoredRepoMarkdownFile({
        projectDir: args.projectDir,
        rootDir: args.rootDir,
        filePath: args.filePath,
        content: source.content,
        expectation: "missing",
      });
    } catch (restoreError) {
      throw new AggregateError(
        [stageError, restoreError],
        "Repo mutation staging failed and the removed file could not be safely restored",
      );
    }
    throw stageError;
  }
}
