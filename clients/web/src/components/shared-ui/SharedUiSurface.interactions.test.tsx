import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiSurface } from "../../../../conformance/ui-surface.generated";
import { operatorSurface, renderSurface } from "./SharedUiSurface.test-utils";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("SharedUiSurface interactions", () => {
  it("navigates surface links and navigation nodes through the shared callback", () => {
    const onNavigate = vi.fn();
    renderSurface(operatorSurface, onNavigate);

    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(onNavigate).toHaveBeenCalledWith("status");
  });

  it("resumes graph-declared sessions through the browser shell callback", () => {
    const onSessionSelect = vi.fn();
    const sessionSurface: UiSurface = {
      ...operatorSurface,
      surfaceId: "scopes",
      extensionId: "core.scopes",
      title: "Scopes",
      nodes: [
        {
          kind: "link",
          label: "Resume session 1234abcd",
          target: { kind: "session", sessionId: "1234abcd-session" },
          role: "info",
        },
      ],
      actions: [],
    };
    renderSurface(sessionSurface, vi.fn(), {}, onSessionSelect);

    fireEvent.click(
      screen.getByRole("button", { name: "Resume session 1234abcd" }),
    );
    expect(onSessionSelect).toHaveBeenCalledWith("1234abcd-session");
  });

  it("renders multiline graph fields as text areas", () => {
    const editAction = {
      surfaceId: "tasks",
      actionId: "task.body.update",
      scopeId: operatorSurface.scopeId,
      label: "Update task body",
      effect: "write",
      operation: {
        kind: "client-namespace",
        namespace: "tasks",
        method: "updateBody",
      },
      parameters: {
        fields: [
          { id: "taskId", label: "Task id", input: "text", required: true },
          {
            id: "body",
            label: "Markdown body",
            input: "multiline",
            required: true,
          },
        ],
        schema: {
          type: "object",
          required: ["taskId", "body"],
          properties: {
            taskId: { type: "string" },
            body: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      confirmation: { mode: "none" },
      readiness: { state: "ready" },
      result: { success: { message: "Updated." }, errors: [] },
    } as const;
    const editSurface: UiSurface = {
      ...operatorSurface,
      surfaceId: "tasks",
      extensionId: "repo-tasks.queue",
      title: "Tasks",
      nodes: [
        {
          kind: "form",
          title: "Edit task markdown",
          fields: editAction.parameters.fields,
          submit: editAction,
        },
      ],
      actions: [editAction],
    };
    renderSurface(editSurface);

    expect(screen.getByLabelText("Markdown body *").tagName).toBe("TEXTAREA");
  });

  it("renders entries delivered to a graph-declared live log stream", () => {
    renderSurface(operatorSurface, vi.fn(), {
      "daemon-events": [
        {
          timestamp: "2026-08-02T18:30:00.000Z",
          level: "info",
          source: "workflow.run.completed",
          message: "Builder run completed.",
        },
      ],
    });

    expect(screen.getByText("Builder run completed.")).toBeInTheDocument();
    expect(
      screen.getAllByText(/workflow\.run\.completed/).length,
    ).toBeGreaterThan(0);
  });

  it("executes a graph-declared read action without confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message: "UI refreshed." }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderSurface();

    const form = screen.getAllByRole("form", { name: "Refresh shared UI" })[0];
    if (!form) throw new Error("missing Refresh shared UI action");
    fireEvent.click(
      within(form).getByRole("button", { name: "Refresh shared UI" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/ui/actions/execute",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            scopeId: operatorSurface.scopeId,
            surfaceId: "operator-control",
            actionId: "ui.refresh",
          }),
        }),
      ),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "UI refreshed.",
    );
  });

  it("submits typed parameters after inline confirmation and renders success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message: "Workflow queued." }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderSurface();

    const form = screen.getByRole("form", { name: "Launch workflow run" });
    fireEvent.change(within(form).getByLabelText("Workflow *"), {
      target: { value: "builder" },
    });
    fireEvent.change(within(form).getByLabelText("Payload JSON"), {
      target: { value: '{"source":"web"}' },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Launch workflow run" }),
    );
    expect(within(form).getByRole("alert")).toHaveTextContent(
      "This can start a new autonomous run",
    );
    fireEvent.click(within(form).getByRole("button", { name: "Launch run" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/ui/actions/execute",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            scopeId: operatorSurface.scopeId,
            surfaceId: "operator-control",
            actionId: "workflow.launch",
            parameters: { name: "builder", payload: { source: "web" } },
          }),
        }),
      ),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Workflow queued.",
    );
  });

  it("submits an unconfirmed graph-declared form", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message: "Session started." }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderSurface();

    const form = screen.getByRole("form", { name: "Start session" });
    fireEvent.change(within(form).getByLabelText("Autonomy mode *"), {
      target: { value: "supervised" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Start session" }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/ui/actions/execute",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            scopeId: operatorSurface.scopeId,
            surfaceId: "operator-control",
            actionId: "session.launch",
            parameters: { autonomy_mode: "supervised" },
          }),
        }),
      ),
    );
    expect(await within(form).findByRole("status")).toHaveTextContent(
      "Session started.",
    );
  });

  it("disables unavailable actions and explains readiness", () => {
    renderSurface();
    const form = screen.getByRole("form", {
      name: "Configure launch defaults",
    });
    expect(
      within(form).getByRole("button", { name: "Configure launch defaults" }),
    ).toBeDisabled();
    expect(form).toHaveTextContent(
      "configured through config/default preset selection",
    );
  });
});
