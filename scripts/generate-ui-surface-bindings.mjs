import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildUiSurfaceSchema,
  UI_SURFACE_ROOT_TYPE,
  UI_SURFACE_SOURCE,
} from "./ui-surface-schema.mjs";
import { generateSwiftBinding } from "./ui-surface-swift.mjs";
import { generateTypeScriptBinding } from "./ui-surface-typescript.mjs";

const DEFAULT_ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "clients/conformance/ui-surface-bindings.manifest.json";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function parseArguments(argv) {
  let root = DEFAULT_ROOT;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
      continue;
    }
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--root requires a path");
      root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { root, check };
}

function expectedArtifacts(root) {
  const schema = buildUiSurfaceSchema(root);
  const typeScript = generateTypeScriptBinding(root, schema);
  const swift = generateSwiftBinding(schema);
  const artifacts = new Map([
    ["schema/ui-surface.schema.json", `${JSON.stringify(schema, null, 2)}\n`],
    ["clients/conformance/ui-surface.generated.ts", typeScript],
    ["clients/mobile/src/daemon/conformance/ui-surface.generated.ts", typeScript],
    ["clients/apple/Sources/KotaShared/Generated/UiSurface.generated.swift", swift],
  ]);
  const source = readFileSync(resolve(root, UI_SURFACE_SOURCE), "utf8");
  const manifest = {
    version: 1,
    protocol: "ui.surface.v1",
    canonicalInput: {
      path: UI_SURFACE_SOURCE,
      rootType: UI_SURFACE_ROOT_TYPE,
      sha256: sha256(source),
    },
    outputs: [...artifacts.entries()].map(([path, content]) => ({
      path,
      sha256: sha256(content),
    })),
  };
  artifacts.set(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return artifacts;
}

function checkArtifacts(root, artifacts) {
  const stale = [];
  for (const [path, content] of artifacts) {
    const absolutePath = resolve(root, path);
    if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) {
      stale.push(path);
    }
  }
  if (stale.length > 0) {
    throw new Error(`Generated UI surface bindings are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun pnpm build:ui-bindings.`);
  }
}

function writeArtifacts(root, artifacts) {
  for (const [path, content] of artifacts) {
    const absolutePath = resolve(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) {
      writeFileSync(absolutePath, content);
    }
  }
}

const { root, check } = parseArguments(process.argv.slice(2));
const artifacts = expectedArtifacts(root);
if (check) checkArtifacts(root, artifacts);
else writeArtifacts(root, artifacts);
