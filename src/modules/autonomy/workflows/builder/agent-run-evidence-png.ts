import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_MAX_DECODED_BYTES = 64 * 1024 * 1024;

type PngHeader = {
  bitDepth: number;
  colorType: number;
  height: number;
  width: number;
};

const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  4: 2,
  6: 4,
};

const BIT_DEPTHS_BY_COLOR_TYPE: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  4: [8, 16],
  6: [8, 16],
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function fail(path: string, message: string): never {
  throw new Error(`registered png artifact is malformed: ${path} (${message})`);
}

function pngCrc(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function parseHeader(data: Buffer, path: string): PngHeader {
  if (data.length !== 13) fail(path, "IHDR must be 13 bytes");
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8] ?? 0;
  const colorType = data[9] ?? -1;
  if (width === 0 || height === 0) fail(path, "dimensions must be positive");
  if (!BIT_DEPTHS_BY_COLOR_TYPE[colorType]?.includes(bitDepth)) {
    fail(path, `unsupported color type ${colorType} or bit depth ${bitDepth}`);
  }
  if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
    fail(path, "unsupported compression, filter, or interlace method");
  }
  return { bitDepth, colorType, height, width };
}

function expectedDecodedBytes(header: PngHeader, path: string): {
  rowBytes: number;
  totalBytes: number;
} {
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (channels === undefined) fail(path, "unsupported color type");
  const rowBytes = Math.ceil((header.width * channels * header.bitDepth) / 8);
  const totalBytes = header.height * (rowBytes + 1);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > PNG_MAX_DECODED_BYTES) {
    fail(path, `decoded pixels exceed ${PNG_MAX_DECODED_BYTES} bytes`);
  }
  return { rowBytes, totalBytes };
}

function assertScanlines(
  pixels: Buffer,
  header: PngHeader,
  rowBytes: number,
  path: string,
): void {
  for (let row = 0; row < header.height; row += 1) {
    const filter = pixels[row * (rowBytes + 1)];
    if (filter === undefined || filter > 4) {
      fail(path, `scanline ${row + 1} has an invalid filter`);
    }
  }
}

/**
 * Projects a PNG to render-only data. Ancillary chunks are intentionally
 * discarded and image data is inflated and re-encoded, so compressed metadata
 * or trailing streams from the agent-owned source cannot enter Git history.
 */
export function projectBuilderEvidencePng(content: Buffer, path: string): Buffer {
  if (!content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    fail(path, "invalid signature");
  }

  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  const compressedParts: Buffer[] = [];
  while (offset < content.length) {
    if (content.length - offset < 12) fail(path, "truncated chunk");
    const length = content.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > content.length) {
      fail(path, "chunk exceeds file bounds");
    }
    const typeBytes = content.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type) || (typeBytes[2] ?? 0) >= 0x61) {
      fail(path, "invalid chunk type");
    }
    const data = content.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = content.readUInt32BE(offset + 8 + length);
    if (pngCrc(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      fail(path, `${type} checksum mismatch`);
    }

    if (type === "IHDR") {
      if (header !== undefined || offset !== PNG_SIGNATURE.length) {
        fail(path, "IHDR must be the first and only header");
      }
      header = parseHeader(data, path);
    } else if (type === "IDAT") {
      if (header === undefined || imageDataEnded) fail(path, "invalid IDAT order");
      sawImageData = true;
      compressedParts.push(data);
    } else if (type === "IEND") {
      if (!sawImageData || length !== 0) fail(path, "invalid IEND");
      sawEnd = true;
      offset = end;
      break;
    } else {
      if ((typeBytes[0] ?? 0) < 0x61 && type !== "PLTE") {
        fail(path, `unsupported critical chunk ${type}`);
      }
      if (sawImageData) imageDataEnded = true;
    }
    offset = end;
  }
  if (header === undefined || !sawEnd || offset !== content.length) {
    fail(path, "missing terminal IEND or trailing bytes");
  }

  const { rowBytes, totalBytes } = expectedDecodedBytes(header, path);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(compressedParts), {
      maxOutputLength: totalBytes + 1,
    });
  } catch (error) {
    fail(path, `invalid image data: ${String(error)}`);
  }
  if (pixels.length !== totalBytes) {
    fail(path, `decoded image data must be exactly ${totalBytes} bytes`);
  }
  assertScanlines(pixels, header, rowBytes, path);

  const headerBytes = Buffer.alloc(13);
  headerBytes.writeUInt32BE(header.width, 0);
  headerBytes.writeUInt32BE(header.height, 4);
  headerBytes[8] = header.bitDepth;
  headerBytes[9] = header.colorType;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", headerBytes),
    pngChunk("IDAT", deflateSync(pixels, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
