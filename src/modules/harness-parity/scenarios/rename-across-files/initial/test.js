const assert = require("node:assert/strict");
const { greeting, warning, notice } = require("./src/index.js");

assert.equal(
  greeting("World"),
  "[greet] hello World",
  "greeting() must produce a `[greet] hello <name>` line",
);
assert.equal(
  warning("disk full"),
  "[warn] disk full",
  "warning() must produce a `[warn] <message>` line",
);
assert.equal(
  notice("update available"),
  "[notice] update available",
  "notice() must produce a `[notice] <message>` line",
);

console.log("ok");
