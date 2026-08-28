// Formatting helpers — must not be modified by the agent.
function formatResult(label, value) {
  return `${label}: ${value}`;
}

function formatError(label, err) {
  return `${label} error: ${err.message}`;
}

module.exports = { formatResult, formatError };
