/**
 * Minimal base64 helpers that run in React Native without a Buffer
 * polyfill. React Native 0.74+ exposes `atob`/`btoa` on the global, which
 * is all the voice transport needs — audio bytes in, audio bytes out.
 */

function chunk(bytes: Uint8Array, size = 0x8000): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += size) {
    const slice = bytes.subarray(i, i + size);
    binary += String.fromCharCode.apply(
      null,
      Array.from(slice) as unknown as number[],
    );
  }
  return binary;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const globals = globalThis as { btoa?: (raw: string) => string };
  if (typeof globals.btoa !== 'function') {
    throw new Error('btoa is not available in this runtime');
  }
  return globals.btoa(chunk(bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  const globals = globalThis as { atob?: (input: string) => string };
  if (typeof globals.atob !== 'function') {
    throw new Error('atob is not available in this runtime');
  }
  const binary = globals.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
