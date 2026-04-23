function greet(raw) {
  const clean = String(raw).trim().replace(/[^a-zA-Z0-9 ]/g, "");
  return `Hello, ${clean}!`;
}

module.exports = { greet };
