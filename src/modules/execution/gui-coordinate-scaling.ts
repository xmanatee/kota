export type GuiDimensions = {
	width: number;
	height: number;
};

export type ScreenshotResizeLimits = {
	maxLongEdge: number;
	maxPixels: number;
};

export type ScreenshotCoordinateMap = {
	native: GuiDimensions;
	display: GuiDimensions;
	scaleX: number;
	scaleY: number;
	coordinateSpace: "last_screenshot_display";
};

export type CoordinateSpace = "native" | "last_screenshot_display";

const PNG_SIGNATURE = "89504e470d0a1a0a";
let lastActionableScreenshot: ScreenshotCoordinateMap | null = null;

export function readPngDimensions(buffer: Buffer): GuiDimensions {
	if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
		throw new Error("screenshot output is not a valid PNG");
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	return validateDimensions({ width, height }, "PNG dimensions");
}

export function calculateDisplayDimensions(
	native: GuiDimensions,
	limits: ScreenshotResizeLimits,
): GuiDimensions {
	const checkedNative = validateDimensions(native, "native dimensions");
	if (!Number.isFinite(limits.maxLongEdge) || limits.maxLongEdge <= 0) {
		throw new Error("maxLongEdge must be a positive number");
	}
	if (!Number.isFinite(limits.maxPixels) || limits.maxPixels <= 0) {
		throw new Error("maxPixels must be a positive number");
	}

	const longEdgeScale = Math.min(
		1,
		limits.maxLongEdge / Math.max(checkedNative.width, checkedNative.height),
	);
	const pixelScale = Math.min(
		1,
		Math.sqrt(limits.maxPixels / (checkedNative.width * checkedNative.height)),
	);
	const scale = Math.min(longEdgeScale, pixelScale);
	return {
		width: Math.max(1, Math.floor(checkedNative.width * scale)),
		height: Math.max(1, Math.floor(checkedNative.height * scale)),
	};
}

export function createScreenshotCoordinateMap(
	native: GuiDimensions,
	display: GuiDimensions,
): ScreenshotCoordinateMap {
	const checkedNative = validateDimensions(native, "native dimensions");
	const checkedDisplay = validateDimensions(display, "display dimensions");
	if (checkedDisplay.width > checkedNative.width || checkedDisplay.height > checkedNative.height) {
		throw new Error("display dimensions must not exceed native dimensions");
	}
	return {
		native: checkedNative,
		display: checkedDisplay,
		scaleX: checkedNative.width / checkedDisplay.width,
		scaleY: checkedNative.height / checkedDisplay.height,
		coordinateSpace: "last_screenshot_display",
	};
}

export function rememberLastActionableScreenshot(map: ScreenshotCoordinateMap): void {
	lastActionableScreenshot = createScreenshotCoordinateMap(map.native, map.display);
}

export function clearLastActionableScreenshot(): void {
	lastActionableScreenshot = null;
}

export function resolveGuiCoordinates(
	x: number,
	y: number,
	space: CoordinateSpace,
): [number, number] {
	assertCoordinate(x, "x");
	assertCoordinate(y, "y");
	if (space === "native") return [Math.round(x), Math.round(y)];
	if (space !== "last_screenshot_display") {
		throw new Error(
			'coordinate_space must be either "native" or "last_screenshot_display"',
		);
	}
	const map = lastActionableScreenshot;
	if (!map) {
		throw new Error(
			'coordinate_space "last_screenshot_display" requires a prior actionable screenshot tool result',
		);
	}
	if (x < 0 || x >= map.display.width || y < 0 || y >= map.display.height) {
		throw new Error(
			`display coordinates (${x}, ${y}) are outside the last screenshot display size ${map.display.width}x${map.display.height}`,
		);
	}
	return [Math.round(x * map.scaleX), Math.round(y * map.scaleY)];
}

export function parseCoordinateSpace(raw: string | undefined): CoordinateSpace {
	if (raw === "native" || raw === "last_screenshot_display") return raw;
	if (raw === undefined) {
		throw new Error(
			'coordinate_space is required for coordinate actions; use "native" or "last_screenshot_display"',
		);
	}
	throw new Error(
		'coordinate_space must be either "native" or "last_screenshot_display"',
	);
}

function validateDimensions(dimensions: GuiDimensions, label: string): GuiDimensions {
	const { width, height } = dimensions;
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		throw new Error(`${label} must have positive finite width and height`);
	}
	const roundedWidth = Math.round(width);
	const roundedHeight = Math.round(height);
	if (roundedWidth <= 0 || roundedHeight <= 0) {
		throw new Error(`${label} must have positive finite width and height`);
	}
	return {
		width: roundedWidth,
		height: roundedHeight,
	};
}

function assertCoordinate(value: number, label: string): void {
	if (!Number.isFinite(value)) {
		throw new Error(`${label} coordinate must be a finite number`);
	}
}
