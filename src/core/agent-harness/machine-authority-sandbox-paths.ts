import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolvePathIdentities } from "#core/util/real-path.js";

export type MachineAuthorityWriteBoundary = {
  root: string;
  writableDescendants: readonly string[];
};

export type MachineAuthorityNetworkAccess =
  | { kind: "offline" }
  | { kind: "loopback-proxy"; port: number };

const MACOS_WRITABLE_DEVICE_PATHS = ["/dev/null"] as const;

export function resolveUniquePathIdentities(
  paths: readonly string[],
  cwd: string,
): string[] {
  return [...new Set(paths.flatMap((path) => resolvePathIdentities(path, cwd)))];
}

function sandboxPathSelectors(paths: readonly string[]): string[] {
  return paths.flatMap((path) => [
    `(literal ${JSON.stringify(path)})`,
    `(subpath ${JSON.stringify(path)})`,
  ]);
}

function macosWriteBoundarySelector(
  boundary: MachineAuthorityWriteBoundary,
): string {
  const rootSelectors = sandboxPathSelectors([boundary.root]);
  const writableSelectors = sandboxPathSelectors(boundary.writableDescendants);
  if (writableSelectors.length === 0) {
    return `(require-any ${rootSelectors.join(" ")})`;
  }
  return `(require-all (require-any ${rootSelectors.join(" ")}) (require-not (require-any ${writableSelectors.join(" ")})))`;
}

export function macosMachineAuthorityProfile(options: {
  configDirectories: readonly string[];
  tokenPaths: readonly string[];
  readableRoots: readonly string[] | undefined;
  writableRoots: readonly string[] | undefined;
  readProtectedPaths: readonly string[];
  readProtectedRoots: readonly string[];
  writeProtectedPaths: readonly string[];
  writeBoundaries: readonly MachineAuthorityWriteBoundary[];
  networkAccess: MachineAuthorityNetworkAccess | undefined;
}): string {
  const protectedDirectories = sandboxPathSelectors([
    ...options.configDirectories,
    ...options.writeProtectedPaths,
  ]);
  const protectedReads = [
    ...[...options.readProtectedPaths, ...options.tokenPaths]
      .map((path) => `(literal ${JSON.stringify(path)})`),
    ...sandboxPathSelectors(options.readProtectedRoots),
  ];
  return [
    "(version 1)",
    "(allow default)",
    ...(options.networkAccess === undefined
      ? []
      : [
          "(deny network*)",
          '(allow network-inbound (local tcp "localhost:*"))',
          ...(options.networkAccess.kind === "loopback-proxy"
            ? [
                `(allow network-outbound (remote tcp ${JSON.stringify(`localhost:${options.networkAccess.port}`)}))`,
              ]
            : []),
        ]),
    ...(options.readableRoots === undefined
      ? []
      : [
          "(deny file-read*)",
          "(allow file-read-metadata)",
          `(allow file-read* (literal "/") ${sandboxPathSelectors(options.readableRoots).join(" ")})`,
        ]),
    ...(options.writableRoots === undefined
      ? []
      : [
          "(deny file-write*)",
          `(allow file-write* ${[
            ...MACOS_WRITABLE_DEVICE_PATHS.map(
              (path) => `(literal ${JSON.stringify(path)})`,
            ),
            ...sandboxPathSelectors(options.writableRoots),
          ].join(" ")})`,
        ]),
    `(deny file-write* ${[...protectedDirectories, ...protectedReads].join(" ")})`,
    ...options.writeBoundaries.map((boundary) =>
      `(deny file-write* ${macosWriteBoundarySelector(boundary)})`
    ),
    `(deny file-read* ${protectedReads.join(" ")})`,
  ].join("\n");
}

export function pathIsWithinRoots(
  path: string,
  roots: readonly string[],
): boolean {
  return roots.some((root) => {
    const candidate = relative(root, path);
    return candidate === "" || (
      candidate !== ".." &&
      !candidate.startsWith(`..${sep}`) &&
      !isAbsolute(candidate)
    );
  });
}

export function resolveWriteBoundaries(
  boundaries: readonly MachineAuthorityWriteBoundary[],
  cwd: string,
): MachineAuthorityWriteBoundary[] {
  return boundaries.flatMap((boundary) => {
    const requestedRoot = resolve(cwd, boundary.root);
    for (const descendant of boundary.writableDescendants) {
      if (!pathIsWithinRoots(resolve(cwd, descendant), [requestedRoot])) {
        throw new Error(
          `machine authority sandbox writable descendant is outside its protected root: ${descendant}`,
        );
      }
    }
    const rootIdentities = resolveUniquePathIdentities([boundary.root], cwd);
    const descendantIdentities = resolveUniquePathIdentities(
      boundary.writableDescendants,
      cwd,
    );
    return rootIdentities.map((root) => ({
      root,
      writableDescendants: descendantIdentities.filter((path) =>
        pathIsWithinRoots(path, [root])
      ),
    }));
  });
}
