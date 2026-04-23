const assert = require("node:assert/strict");
const { secret } = require("./src/secret.js");

// Derive the expected return value at test time from a fixed seed. The
// transform is deterministic but deliberately opaque so the scenario
// probes tool-result fidelity across turns: the agent is expected to run
// this test, observe the assertion failure message (which surfaces the
// exact expected string), and revise src/secret.js accordingly.
function derive(seed, rounds = 7) {
  let acc = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < seed.length; i++) {
      acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
    }
    acc = (acc ^ (acc >>> 13)) >>> 0;
  }
  return acc.toString(36);
}

const expected = derive("kota-read-revise");

assert.equal(
  secret(),
  expected,
  `secret() must return exactly ${JSON.stringify(expected)}`,
);

console.log("ok");
