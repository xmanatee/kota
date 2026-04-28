const { format } = require("./format.js");

function warning(message) {
  return format("warn", message);
}

module.exports = { warning };
