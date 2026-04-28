function tokenize(input) {
  return String(input).trim().split(/\s+/);
}

module.exports = { tokenize };
