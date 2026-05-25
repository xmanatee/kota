import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";

export const MCP_UI_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
export const KOTA_STATUS_UI_RESOURCE_URI = "ui://kota/status.html";

export function buildMcpUiServerCapability(): KotaJsonObject {
	return {
		mimeTypes: [MCP_UI_RESOURCE_MIME_TYPE],
	};
}

export function buildKotaStatusUiResource(): {
	uri: string;
	name: string;
	description: string;
	mimeType: string;
	_meta: KotaJsonObject;
} {
	return {
		uri: KOTA_STATUS_UI_RESOURCE_URI,
		name: "KOTA Status App",
		description: "Sandboxed MCP App view for KOTA status-oriented interactions.",
		mimeType: MCP_UI_RESOURCE_MIME_TYPE,
		_meta: buildMcpUiResourceMeta(),
	};
}

export function buildMcpUiToolMeta(toolName: string): KotaJsonObject | null {
	if (toolName !== "agent_status") return null;
	return {
		ui: {
			resourceUri: KOTA_STATUS_UI_RESOURCE_URI,
		},
	};
}

export function buildMcpUiResourceMeta(): KotaJsonObject {
	return {
		ui: {
			csp: {
				baseUriDomains: [],
				connectDomains: [],
				frameDomains: [],
				resourceDomains: [],
			},
			permissions: {},
			prefersBorder: true,
		},
	};
}

export function isMcpUiResourceUri(uri: string): boolean {
	return uri === KOTA_STATUS_UI_RESOURCE_URI;
}

export function readKotaStatusUiResource(): {
	text: string;
	mimeType: string;
	_meta: KotaJsonObject;
} {
	return {
		text: KOTA_STATUS_UI_HTML,
		mimeType: MCP_UI_RESOURCE_MIME_TYPE,
		_meta: buildMcpUiResourceMeta(),
	};
}

const KOTA_STATUS_UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KOTA Status</title>
<style>
:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; background: Canvas; color: CanvasText; }
main { display: grid; gap: 16px; padding: 18px; max-width: 760px; }
header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding-bottom: 12px; }
h1 { margin: 0; font-size: 24px; line-height: 1.15; }
p { margin: 0; line-height: 1.5; }
.tag { font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: color-mix(in srgb, CanvasText 64%, transparent); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.panel { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 12px; background: color-mix(in srgb, Canvas 94%, CanvasText 6%); }
.panel strong { display: block; margin-bottom: 6px; }
</style>
</head>
<body>
<main>
<header>
<h1>KOTA</h1>
<span class="tag">MCP App</span>
</header>
<section class="grid" aria-label="KOTA MCP status">
<article class="panel">
<strong>Agent Status</strong>
<p>Pairs with the agent_status tool while preserving the normal text result for non-app hosts.</p>
</article>
<article class="panel">
<strong>Protocol</strong>
<p>Served as a static ui:// resource with no network, frame, device, or clipboard permissions.</p>
</article>
<article class="panel">
<strong>Fallback</strong>
<p>Hosts without MCP Apps support can continue using KOTA's JSON resources and text tools.</p>
</article>
</section>
</main>
</body>
</html>`;
