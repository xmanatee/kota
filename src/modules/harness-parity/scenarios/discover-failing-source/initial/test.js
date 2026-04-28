const assert = require("node:assert/strict");
const { slugify } = require("./src/slugify.js");

assert.equal(
  slugify("Hello World"),
  "hello-world",
  'slugify must lowercase words and join them with hyphens',
);
assert.equal(
  slugify("  Foo Bar  "),
  "foo-bar",
  'slugify must trim leading and trailing whitespace',
);
assert.equal(
  slugify("FOO BAR BAZ"),
  "foo-bar-baz",
  'slugify must lowercase already-uppercase input',
);
assert.equal(
  slugify("a b c"),
  "a-b-c",
  'slugify must handle single-letter tokens',
);

console.log("ok");
