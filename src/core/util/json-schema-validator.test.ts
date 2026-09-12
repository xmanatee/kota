import { expect, it } from "vitest";
import { validateJsonSchemaValue } from "./json-schema-validator.js";

it("accepts JSON integers without coercion while preserving number and union types", () => {
  const schema = { type: "object", properties: {
    repeatCount: { type: "integer" },
    cost: { type: "number" },
    optionalCount: { type: ["integer", "null"] },
    samples: { type: "array", items: { type: "integer" } },
  } };
  expect(validateJsonSchemaValue(schema, {
    repeatCount: 1, cost: 0.5, optionalCount: null, samples: [0, -1, 2],
  }, "input")).toBeNull();
  expect(validateJsonSchemaValue(schema, {
    repeatCount: 0, cost: 1, optionalCount: 2,
  }, "input")).toBeNull();
  for (const repeatCount of [1.5, "1", null, true, Number.NaN, Infinity]) {
    expect(validateJsonSchemaValue(schema, { repeatCount }, "input"))
      .toContain("input.repeatCount: expected integer");
  }
  expect(validateJsonSchemaValue(schema, { optionalCount: 0.5 }, "input"))
    .toContain("input.optionalCount: expected integer | null");
  expect(validateJsonSchemaValue(schema, { samples: [1, 0.5] }, "input"))
    .toContain("input.samples[1]: expected integer");
});
