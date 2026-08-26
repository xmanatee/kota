import {
  listVerifiedRepoMarkdownFiles,
  readVerifiedRepoMarkdownFile,
  readVerifiedRepoMarkdownFileWithIdentity,
} from "./repo-mutation-path-safety.js";
import {
  moveVerifiedRepoMarkdownFile,
  removeVerifiedRepoMarkdownFile,
  writeVerifiedRepoMarkdownFile,
} from "./repo-physical-file-mutations.js";

export type { FileSnapshot } from "./repo-mutation-path-safety.js";
export {
  listVerifiedRepoMarkdownFiles,
  readVerifiedRepoMarkdownFile,
  readVerifiedRepoMarkdownFileWithIdentity,
};

export function writeRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
  content: string;
}): void {
  writeVerifiedRepoMarkdownFile(args);
}

export function moveRepoMarkdownFile(args: {
  projectDir: string;
  sourceRootDir: string;
  sourcePath: string;
  destinationRootDir: string;
  destinationPath: string;
  sourceContent: string;
  destinationContent: string;
}): void {
  moveVerifiedRepoMarkdownFile(args);
}

export function removeRepoMarkdownFile(args: {
  projectDir: string;
  rootDir: string;
  filePath: string;
}): void {
  removeVerifiedRepoMarkdownFile(args);
}
