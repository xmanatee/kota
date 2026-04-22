const assert = require("node:assert/strict");
const { add } = require("./src/add.js");

assert.equal(add(2, 3), 5, "add(2, 3) must equal 5");
assert.equal(add(-1, 1), 0, "add(-1, 1) must equal 0");
assert.equal(add(0, 0), 0, "add(0, 0) must equal 0");

console.log("ok");
