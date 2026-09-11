import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runFileRead } from "./file-read.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "file-preview-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each([
  ["object.json", '{"name":"Alice","age":30}', "Object with 2 keys", '"Alice"'],
  ["array.json", '[{"id":1},{"id":2}]', "Element schema", "id: number"],
  ["mixed.json", '[1,"hello",null,true]', "Sample elements", "null"],
  ["scalar.json", '"hello"', 'scalar "hello"', '"hello"'],
  ["array-empty.json", "[]", "Array with 0 elements", "[]"],
  ["object-empty.json", "{}", "Object with 0 keys", "{}"],
  ["events.jsonl", '{"id":1}\ninvalid\n{"id":2}', "JSONL: 3 lines", "id: number"],
  ["events.ndjson", '{"id":1}\n{"id":2}\n', "JSONL: 2 lines", "id: number"],
  ["types.csv", "name,date,price\nAlice,2024-01-15,10\nBob,2024-02-01,20", "name, date:date, price:numeric", "price: 10–20"],
  ["quotes.csv", '"Company ""A"", USD",Count\nAcme,2', 'Company "A", USD, Count:numeric', "2 cols"],
  ["data.tsv", "name\tage\nAlice\t30", "1 rows × 2 cols", "age:numeric"],
  ["headers.csv", "x,y,z", "0 rows × 3 cols", "x, y, z"],
])("renders structured preview plus numbered data for %s", async (name, content, header, detail) => {
  const path = join(root, name);
  writeFileSync(path, content);
  const result = await runFileRead({ path });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toContain(header);
  expect(result.content).toContain(detail);
  expect(result.content).toContain(`     1\t${content.split("\n")[0]}`);
  expect(result.content.indexOf(header)).toBeLessThan(result.content.indexOf("     1\t"));
});

it.each(["", '{"broken":true,}'])("keeps invalid JSON readable: %s", async (content) => {
  const path = join(root, "bad.json");
  writeFileSync(path, content);
  const result = await runFileRead({ path });
  expect(result.is_error).toBeUndefined();
  expect(result.content).toBe(`     1\t${content}`);
});

it("bounds object preview while retaining complete raw data", async () => {
  const path = join(root, "large.json");
  writeFileSync(path, JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key${i}`, i]))));
  const result = await runFileRead({ path });
  expect(result.content).toContain("+5 more keys");
  expect(result.content).toContain('"key19":19');
});

it("summarizes the whole CSV before the requested page", async () => {
  const path = join(root, "page.csv");
  writeFileSync(path, "a,b\n1,2\n3,4\n5,6");
  const result = await runFileRead({ path, offset: 3, limit: 1 });
  expect(result.content).toMatch(/^\[CSV: 3 rows × 2 cols/);
  expect(result.content).toContain("     3\t3,4");
  expect(result.content).not.toContain("     2\t1,2");
});
