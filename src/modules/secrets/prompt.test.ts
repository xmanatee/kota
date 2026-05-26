import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { promptSecretValue } from "./index.js";

class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  readonly rawModeCalls: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawModeCalls.push(mode);
    return this;
  }
}

class FakePipeInput extends PassThrough {
  isTTY = false;
}

class CapturingOutput extends Writable {
  readonly chunks: string[] = [];

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

describe("promptSecretValue", () => {
  it("uses raw TTY input without echoing the typed secret", async () => {
    const input = new FakeTtyInput();
    const output = new CapturingOutput();

    const result = promptSecretValue("API_TOKEN", { input, output });
    input.write("super-secret");
    input.write("\r");

    await expect(result).resolves.toBe("super-secret");
    expect(input.rawModeCalls).toEqual([true, false]);
    expect(output.text()).toBe('Enter value for "API_TOKEN": \n');
    expect(output.text()).not.toContain("super-secret");
  });

  it("keeps non-TTY stdin compatible for piped input", async () => {
    const input = new FakePipeInput();
    const output = new CapturingOutput();

    const result = promptSecretValue("API_TOKEN", { input, output });
    input.end("piped-secret\n");

    await expect(result).resolves.toBe("piped-secret");
    expect(output.text()).toBe('Enter value for "API_TOKEN": ');
  });
});
