import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { join, parse, sep } from "node:path";

const SECRET_DIR_MODE = 0o700;

export type FileIdentity = {
  dev: number;
  ino: number;
};

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function storageError(path: string, reason: string): Error {
  return new Error(`Refusing to access secret file: ${path} ${reason}`);
}

function lstatOptional(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function directoryComponents(path: string): string[] {
  const root = parse(path).root;
  const components = path.slice(root.length).split(sep).filter(Boolean);
  const paths: string[] = [];
  let current = root;
  for (const component of components) {
    current = join(current, component);
    paths.push(current);
  }
  return paths;
}

function inspectDirectoryPath(path: string, create: boolean): boolean {
  for (const componentPath of directoryComponents(path)) {
    let stats = lstatOptional(componentPath);
    if (stats === undefined) {
      if (!create) return false;
      mkdirSync(componentPath, { mode: SECRET_DIR_MODE });
      stats = lstatSync(componentPath);
    }
    if (stats.isSymbolicLink()) {
      throw storageError(componentPath, "must not be a symbolic link");
    }
    if (!stats.isDirectory()) {
      throw storageError(componentPath, "must be a directory");
    }
  }
  if (realpathSync.native(path) !== path) {
    throw storageError(path, "must resolve to the intended secret directory");
  }
  return true;
}

export function prepareSecretStorageDirectory(
  path: string,
  create: boolean,
): FileIdentity | undefined {
  if (!inspectDirectoryPath(path, create)) return undefined;
  const pathStats = lstatSync(path);
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isDirectory() ||
      !sameFile(identity(pathStats), identity(openedStats)) ||
      !inspectDirectoryPath(path, false)
    ) {
      throw storageError(path, "changed while it was opened");
    }
    fchmodSync(fd, SECRET_DIR_MODE);
    return identity(openedStats);
  } finally {
    closeSync(fd);
  }
}
