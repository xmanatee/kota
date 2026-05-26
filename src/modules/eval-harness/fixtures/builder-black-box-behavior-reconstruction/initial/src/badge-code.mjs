#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log("badge-code candidate");
  process.exit(0);
}

console.log("not-implemented");
