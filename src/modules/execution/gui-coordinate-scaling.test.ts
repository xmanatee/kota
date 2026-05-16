import { beforeEach, describe, expect, it } from "vitest";
import {
	calculateDisplayDimensions,
	clearLastActionableScreenshot,
	createScreenshotCoordinateMap,
	parseCoordinateSpace,
	readPngDimensions,
	rememberLastActionableScreenshot,
	resolveGuiCoordinates,
} from "./gui-coordinate-scaling.js";

function pngBuffer(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(32, 0);
	Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "ascii");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

describe("GUI coordinate scaling", () => {
	beforeEach(() => {
		clearLastActionableScreenshot();
	});

	it("passes native coordinates through with rounding", () => {
		expect(resolveGuiCoordinates(10.6, 20.2, "native")).toEqual([11, 20]);
	});

	it("converts display coordinates to native coordinates from the last screenshot", () => {
		rememberLastActionableScreenshot(
			createScreenshotCoordinateMap(
				{ width: 3000, height: 2000 },
				{ width: 1500, height: 1000 },
			),
		);

		expect(resolveGuiCoordinates(750, 250, "last_screenshot_display")).toEqual([
			1500,
			500,
		]);
	});

	it("rounds fractional scale conversion", () => {
		rememberLastActionableScreenshot(
			createScreenshotCoordinateMap(
				{ width: 1000, height: 751 },
				{ width: 333, height: 250 },
			),
		);

		expect(resolveGuiCoordinates(10, 10, "last_screenshot_display")).toEqual([
			30,
			30,
		]);
	});

	it("handles high-DPI style native and display dimensions", () => {
		rememberLastActionableScreenshot(
			createScreenshotCoordinateMap(
				{ width: 3024, height: 1964 },
				{ width: 1512, height: 982 },
			),
		);

		expect(resolveGuiCoordinates(756, 491, "last_screenshot_display")).toEqual([
			1512,
			982,
		]);
	});

	it("rejects malformed dimensions", () => {
		expect(() =>
			createScreenshotCoordinateMap(
				{ width: 0, height: 100 },
				{ width: 100, height: 100 },
			),
		).toThrow("positive finite");
		expect(() =>
			createScreenshotCoordinateMap(
				{ width: 100, height: 100 },
				{ width: 200, height: 100 },
			),
		).toThrow("must not exceed native");
	});

	it("calculates display size using both long-edge and pixel budgets", () => {
		const display = calculateDisplayDimensions(
			{ width: 4000, height: 3000 },
			{ maxLongEdge: 1568, maxPixels: 1_200_000 },
		);

		expect(display).toEqual({ width: 1264, height: 948 });
		expect(Math.max(display.width, display.height)).toBeLessThanOrEqual(1568);
		expect(display.width * display.height).toBeLessThanOrEqual(1_200_000);
	});

	it("does not upscale small screenshots", () => {
		expect(
			calculateDisplayDimensions(
				{ width: 800, height: 600 },
				{ maxLongEdge: 1568, maxPixels: 1_200_000 },
			),
		).toEqual({ width: 800, height: 600 });
	});

	it("reads PNG dimensions from the header", () => {
		expect(readPngDimensions(pngBuffer(1440, 900))).toEqual({
			width: 1440,
			height: 900,
		});
	});

	it("rejects invalid coordinate-space input", () => {
		expect(() => parseCoordinateSpace(undefined)).toThrow("coordinate_space");
		expect(() => parseCoordinateSpace("display")).toThrow("coordinate_space");
	});
});
