import type {
  UiAction,
  UiFormField,
  UiNode,
  UiSurface,
  UiSurfaceBundle,
} from "../../../conformance/ui-surface.generated";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function operationLabel(action: UiAction): string {
  if (action.operation.kind === "daemon-route") {
    return `${action.operation.method} ${action.operation.path}`;
  }
  return `${action.operation.namespace}.${action.operation.method}`;
}

function renderAction(action: UiAction): string {
  const confirmation = action.confirmation.mode === "required"
    ? ` data-confirm="${escapeHtml(action.confirmation.risk)}"`
    : "";
  const disabled = action.readiness.state === "disabled" ? ' disabled aria-disabled="true"' : "";
  return `<button data-action-id="${escapeHtml(action.actionId)}" data-effect="${escapeHtml(action.effect)}" data-readiness="${escapeHtml(action.readiness.state)}"${confirmation}${disabled}>${escapeHtml(action.label)} <span>${escapeHtml(operationLabel(action))}</span></button>`;
}

function renderField(field: UiFormField): string {
  const required = field.required ? " required" : "";
  if (field.input === "select") {
    const options = field.options?.map((option) =>
      `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
    ).join("") ?? "";
    return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.id)}" data-input="select"${required}>${options}</select></label>`;
  }
  if (field.input === "boolean") {
    return `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.id)}" data-input="boolean" type="checkbox"${required}></label>`;
  }
  const inputType = field.input === "secret"
    ? "password"
    : field.input === "number"
      ? "number"
      : field.input === "url"
        ? "url"
        : "text";
  return `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.id)}" data-input="${escapeHtml(field.input)}" type="${inputType}"${required}></label>`;
}

function linkHref(node: Extract<UiNode, { kind: "link" }>): string {
  if (node.target.kind === "surface") return `#${node.target.surfaceId}`;
  if (node.target.kind === "daemon-route") return node.target.path;
  return node.target.url;
}

function renderLogEntries(entries: Extract<UiNode, { kind: "log" }>["entries"]): string {
  return `<ol>${entries.map((entry) =>
    `<li data-level="${escapeHtml(entry.level)}"><time>${escapeHtml(entry.timestamp)}</time> <strong>${escapeHtml(entry.level)}</strong> ${entry.source ? `<span>${escapeHtml(entry.source)}</span> ` : ""}${escapeHtml(entry.message)}</li>`
  ).join("")}</ol>`;
}

function renderNode(node: UiNode): string {
  switch (node.kind) {
    case "navigation":
      return `<nav><h3>${escapeHtml(node.label)}</h3>${node.items.map((item) => `<a data-surface-id="${escapeHtml(item.surfaceId)}">${escapeHtml(item.label)}</a>`).join("")}</nav>`;
    case "status-summary":
      return `<dl>${node.entries.map((entry) => `<div data-role="${escapeHtml(entry.role)}"><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>`).join("")}</dl>`;
    case "metrics":
      return `<section data-node-kind="metrics"><h3>${escapeHtml(node.title)}</h3>${node.metrics.map((metric) => `<p data-role="${escapeHtml(metric.role)}"><strong>${escapeHtml(metric.value)}${metric.unit ? ` ${escapeHtml(metric.unit)}` : ""}</strong> ${escapeHtml(metric.label)}</p>`).join("")}</section>`;
    case "text":
      return `<section data-node-kind="text"><h3>${escapeHtml(node.title)}</h3><p>${escapeHtml(node.body)}</p></section>`;
    case "link":
      return `<a data-node-kind="link" data-target-kind="${escapeHtml(node.target.kind)}" href="${escapeHtml(linkHref(node))}">${escapeHtml(node.label)}</a>`;
    case "tabs":
      return `<section data-node-kind="tabs"><h3>${escapeHtml(node.title)}</h3><div role="tablist">${node.tabs.map((tab) => `<button type="button" role="tab" aria-selected="${tab.id === node.activeTabId ? "true" : "false"}" data-tab-id="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`).join("")}</div>${node.tabs.map((tab) => `<section role="tabpanel" data-tab-id="${escapeHtml(tab.id)}">${tab.nodes.map(renderNode).join("")}</section>`).join("")}</section>`;
    case "list":
      return `<section data-node-kind="list"><h3>${escapeHtml(node.title)}</h3><ul>${node.items.map((item) => `<li data-role="${escapeHtml(item.role)}"><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.detail)}${item.action ? renderAction(item.action) : ""}</li>`).join("")}</ul></section>`;
    case "table":
      return `<section data-node-kind="table"><h3>${escapeHtml(node.title)}</h3><table><thead><tr>${node.columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${node.rows.map((row) => `<tr>${node.columns.map((column) => {
        const cell = row.cells.find((candidate) => candidate.columnId === column.id);
        return `<td>${escapeHtml(cell?.value ?? "")}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></section>`;
    case "detail":
      return `<section data-node-kind="detail"><h3>${escapeHtml(node.title)}</h3><p>${escapeHtml(node.body)}</p></section>`;
    case "progress":
      return `<label>${escapeHtml(node.label)}<progress value="${node.value}" max="${node.max}"></progress></label>`;
    case "log":
      return `<section data-node-kind="log"><h3>${escapeHtml(node.title)}</h3>${renderLogEntries(node.entries)}</section>`;
    case "log-stream":
      return `<section data-node-kind="log-stream" data-stream-id="${escapeHtml(node.streamId)}" data-source-kind="${escapeHtml(node.source.kind)}" data-source-path="${escapeHtml(node.source.path)}" data-event-types="${escapeHtml(node.source.eventTypes.join(","))}"><h3>${escapeHtml(node.title)}</h3>${renderLogEntries(node.entries)}</section>`;
    case "form":
      return `<form data-node-kind="form"><h3>${escapeHtml(node.title)}</h3>${node.fields.map(renderField).join("")}${renderAction(node.submit)}</form>`;
    case "action-list":
      return `<section data-node-kind="action-list"><h3>${escapeHtml(node.title)}</h3>${node.actions.map(renderAction).join("")}</section>`;
    case "command":
      return renderAction(node.action);
    case "empty":
      return `<section data-node-kind="empty"><h3>${escapeHtml(node.title)}</h3><p>${escapeHtml(node.detail)}</p>${renderAction(node.action)}</section>`;
    case "error":
      return `<section data-node-kind="error"><h3>${escapeHtml(node.title)}</h3><p>${escapeHtml(node.detail)}</p>${renderAction(node.action)}</section>`;
  }
}

function renderSurface(surface: UiSurface): string {
  return `<article data-surface-id="${escapeHtml(surface.surfaceId)}" data-extension-id="${escapeHtml(surface.extensionId)}" data-intent="${escapeHtml(surface.intent)}"><h2>${escapeHtml(surface.title)}</h2>${surface.nodes.map(renderNode).join("")}</article>`;
}

export function renderUiSurfaceBundleHtml(bundle: UiSurfaceBundle): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>KOTA UI Surface Fixture</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#17202a}article{border:1px solid #ccd4dd;border-radius:8px;padding:16px;margin:0 0 16px}button{margin:4px 8px 4px 0}table{border-collapse:collapse}td,th{border:1px solid #ccd4dd;padding:4px 8px;text-align:left}</style></head><body><main data-protocol="${escapeHtml(bundle.protocolVersion)}">${bundle.surfaces.map(renderSurface).join("")}</main></body></html>`;
}
