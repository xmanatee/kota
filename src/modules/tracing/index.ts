import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { buildModelLookup, WorkflowTracer } from "./tracer.js";

type TracingConfig = {
  endpoint: string;
  samplingRate?: number;
  serviceName?: string;
};

let shutdown: (() => Promise<void>) | undefined;
let unsubscribers: Array<() => void> = [];

async function initProvider(config: TracingConfig): Promise<() => Promise<void>> {
  const {
    NodeTracerProvider,
    BatchSpanProcessor,
    AlwaysOnSampler,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
  } = await import("@opentelemetry/sdk-trace-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");

  const resource = resourceFromAttributes({
    "service.name": config.serviceName ?? "kota",
  });

  const root =
    config.samplingRate === undefined || config.samplingRate >= 1
      ? new AlwaysOnSampler()
      : new TraceIdRatioBasedSampler(config.samplingRate);
  const sampler = new ParentBasedSampler({ root });

  const exporter = new OTLPTraceExporter({ url: config.endpoint });
  const provider = new NodeTracerProvider({
    resource,
    sampler,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();

  return async () => {
    await provider.shutdown();
  };
}

function subscribeToEvents(ctx: ModuleContext, tracer: WorkflowTracer): void {
  unsubscribers.push(
    ctx.events.subscribe("workflow.started", (payload) => {
      tracer.onWorkflowStarted(payload as Parameters<typeof tracer.onWorkflowStarted>[0]);
    }),
    ctx.events.subscribe("workflow.step.started", (payload) => {
      tracer.onStepStarted(payload as Parameters<typeof tracer.onStepStarted>[0]);
    }),
    ctx.events.subscribe("workflow.step.completed", (payload) => {
      tracer.onStepCompleted(payload as Parameters<typeof tracer.onStepCompleted>[0]);
    }),
    ctx.events.subscribe("workflow.completed", (payload) => {
      tracer.onWorkflowCompleted(payload as Parameters<typeof tracer.onWorkflowCompleted>[0]);
    }),
  );
}

function flattenSteps(
  steps: ReadonlyArray<{ id: string; type: string; model?: string; steps?: ReadonlyArray<unknown>; ifTrue?: ReadonlyArray<unknown>; ifFalse?: ReadonlyArray<unknown> }>,
): Array<{ id: string; type: string; model?: string; agentName?: string }> {
  const result: Array<{ id: string; type: string; model?: string; agentName?: string }> = [];
  for (const step of steps) {
    result.push(step as { id: string; type: string; model?: string; agentName?: string });
    if ("steps" in step && Array.isArray(step.steps)) {
      result.push(...flattenSteps(step.steps as typeof steps));
    }
    if ("ifTrue" in step && Array.isArray(step.ifTrue)) {
      result.push(...flattenSteps(step.ifTrue as typeof steps));
    }
    if ("ifFalse" in step && Array.isArray(step.ifFalse)) {
      result.push(...flattenSteps(step.ifFalse as typeof steps));
    }
  }
  return result;
}

const tracingModule: KotaModule = {
  name: "tracing",
  version: "1.0.0",
  description: "OpenTelemetry workflow execution tracing with structured spans",

  configKeys: [{ key: "tracing", description: "OpenTelemetry trace export endpoint and sampling config" }],

  onLoad: async (ctx) => {
    const config = ctx.config.tracing;
    if (!config?.endpoint) {
      ctx.log.debug("Tracing disabled (no endpoint configured)");
      return;
    }

    shutdown = await initProvider(config);

    const workflows = ctx.getContributedWorkflows();
    const flatWorkflows = workflows.map((wf: RegisteredWorkflowDefinitionInput) => ({
      name: wf.name,
      steps: flattenSteps(wf.steps as Parameters<typeof flattenSteps>[0]),
    }));
    const modelLookup = buildModelLookup(flatWorkflows, ctx.config.agentModels);
    const tracer = new WorkflowTracer(ctx.cwd, modelLookup, (msg, err) => {
      ctx.log.debug(msg, err);
    });

    subscribeToEvents(ctx, tracer);
    ctx.log.info(`Tracing enabled → ${config.endpoint}`);
  },

  onUnload: async () => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers = [];
    if (shutdown) {
      await shutdown();
      shutdown = undefined;
    }
  },
};

export default tracingModule;
