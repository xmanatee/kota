import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

type NativeCliPackageManagerRuntime = {
  env: NodeJS.ProcessEnv;
  readOnlyHostRoots: string[];
};

function projectPackageManager(cwd: string): string | undefined {
  let directory = resolve(cwd);
  while (true) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        packageManager?: string | number | boolean | object | null;
      };
      if (typeof manifest.packageManager === "string") {
        return manifest.packageManager;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function pnpmVersion(packageManager: string | undefined): string | undefined {
  return packageManager?.match(
    /^pnpm@([0-9A-Za-z][0-9A-Za-z.-]*)(?:\+.*)?$/,
  )?.[1];
}

function corepackHome(env: NodeJS.ProcessEnv): string {
  const explicit = env.COREPACK_HOME?.trim();
  if (explicit) return explicit;
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(cacheHome, "node", "corepack");
}

function writeUnavailableShim(path: string, version: string): void {
  const message =
    `pnpm ${version} is not prepared in the host Corepack cache; run ` +
    `corepack prepare pnpm@${version} before starting KOTA.`;
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(message)} >&2\nexit 127\n`,
    { mode: 0o700 },
  );
}

export function prepareNativeCliPackageManagerRuntime(
  cwd: string,
  invocationRoot: string,
  env: NodeJS.ProcessEnv,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NativeCliPackageManagerRuntime {
  const version = pnpmVersion(projectPackageManager(cwd));
  if (version === undefined) return { env, readOnlyHostRoots: [] };

  const binDirectory = join(invocationRoot, "package-manager-bin");
  mkdirSync(binDirectory, { recursive: true, mode: 0o700 });
  const packageRoot = join(corepackHome(hostEnv), "v1", "pnpm", version);
  const executable = join(packageRoot, "bin", "pnpm.cjs");
  const shim = join(binDirectory, "pnpm");
  const prepared = existsSync(executable);
  if (prepared) symlinkSync(executable, shim);
  else writeUnavailableShim(shim, version);

  return {
    env: {
      ...env,
      PATH: [binDirectory, env.PATH].filter(Boolean).join(delimiter),
    },
    readOnlyHostRoots: prepared ? [packageRoot] : [],
  };
}
