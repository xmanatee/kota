const assert = require("node:assert/strict");
const { greet } = require("./src/greet.js");
const { farewell } = require("./src/farewell.js");
const { sanitize } = require("./src/sanitize.js");

assert.equal(greet("  <Alice>!  "), "Hello, Alice!", 'greet must sanitize its input');
assert.equal(farewell("  <Bob>!  "), "Goodbye, Bob!", 'farewell must sanitize its input');
assert.equal(sanitize("  <Carol>!  "), "Carol", 'sanitize must strip whitespace and stray punctuation');
assert.equal(sanitize("   "), "", 'sanitize must collapse all-whitespace input to ""');

console.log("ok");
