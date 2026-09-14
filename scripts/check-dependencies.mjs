import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

// KOTA's pnpm readiness probe. Package-manager knowledge stays with the project.
try {
  const root = realpathSync(process.cwd());
  const modules = realpathSync(join(root, "node_modules"));
  if (modules !== join(root, "node_modules")) throw new Error("node_modules must belong to this checkout");
  const require = createRequire(join(root, "package.json"));
  const { parse } = require(join(modules, "yaml"));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const locked = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  const installed = parse(readFileSync(join(modules, ".pnpm", "lock.yaml"), "utf8"));
  if (!isDeepStrictEqual(locked, installed)) throw new Error("Installed resolution differs from pnpm-lock.yaml");
  const importer = locked.importers["."];
  for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const declared = manifest[kind] ?? {};
    if (Object.keys(declared).length !== Object.keys(importer[kind] ?? {}).length) throw new Error(`Manifest ${kind} differs from the lockfile`);
    for (const [name, specifier] of Object.entries(declared)) {
      const dependency = importer[kind]?.[name];
      if (dependency?.specifier !== specifier) throw new Error(`Unlocked manifest dependency: ${name}`);
      const path = realpathSync(join(modules, name, "package.json"));
      const child = relative(modules, path);
      if (child === ".." || child.startsWith(`..${sep}`)) throw new Error(`Dependency resolves outside this checkout: ${name}`);
      const pkg = JSON.parse(readFileSync(path, "utf8"));
      if (pkg.version !== dependency.version.split("(")[0]) throw new Error(`Installed version differs for ${name}`);
    }
  }
  const Database = require(join(modules, "better-sqlite3"));
  new Database(":memory:").close();
  require(join(modules, "ajv/dist/2020.js"));
  console.log("Locked project dependencies are ready.");
} catch (error) {
  console.error(`Project dependencies are not ready: ${error.message}`);
  process.exitCode = 1;
}
