import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENTRY_EXTENSIONS = [".ts", ".js", ".mjs"] as const;

function entryCandidates(baseUrl: URL, entryBaseName: string): URL[] {
  return ENTRY_EXTENSIONS.map(
    (extension) => new URL(`${entryBaseName}${extension}`, baseUrl),
  );
}

export function listModuleDirectories(baseUrl: URL): string[] {
  return readdirSync(fileURLToPath(baseUrl), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveModuleEntryUrl(
  baseUrl: URL,
  entryBaseName: string,
): URL | null {
  for (const candidate of entryCandidates(baseUrl, entryBaseName)) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export async function importModuleEntry<T>(
  baseUrl: URL,
  entryBaseName: string,
): Promise<T | null> {
  const entryUrl = resolveModuleEntryUrl(baseUrl, entryBaseName);
  if (!entryUrl) return null;
  const imported = await import(pathToFileURL(fileURLToPath(entryUrl)).href);
  return (imported.default ?? imported) as T;
}
