export const inboundSignalsConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    routes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "targets"],
        properties: {
          id: { type: "string", minLength: 1 },
          provider: { type: "string", minLength: 1 },
          channel: { type: "string", minLength: 1 },
          accountId: { type: "string", minLength: 1 },
          sourceId: { type: "string", minLength: 1 },
          actorTrust: {
            type: "string",
            enum: ["trusted", "untrusted", "blocked"],
          },
          scopeId: { type: "string", minLength: 1 },
          sourceStatus: {
            type: "string",
            enum: ["active", "blocked", "archived", "ignored"],
          },
          blockedHandling: {
            type: "string",
            enum: ["audit-only", "dispatch"],
          },
          targets: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "name"],
              properties: {
                kind: { type: "string", enum: ["workflow", "agent"] },
                name: { type: "string", minLength: 1 },
                maxTurns: { type: "integer", minimum: 1 },
                batch: {
                  type: "object",
                  additionalProperties: false,
                  required: ["mode"],
                  properties: {
                    mode: { type: "string", enum: ["workflow-trigger"] },
                    maxItems: { type: "integer", minimum: 1 },
                    maxAgeMs: { type: "integer", minimum: 1 },
                    idleMs: { type: "integer", minimum: 1 },
                    maxBufferSize: { type: "integer", minimum: 1 },
                    overflow: {
                      type: "string",
                      enum: ["drop-newest", "flush-oldest"],
                    },
                    groupBy: {
                      type: "array",
                      uniqueItems: true,
                      items: {
                        type: "string",
                        enum: [
                          "provider",
                          "channel",
                          "accountId",
                          "sourceId",
                          "actorTrust",
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          batch: {
            type: "object",
            additionalProperties: false,
            required: ["mode"],
            properties: {
              mode: { type: "string", enum: ["workflow-trigger"] },
              maxItems: { type: "integer", minimum: 1 },
              maxAgeMs: { type: "integer", minimum: 1 },
              idleMs: { type: "integer", minimum: 1 },
              maxBufferSize: { type: "integer", minimum: 1 },
              overflow: {
                type: "string",
                enum: ["drop-newest", "flush-oldest"],
              },
              groupBy: {
                type: "array",
                uniqueItems: true,
                items: {
                  type: "string",
                  enum: [
                    "provider",
                    "channel",
                    "accountId",
                    "sourceId",
                    "actorTrust",
                  ],
                },
              },
            },
          },
          processing: {
            type: "object",
            additionalProperties: false,
            properties: {
              classifier: { type: "string", enum: ["none", "cheap"] },
              modelTier: {
                type: "string",
                enum: ["fast", "balanced", "capable"],
              },
              allowNonReadActions: { type: "boolean" },
            },
          },
        },
      },
    },
  },
};
