/**
 * ModuleStorage — scoped file-based storage for modules.
 *
 * Each module gets its own isolated directory under `.kota/modules/<name>/`.
 * Supports JSON objects, raw text, and markdown files.
 * This enables truly self-contained modules that own their data.
 */

import { join, resolve } from "node:path";
import { listAnchoredDirectory, readAnchoredTextFile, removeAnchoredTextFile, writeAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { moduleDirectory, moduleFile } from "./module-files.js";

export class ModuleStorageJsonError extends Error {
	constructor(readonly path: string, message: string) {
		super(`Cannot decode module storage ${path}: ${message}`);
		this.name = "ModuleStorageJsonError";
	}
}

export class ModuleStorage {
  private readonly dir: string;
  private readonly baseDir: string;
  constructor(baseDir: string, private readonly moduleName: string) {
    this.baseDir = resolve(baseDir);
    this.dir = moduleDirectory(this.baseDir, moduleName);
  }

  /** Informational path, not an I/O capability. Binary stores own their boundary. */
  getDir(): string { return this.dir; }

  getJSON(key: string): unknown | undefined {
    const filename = this.keyFilename(key, ".json");
    const content = this.readFile(filename);
    if (content === undefined) return undefined;
    try { return JSON.parse(content) as unknown; }
    catch (error) {
      throw new ModuleStorageJsonError(join(this.dir, filename), error instanceof Error ? error.message : String(error));
    }
  }

  setJSON(key: string, value: unknown): void {
    const filename = this.keyFilename(key, ".json");
    const content = JSON.stringify(value, null, 2);
    if (content === undefined) throw new Error("Module storage value is not JSON serializable");
    this.writeFile(filename, `${content}\n`);
  }

  getText(key: string): string | undefined { return this.readFile(this.keyFilename(key, ".txt")); }
  setText(key: string, value: string): void { this.writeFile(this.keyFilename(key, ".txt"), value); }
  readFile(filename: string): string | undefined {
    return readAnchoredTextFile(moduleFile(this.baseDir, this.moduleName, filename))?.content;
  }
  writeFile(filename: string, content: string): void {
    writeAnchoredTextFile({ ...moduleFile(this.baseDir, this.moduleName, filename), content, expectation: "any" });
  }
  has(key: string): boolean {
    return this.hasFile(this.keyFilename(key, ".json")) || this.hasFile(this.keyFilename(key, ".txt"));
  }
  hasFile(filename: string): boolean { return this.readFile(filename) !== undefined; }
  delete(key: string): boolean {
    const json = this.deleteFile(this.keyFilename(key, ".json"));
    const text = this.deleteFile(this.keyFilename(key, ".txt"));
    return json || text;
  }
  deleteFile(filename: string): boolean {
    const access = moduleFile(this.baseDir, this.moduleName, filename);
    const file = readAnchoredTextFile(access);
    if (file === null) return false;
    removeAnchoredTextFile({ ...access, expectedSnapshot: file.snapshot });
    return true;
  }
  list(): string[] {
    return listAnchoredDirectory({ rootPath: this.baseDir, boundaryDir: this.dir, directoryPath: this.dir }).map(entry => entry.name);
  }
  listByExtension(ext: string): string[] { return this.list().filter(name => name.endsWith(ext)); }
  clear(): void { for (const file of this.list()) this.deleteFile(file); }

  private keyFilename(key: string, ext: string): string {
    // Preserve every formerly lossless filename. Ambiguous legacy keys must be
    // addressed by their stored filename; guessing their original identity loses data.
    if (typeof key !== "string" || !/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error(`Invalid module storage key: ${key}`);
    return `${key}${ext}`;
  }
}
