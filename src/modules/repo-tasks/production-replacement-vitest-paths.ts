import { basename, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

function safeRepoPath(projectDir: string, path: string): string | null {
  const normalized = isAbsolute(path) ? relative(projectDir, path) : path;
  if (
    normalized.length === 0 ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    isAbsolute(normalized)
  ) return null;
  return normalized.split(sep).join("/");
}

export function vitestRepoPath(projectDir: string, rawId: string): string | null {
  let id = stripVTControlCharacters(rawId)
    .trim()
    .replace(/\s+\+\d+(?:\.\d+)?ms$/, "");
  const queryIndex = id.indexOf("?");
  if (queryIndex >= 0) id = id.slice(0, queryIndex);
  if (id.startsWith("/src/") || id.startsWith("/clients/")) return id.slice(1);
  if (id.startsWith("/@fs/")) id = id.slice(4);
  if (id.startsWith("file://")) {
    try {
      id = fileURLToPath(id);
    } catch {
      return null;
    }
  }

  const direct = safeRepoPath(projectDir, id);
  if (direct !== null) return direct;

  const portableId = id.replaceAll("\\", "/");
  const projectMarker = `/${basename(projectDir)}/`;
  const markerIndex = portableId.lastIndexOf(projectMarker);
  return markerIndex < 0
    ? null
    : safeRepoPath(projectDir, portableId.slice(markerIndex + projectMarker.length));
}

export function collectTransformedRepoPaths(
  projectDir: string,
  stderr: string,
): Set<string> {
  const paths = new Set<string>();
  for (const line of stderr.split(/\r?\n/)) {
    const match = /vite:transform\s+\S+\s+(.+)$/.exec(line);
    if (!match) continue;
    const path = vitestRepoPath(projectDir, match[1]);
    if (path !== null) paths.add(path);
  }
  return paths;
}
