import { describe, expect, it } from "vitest";
import fixture from "../../../conformance/contract-fixture.json";
import { parseUiSurfaceBundle } from "../../../conformance/decoders";
import { renderUiSurfaceBundleHtml } from "./uiSurfaceRender";

describe("web shared UI renderer", () => {
  it("renders the shared UI fixture as semantic HTML controls", () => {
    const bundle = parseUiSurfaceBundle(fixture.uiSurfaces.statusInbox);
    const html = renderUiSurfaceBundleHtml(bundle);
    expect(html).toContain('data-surface-id="operator-control"');
    expect(html).toContain('data-node-kind="metrics"');
    expect(html).toContain('data-node-kind="link"');
    expect(html).toContain('data-node-kind="tabs"');
    expect(html).toContain('data-node-kind="table"');
    expect(html).toContain('data-node-kind="log"');
    expect(html).toContain('data-node-kind="log-stream"');
    expect(html).toContain('data-node-kind="form"');
    expect(html).toContain('data-stream-id="daemon-events"');
    expect(html).toContain('data-source-path="/events"');
    expect(html).toContain('data-action-id="workflow.launch"');
    expect(html).toContain('data-confirm="medium"');
    expect(html).toContain("POST /workflow/trigger");
    expect(html).toContain("Run tags JSON");
    expect(html).toContain("Payload JSON");
    expect(html).toContain("Resume session id");
    expect(html).toContain("Launch preset");
    expect(html).toContain("Default model");
    expect(html).toContain("Default effort");
    expect(html).toContain('data-action-id="launch.defaults.configure"');
    expect(html).toContain('data-readiness="disabled"');
    expect(html).toContain('disabled aria-disabled="true"');
    expect(html).toContain('<th scope="col">Workflow</th>');
    expect(html).toContain('data-readiness="needs-setup"');
    expect(html).toContain('data-surface-id="setup"');
    expect(html).toContain("Setup and auth requirements");
    expect(html).toContain(
      'data-action-id="setup.telegram.bot-credentials.store-secret"',
    );
    expect(html).toContain(
      'name="TELEGRAM_BOT_TOKEN" data-input="secret" type="password"',
    );
    expect(html).toContain(
      'data-action-id="setup.google-workspace.oauth-config.submit-form"',
    );
    expect(html).toContain('name="client-id-ref"');
    expect(html).not.toContain("stdin-secret-token");
  });
});
