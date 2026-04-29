/**
 * Web access module — HTTP fetch, web search, and raw HTTP request tools.
 *
 * Tools:
 *   web_fetch    — fetch a URL and return content as clean Markdown
 *   web_search   — search the web via DuckDuckGo or Brave Search
 *   http_request — make arbitrary HTTP requests with full method/header/body control
 *
 * All three tools are in the "web" group for progressive disclosure.
 * web_search is safe (read-only); web_fetch and http_request are moderate
 * (may POST or save files). http_request risk also depends on HTTP method
 * and is further classified by the guardrails layer at call time.
 */


import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import { legacyEffect } from "#core/tools/effect.js";
import { httpRequestTool, runHttpRequest } from "./http-request.js";
import { runWebFetch, webFetchTool } from "./web-fetch.js";
import { runWebSearch, webSearchTool } from "./web-search.js";

const tools: ToolDef[] = [
  {
    tool: webFetchTool,
    runner: runWebFetch,
    effect: legacyEffect({ risk: "moderate", kind: "discovery", openWorld: true }),
    group: "web",
  },
  {
    tool: webSearchTool,
    runner: runWebSearch,
    effect: legacyEffect({ risk: "safe", kind: "discovery", openWorld: true }),
    group: "web",
  },
  {
    tool: httpRequestTool,
    runner: runHttpRequest,
    effect: legacyEffect({ risk: "moderate", kind: "action", openWorld: true }),
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
