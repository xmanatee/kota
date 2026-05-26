import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "initial", "oracle", "reference.wasm.base64");

function uleb(value) {
  const out = [];
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    out.push(byte);
  } while (remaining !== 0);
  return out;
}

function sleb(value) {
  const out = [];
  let remaining = value | 0;
  let more = true;
  while (more) {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    const signBitSet = (byte & 0x40) !== 0;
    more = !(
      (remaining === 0 && !signBitSet) ||
      (remaining === -1 && signBitSet)
    );
    if (more) byte |= 0x80;
    out.push(byte);
  }
  return out;
}

function bytes(text) {
  return [...Buffer.from(text, "utf8")];
}

function vec(items) {
  return [...uleb(items.length), ...items.flat()];
}

function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}

function funcType(params, results) {
  return [0x60, ...vec(params), ...vec(results)];
}

function localGet(index) {
  return [0x20, ...uleb(index)];
}

function i32Const(value) {
  return [0x41, ...sleb(value)];
}

function body(instructions) {
  const payload = [0x00, ...instructions, 0x0b];
  return [...uleb(payload.length), ...payload];
}

function exportFunc(name, index) {
  return [...uleb(Buffer.byteLength(name)), ...bytes(name), 0x00, ...uleb(index)];
}

const i32 = 0x7f;
const typeSection = section(1, vec([
  funcType([i32, i32, i32], [i32]),
  funcType([i32, i32], [i32]),
]));
const functionSection = section(3, vec([
  uleb(0),
  uleb(1),
]));
const exportSection = section(7, vec([
  exportFunc("mix", 0),
  exportFunc("finish", 1),
]));

const i32Add = 0x6a;
const i32Mul = 0x6c;
const i32RemU = 0x70;

const mixBody = body([
  ...localGet(0),
  ...i32Const(31),
  i32Mul,
  ...localGet(1),
  ...localGet(2),
  ...i32Const(7),
  i32Add,
  i32Mul,
  i32Add,
  ...localGet(1),
  ...i32Const(13),
  i32RemU,
  ...i32Const(17),
  i32Mul,
  i32Add,
  ...localGet(2),
  ...i32Const(19),
  i32Mul,
  i32Add,
  ...i32Const(997),
  i32RemU,
]);

const finishBody = body([
  ...localGet(0),
  ...localGet(1),
  ...i32Const(53),
  i32Mul,
  i32Add,
  ...i32Const(997),
  i32RemU,
]);

const codeSection = section(10, vec([mixBody, finishBody]));
const moduleBytes = [
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
  ...typeSection,
  ...functionSection,
  ...exportSection,
  ...codeSection,
];

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${Buffer.from(moduleBytes).toString("base64")}\n`);
console.log(`wrote ${outPath}`);
