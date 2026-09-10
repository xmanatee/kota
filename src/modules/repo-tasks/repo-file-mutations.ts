import type {
  FileAccess,
  VerifiedDirectoryEntry,
  VerifiedFile,
} from "#core/util/filesystem/anchored-file-protocol.js";
import {
  listAnchoredTextFiles,
  readAnchoredTextFile,
  writeAnchoredTextFile,
} from "#core/util/filesystem/anchored-files.js";
import {
  moveAnchoredTextFile,
  removeVerifiedTextFile,
} from "#core/util/filesystem/file-mutations.js";

type RepoMarkdownPath = {
  repoRoot: string;
  rootDir: string;
  filePath: string;
};

function markdownFileAccess(args: RepoMarkdownPath): FileAccess {
  if (!args.filePath.endsWith(".md")) {
    throw new Error(`Repo mutation path must name a markdown file: ${args.filePath}`);
  }
  return { rootPath: args.repoRoot, boundaryDir: args.rootDir, filePath: args.filePath };
}

export function readVerifiedRepoMarkdownFileWithIdentity(args: RepoMarkdownPath): VerifiedFile | null {
  return readAnchoredTextFile(markdownFileAccess(args));
}

export function readVerifiedRepoMarkdownFile(args: RepoMarkdownPath): string | null {
  return readVerifiedRepoMarkdownFileWithIdentity(args)?.content ?? null;
}

export function listVerifiedRepoMarkdownFiles(args: {
  repoRoot: string;
  rootDir: string;
  directoryPath: string;
}): VerifiedDirectoryEntry[] {
  return listAnchoredTextFiles({
    rootPath: args.repoRoot,
    boundaryDir: args.rootDir,
    directoryPath: args.directoryPath,
    nameSuffix: ".md",
  });
}

export function writeRepoMarkdownFile(args: RepoMarkdownPath & { content: string }): void {
  writeAnchoredTextFile({ ...markdownFileAccess(args), content: args.content, expectation: "any" });
}

export function moveRepoMarkdownFile(args: {
  repoRoot: string;
  sourceRootDir: string;
  sourcePath: string;
  destinationRootDir: string;
  destinationPath: string;
  sourceContent: string;
  destinationContent: string;
}): void {
  const source = markdownFileAccess({
    repoRoot: args.repoRoot,
    rootDir: args.sourceRootDir,
    filePath: args.sourcePath,
  });
  const destination = markdownFileAccess({
    repoRoot: args.repoRoot,
    rootDir: args.destinationRootDir,
    filePath: args.destinationPath,
  });
  moveAnchoredTextFile({
    rootPath: args.repoRoot,
    sourceBoundaryDir: source.boundaryDir,
    sourcePath: source.filePath,
    destinationBoundaryDir: destination.boundaryDir,
    destinationPath: destination.filePath,
    sourceContent: args.sourceContent,
    destinationContent: args.destinationContent,
  });
}

export function removeRepoMarkdownFile(args: RepoMarkdownPath): void {
  removeVerifiedTextFile(markdownFileAccess(args));
}
