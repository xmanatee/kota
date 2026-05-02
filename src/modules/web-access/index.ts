/**
 * Web access module — HTTP fetch, web search, and raw HTTP request tools.
 *
 * Tools:
 *   web_fetch    — fetch a URL and return content as clean Markdown
 *   web_search   — search the web via DuckDuckGo or Brave Search
 *   http_request — make arbitrary HTTP requests with full method/header/body control
 *
 * All three tools are in the "web" group for progressive disclosure.
 * web_search and web_fetch are open-world reads (moderate risk via
 * exfiltration); http_request is an open-world write (moderate). The
 * guardrails layer further classifies http_request at call time based on
 * HTTP method.
 */


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { networkReadEffect, networkWriteEffect } from "#core/tools/effect.js";
import { httpRequestTool, runHttpRequest } from "./http-request.js";
import { runWebFetch, webFetchTool } from "./web-fetch.js";
import { runWebSearch, webSearchTool } from "./web-search.js";

const tools: ToolDef[] = [
  {
    tool: webFetchTool,
    runner: runWebFetch,
    effect: networkReadEffect(),
    group: "web",
  },
  {
    tool: webSearchTool,
    runner: runWebSearch,
    effect: networkReadEffect(),
    group: "web",
  },
  {
    tool: httpRequestTool,
    runner: runHttpRequest,
    effect: networkWriteEffect(),
    group: "web",
  },
];

const webAccessModule: KotaModule = {
  name: "web-access",
  version: "1.0.0",
  description: "Web access tools: web_fetch, web_search, and http_request",
  tools,
};

export default webAccessModule;
