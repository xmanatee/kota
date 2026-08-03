import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ReactNode } from "react";
import type {
  UiAction,
  UiFormField,
  UiJsonSchema,
  UiJsonValue,
} from "../../../../conformance/ui-surface.generated";
import { assertNever } from "./ui-render-utils";

type Parameters = Readonly<Record<string, UiJsonValue>>;

export function ActionField({
  action,
  field,
  inputId,
}: {
  action: UiAction;
  field: UiFormField;
  inputId: string;
}) {
  const schema = field.schema ?? action.parameters?.schema.properties[field.id];
  const description = schema?.description;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const defaultValue = schemaDefault(schema);
  const label = (
    <label className="text-sm font-medium" htmlFor={inputId}>
      {field.label}
      {field.required ? <span aria-hidden="true"> *</span> : null}
    </label>
  );
  let control: ReactNode;

  switch (field.input) {
    case "boolean":
      control = (
        <div className="flex min-h-11 items-center gap-2">
          <input
            id={inputId}
            name={field.id}
            type="checkbox"
            defaultChecked={defaultValue === true}
            aria-describedby={descriptionId}
            aria-required={field.required}
            className="size-4 rounded border-input accent-primary"
          />
          {label}
        </div>
      );
      break;
    case "select":
      control = (
        <>
          {label}
          <Select
            id={inputId}
            name={field.id}
            required={field.required}
            aria-describedby={descriptionId}
            className="min-h-11"
            defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          >
            {!field.required ? <option value="">Not set</option> : null}
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </>
      );
      break;
    case "number":
      control = (
        <>
          {label}
          <Input
            id={inputId}
            name={field.id}
            type="number"
            required={field.required}
            aria-describedby={descriptionId}
            className="min-h-11"
            defaultValue={typeof defaultValue === "number" ? defaultValue : ""}
            min={numericBoundary(schema, "minimum")}
            max={numericBoundary(schema, "maximum")}
          />
        </>
      );
      break;
    case "secret":
    case "path":
    case "url":
    case "multiline":
    case "text": {
      const isStructured =
        schema?.type === "array" || schema?.type === "object";
      const type =
        field.input === "secret"
          ? "password"
          : field.input === "url"
            ? "url"
            : "text";
      control = (
        <>
          {label}
          {isStructured || field.input === "multiline" ? (
            <Textarea
              id={inputId}
              name={field.id}
              required={field.required}
              aria-describedby={descriptionId}
              className="min-h-11"
              rows={field.input === "multiline" ? 10 : 4}
              defaultValue={
                defaultValue === undefined
                  ? ""
                  : JSON.stringify(defaultValue, null, 2)
              }
            />
          ) : (
            <Input
              id={inputId}
              name={field.id}
              type={type}
              required={field.required}
              aria-describedby={descriptionId}
              autoComplete={
                field.input === "secret" ? "new-password" : undefined
              }
              className="min-h-11"
              defaultValue={
                typeof defaultValue === "string" ? defaultValue : ""
              }
            />
          )}
        </>
      );
      break;
    }
    default:
      return assertNever(field.input);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {control}
      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function readParameters(
  formData: FormData,
  fields: readonly UiFormField[],
  action: UiAction,
  initialParameters: Readonly<Record<string, UiJsonValue>>,
): Parameters | undefined {
  if (fields.length === 0 && Object.keys(initialParameters).length === 0) {
    return undefined;
  }
  const parameters: Record<string, UiJsonValue> = { ...initialParameters };
  for (const field of fields) {
    if (field.input === "boolean") {
      parameters[field.id] = formData.has(field.id);
      continue;
    }
    const raw = formData.get(field.id);
    if (typeof raw !== "string" || raw === "") continue;
    const schema =
      field.schema ?? action.parameters?.schema.properties[field.id];
    if (
      field.input === "number" ||
      schema?.type === "number" ||
      schema?.type === "integer"
    ) {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`${field.label} must be a number.`);
      }
      parameters[field.id] = value;
      continue;
    }
    if (schema?.type === "array" || schema?.type === "object") {
      try {
        parameters[field.id] = JSON.parse(raw) as UiJsonValue;
      } catch {
        throw new Error(`${field.label} must be valid JSON.`);
      }
      continue;
    }
    parameters[field.id] = raw;
  }
  return parameters;
}

function schemaDefault(
  schema: UiJsonSchema | undefined,
): UiJsonValue | undefined {
  if (!schema || !("default" in schema)) return undefined;
  return schema.default;
}

function numericBoundary(
  schema: UiJsonSchema | undefined,
  key: "minimum" | "maximum",
): number | undefined {
  if (!schema || (schema.type !== "number" && schema.type !== "integer")) {
    return undefined;
  }
  return schema[key];
}
