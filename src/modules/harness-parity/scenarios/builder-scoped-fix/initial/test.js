const assert = require("node:assert/strict");
const { multiply, divide } = require("./src/calc.js");

// multiply tests
assert.equal(multiply(2, 3), 6, "multiply(2, 3) must equal 6");
assert.equal(multiply(0, 5), 0, "multiply(0, 5) must equal 0");
assert.equal(multiply(-2, 4), -8, "multiply(-2, 4) must equal -8");
assert.equal(multiply(7, 1), 7, "multiply(7, 1) must equal 7");

// divide tests
assert.equal(divide(10, 2), 5, "divide(10, 2) must equal 5");
assert.equal(divide(9, 3), 3, "divide(9, 3) must equal 3");
assert.throws(() => divide(1, 0), { message: "Cannot divide by zero" });

console.log("ok");
