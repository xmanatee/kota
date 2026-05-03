import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type TriggerDraft,
  type TriggerField,
  assembleTriggerPayload,
  emptyDraft,
} from "@/lib/workflow-trigger-schema";
import { type FormEvent, useState } from "react";

/**
 * Generated input form for triggering a parameterized workflow.
 *
 * Fields are derived from `inputSchema.properties` / `required` (see
 * `parseTriggerFields`). String → text input, number → number input,
 * boolean → checkbox; unknown leaf types fall back to text. Required
 * fields are marked with `*` and validated client-side before the
 * trigger fires; the daemon still validates the final payload, so the
 * client form intentionally stays a small JSON Schema subset.
 */
export function WorkflowTriggerForm({
  workflowName,
  fields,
  busy,
  onSubmit,
  onCancel,
}: {
  workflowName: string;
  fields: TriggerField[];
  busy: boolean;
  onSubmit: (payload: Record<string, string | number | boolean>) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TriggerDraft>(() => emptyDraft(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setField(name: string, value: string | number | boolean | ""): void {
    setDraft((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = assembleTriggerPayload(fields, draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.payload);
  }

  return (
    <form
      className="rounded border border-border bg-muted/30 p-2 text-xs"
      onSubmit={handleSubmit}
      aria-label={`Trigger ${workflowName}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Trigger {workflowName}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-5 px-1 text-[10px]"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      <div className="space-y-1.5">
        {fields.map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            value={draft[field.name] ?? (field.type === "boolean" ? false : "")}
            error={errors[field.name]}
            onChange={(v) => setField(field.name, v)}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <Button
          type="submit"
          size="sm"
          variant="default"
          className="h-6 text-xs"
          disabled={busy}
        >
          Trigger
        </Button>
      </div>
    </form>
  );
}

function FieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: TriggerField;
  value: string | number | boolean | "";
  error: string | undefined;
  onChange: (next: string | number | boolean | "") => void;
}) {
  const labelId = `trigger-field-${field.name}`;
  const labelText = field.required ? `${field.name} *` : field.name;

  if (field.type === "boolean") {
    return (
      <label
        className="flex items-center gap-1.5"
        htmlFor={labelId}
        title={field.description}
      >
        <input
          id={labelId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span>{labelText}</span>
        {error && <span className="text-destructive">{error}</span>}
      </label>
    );
  }

  return (
    <div className="space-y-0.5">
      <label htmlFor={labelId} className="block" title={field.description}>
        {labelText}
      </label>
      <Input
        id={labelId}
        type={field.type === "number" ? "number" : "text"}
        value={value === false || value === true ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
        aria-invalid={error ? "true" : "false"}
      />
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
