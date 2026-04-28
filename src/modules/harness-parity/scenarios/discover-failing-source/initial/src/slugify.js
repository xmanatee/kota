const { tokenize } = require("./tokenize.js");
const { normalize } = require("./normalize.js");
const { assemble } = require("./assemble.js");

function slugify(input) {
  const tokens = tokenize(input);
  const normalized = tokens.map(normalize);
  return assemble(normalized);
}

module.exports = { slugify };
