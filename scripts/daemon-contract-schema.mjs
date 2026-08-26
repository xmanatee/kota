import { resolve } from "node:path";
import { createGenerator } from "ts-json-schema-generator";
import {
  DAEMON_WIRE_ROOT_TYPE,
  DAEMON_WIRE_SOURCE,
} from "./daemon-contract-graph.mjs";
export function buildDaemonContractSchema(root) {
  return createGenerator({
    path: resolve(root, DAEMON_WIRE_SOURCE),
    type: DAEMON_WIRE_ROOT_TYPE,
    tsconfig: resolve(root, "tsconfig.json"),
    skipTypeCheck: true,
  }).createSchema(DAEMON_WIRE_ROOT_TYPE);
}
