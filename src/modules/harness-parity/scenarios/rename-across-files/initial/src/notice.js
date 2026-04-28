const { format } = require("./format.js");

function notice(message) {
  return format("notice", message);
}

module.exports = { notice };
