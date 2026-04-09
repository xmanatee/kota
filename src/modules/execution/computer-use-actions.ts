import { resetLinuxState } from "./computer-use-actions-linux.js";
import { resetMacState } from "./computer-use-actions-mac.js";

export * from "./computer-use-actions-linux.js";
export * from "./computer-use-actions-mac.js";
export { needCoords } from "./computer-use-actions-shared.js";

/** Reset cached tool detection (for tests). */
export function resetComputerUseState(): void {
	resetMacState();
	resetLinuxState();
}
