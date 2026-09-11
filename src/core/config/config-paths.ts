import { homedir } from "node:os";
import { join } from "node:path";

export function getGlobalConfigPath(): string {
	return join(homedir(), ".kota", "config.json");
}
