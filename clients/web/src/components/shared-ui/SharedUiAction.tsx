import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useScopeId } from "@/lib/scope-context";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import type {
  UiAction,
  UiFormField,
  UiJsonValue,
} from "../../../../conformance/ui-surface.generated";
import { ActionField, readParameters } from "./SharedUiActionFields";
import {
  describeReadiness,
  effectLabel,
  requiresConfirmation,
} from "./ui-action-state";
import {
  conditionLabel,
  operationLabel,
  permissionLabel,
} from "./ui-render-utils";

type Parameters = Readonly<Record<string, UiJsonValue>>;

export function SharedUiAction({
  action,
  fields = action.parameters?.fields,
  initialParameters = {},
  expanded = false,
}: {
  action: UiAction;
  fields?: readonly UiFormField[];
  initialParameters?: Readonly<Record<string, UiJsonValue>>;
  expanded?: boolean;
}) {
  const visibleFields = fields?.filter(
    (field) => initialParameters[field.id] === undefined,
  );
  const hasFields = visibleFields !== undefined && visibleFields.length > 0;

  if (hasFields && !expanded) {
    return (
      <details
        className="rounded-md border border-border bg-background"
        data-action-id={action.actionId}
      >
        <summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
          {action.label}
        </summary>
        <div className="border-t border-border p-3">
          <ActionForm
            action={action}
            fields={visibleFields}
            initialParameters={initialParameters}
          />
        </div>
      </details>
    );
  }

  return (
    <ActionForm
      action={action}
      fields={visibleFields}
      initialParameters={initialParameters}
    />
  );
}

function ActionForm({
  action,
  fields,
  initialParameters,
}: {
  action: UiAction;
  fields?: readonly UiFormField[];
  initialParameters: Readonly<Record<string, UiJsonValue>>;
}) {
  const formId = useId();
  const scopeId = useScopeId();
  const queryClient = useQueryClient();
  const [confirmationParameters, setConfirmationParameters] =
    useState<Parameters | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (parameters: Parameters | undefined) =>
      api.executeUiAction(action, parameters),
    onSuccess: (result) => {
      setConfirmationParameters(null);
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.uiSurfaces(scopeId),
        });
      }
    },
  });

  const execute = (parameters: Parameters | undefined) => {
    mutation.reset();
    setValidationError(null);
    if (requiresConfirmation(action)) {
      setConfirmationParameters(parameters ?? {});
      return;
    }
    mutation.mutate(parameters);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const parameters = readParameters(
        new FormData(event.currentTarget),
        fields ?? [],
        action,
        initialParameters,
      );
      execute(parameters);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const readiness = describeReadiness(action.readiness);
  const disabled = action.readiness.state !== "ready" || mutation.isPending;
  const result = mutation.data;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit}
      data-action-id={action.actionId}
      data-effect={action.effect}
      data-operation-kind={action.operation.kind}
      data-readiness={action.readiness.state}
      data-confirmation={action.confirmation.mode}
      aria-label={action.label}
    >
      {fields && fields.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <ActionField
              key={field.id}
              action={action}
              field={field}
              inputId={`${formId}-${field.id}`}
            />
          ))}
        </div>
      ) : null}

      {action.conditions?.length || action.permissions?.length ? (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label={`${action.label} requirements`}
        >
          {action.conditions?.map((condition, index) => (
            <Badge
              key={`${conditionLabel(condition)}-${index}`}
              variant="secondary"
            >
              {conditionLabel(condition)}
            </Badge>
          ))}
          {action.permissions?.map((permission, index) => (
            <Badge
              key={`${permissionLabel(permission)}-${index}`}
              variant="outline"
            >
              {permissionLabel(permission)}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          className="min-h-11"
          variant={action.effect === "read" ? "outline" : "default"}
          disabled={disabled}
        >
          {mutation.isPending ? "Working…" : action.label}
        </Button>
        <span className="text-xs text-muted-foreground">
          {operationLabel(action)} · {effectLabel(action.effect)}
        </span>
      </div>

      {readiness.message ? (
        <p
          className={cn(
            "text-xs",
            readiness.available
              ? "text-muted-foreground"
              : "text-warning-foreground",
          )}
        >
          {readiness.message}
        </p>
      ) : null}

      {confirmationParameters !== null &&
      action.confirmation.mode === "required" ? (
        <div
          className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/10 p-3"
          role="alert"
          data-confirm-risk={action.confirmation.risk}
        >
          <div>
            <p className="text-sm font-semibold">{action.confirmation.title}</p>
            <p className="text-sm text-muted-foreground">
              {action.confirmation.detail}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              variant={
                action.confirmation.risk === "high" ? "destructive" : "default"
              }
              onClick={() => mutation.mutate(confirmationParameters)}
            >
              {action.confirmation.confirmLabel}
            </Button>
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              variant="ghost"
              onClick={() => setConfirmationParameters(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {validationError ? (
        <p className="text-sm text-destructive" role="alert">
          {validationError}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {mutation.error instanceof Error
            ? mutation.error.message
            : String(mutation.error)}
        </p>
      ) : null}
      {result ? (
        <output
          className={cn(
            "max-w-[72ch] whitespace-pre-wrap break-words text-sm",
            result.ok ? "text-success-foreground" : "text-destructive",
          )}
          data-action-result={result.ok ? "success" : "error"}
        >
          {result.message}
        </output>
      ) : null}
    </form>
  );
}
