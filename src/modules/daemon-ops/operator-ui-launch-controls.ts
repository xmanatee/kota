import {
  getPreset,
  listShippedPresets,
  SHIPPED_DEFAULT_PRESET_ID,
} from "#core/model/preset.js";
import type {
  UiActionParameterSpec,
  UiFieldOption,
  UiFormField,
} from "./operator-ui-types.js";

export function launchWorkflowParameters(): UiActionParameterSpec {
  const fields: UiFormField[] = [
    {
      id: "name",
      label: "Workflow",
      input: "select",
      required: true,
      options: [
        { label: "Builder", value: "builder" },
        { label: "Decomposer", value: "decomposer" },
      ],
    },
    {
      id: "tags",
      label: "Run tags JSON",
      input: "text",
      required: false,
      schema: {
        type: "array",
        description: "Optional workflow run tags sent as a JSON string array.",
        items: { type: "string" },
      },
    },
    {
      id: "payload",
      label: "Payload JSON",
      input: "text",
      required: false,
      schema: {
        type: "object",
        description: "Optional workflow payload object.",
        properties: {},
        additionalProperties: true,
      },
    },
  ];
  return {
    fields,
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", enum: ["builder", "decomposer"], default: "builder" },
        tags: {
          type: "array",
          description: "Optional workflow run tags.",
          items: { type: "string" },
        },
        payload: {
          type: "object",
          description: "Optional workflow trigger payload.",
          properties: {},
          additionalProperties: true,
        },
      },
      additionalProperties: false,
    },
  };
}

export function sessionLaunchParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "autonomy_mode",
        label: "Autonomy mode",
        input: "select",
        required: true,
        options: [
          { label: "Passive", value: "passive" },
          { label: "Supervised", value: "supervised" },
          { label: "Autonomous", value: "autonomous" },
        ],
      },
      {
        id: "session_id",
        label: "Resume session id",
        input: "text",
        required: false,
      },
      {
        id: "conversation_id",
        label: "Resume conversation id",
        input: "text",
        required: false,
      },
    ],
    schema: {
      type: "object",
      required: ["autonomy_mode"],
      properties: {
        autonomy_mode: { type: "string", enum: ["passive", "supervised", "autonomous"], default: "supervised" },
        session_id: { type: "string" },
        conversation_id: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

function shippedPresetOptions(): UiFieldOption[] {
  return listShippedPresets().map((preset) => ({
    label: preset.id,
    value: preset.id,
  }));
}

function shippedModelOptions(): UiFieldOption[] {
  const seen = new Set<string>();
  const options: UiFieldOption[] = [];
  for (const preset of listShippedPresets()) {
    for (const model of [preset.defaultModel, preset.tiers.fast, preset.tiers.balanced, preset.tiers.capable]) {
      if (seen.has(model)) continue;
      seen.add(model);
      options.push({ label: model, value: model });
    }
  }
  return options;
}

export function launchDefaultParameters(): UiActionParameterSpec {
  const defaultPreset = getPreset(SHIPPED_DEFAULT_PRESET_ID);
  const effortOptions: UiFieldOption[] = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "XHigh", value: "xhigh" },
    { label: "Max", value: "max" },
  ];
  return {
    fields: [
      {
        id: "preset",
        label: "Launch preset",
        input: "select",
        required: true,
        options: shippedPresetOptions(),
      },
      {
        id: "model",
        label: "Default model",
        input: "select",
        required: true,
        options: shippedModelOptions(),
      },
      {
        id: "effort",
        label: "Default effort",
        input: "select",
        required: true,
        options: effortOptions,
      },
      {
        id: "use_shipped_defaults",
        label: "Use shipped defaults",
        input: "boolean",
        required: false,
      },
    ],
    schema: {
      type: "object",
      required: ["preset", "model", "effort"],
      properties: {
        preset: {
          type: "string",
          enum: shippedPresetOptions().map((option) => option.value),
          default: defaultPreset.id,
        },
        model: {
          type: "string",
          enum: shippedModelOptions().map((option) => option.value),
          default: defaultPreset.defaultModel,
        },
        effort: {
          type: "string",
          enum: effortOptions.map((option) => option.value),
          default: defaultPreset.defaultEffort,
        },
        use_shipped_defaults: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  };
}
