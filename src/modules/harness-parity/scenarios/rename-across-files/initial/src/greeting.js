const { format } = require("./format.js");

function greeting(name) {
  return format("greet", `hello ${name}`);
}

module.exports = { greeting };
