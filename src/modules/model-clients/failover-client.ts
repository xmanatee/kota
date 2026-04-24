import type { KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import type {
  MessageCreateParams,
  MessageStream,
  MessageStreamParams,
  ModelClient,
} from "#core/model/model-client.js";
import type { HealthTrackerConfig, ProviderHealthState } from "./health-tracker.js";
import { ProviderHealthTracker } from "./health-tracker.js";

export type FailoverClientOptions = {
  primary: ModelClient;
  fallback: ModelClient;
  primaryName: string;
  fallbackName: string;
  errorThreshold: number;
  windowMs: number;
  cooldownMs: number;
};

export class FailoverModelClient implements ModelClient {
  readonly messages: ModelClient["messages"];
  private readonly primary: ModelClient;
  private readonly fallback: ModelClient;
  private readonly tracker: ProviderHealthTracker;

  constructor(opts: FailoverClientOptions) {
    this.primary = opts.primary;
    this.fallback = opts.fallback;

    const trackerConfig: HealthTrackerConfig = {
      windowMs: opts.windowMs,
      errorThreshold: opts.errorThreshold,
      cooldownMs: opts.cooldownMs,
      primaryName: opts.primaryName,
      fallbackName: opts.fallbackName,
    };
    this.tracker = new ProviderHealthTracker(trackerConfig);

    this.messages = {
      stream: (params: MessageStreamParams) => this.doStream(params),
      create: (params: MessageCreateParams) => this.doCreate(params),
    };
  }

  getHealthState(): ProviderHealthState {
    return this.tracker.getHealthState();
  }

  private activeClient(): ModelClient {
    if (this.tracker.isHealthy()) return this.primary;
    if (this.tracker.shouldProbe()) return this.primary;
    return this.fallback;
  }

  private doStream(params: MessageStreamParams): MessageStream {
    const isProbe = !this.tracker.isHealthy() && this.tracker.shouldProbe();
    const client = this.activeClient();
    const stream = client.messages.stream(params);

    const originalFinalMessage = stream.finalMessage.bind(stream);
    stream.finalMessage = async () => {
      try {
        const msg = await originalFinalMessage();
        if (client === this.primary) {
          this.tracker.recordSuccess();
          if (isProbe) this.tracker.markRecovered();
        }
        return msg;
      } catch (err) {
        if (client === this.primary) {
          if (isProbe) {
            this.tracker.markProbeFailed();
          } else {
            this.tracker.recordError();
          }
        }
        throw err;
      }
    };

    return stream;
  }

  private async doCreate(params: MessageCreateParams): Promise<KotaModelResponse> {
    const isProbe = !this.tracker.isHealthy() && this.tracker.shouldProbe();
    const client = this.activeClient();

    try {
      const result = await client.messages.create(params);
      if (client === this.primary) {
        this.tracker.recordSuccess();
        if (isProbe) this.tracker.markRecovered();
      }
      return result;
    } catch (err) {
      if (client === this.primary) {
        if (isProbe) {
          this.tracker.markProbeFailed();
        } else {
          this.tracker.recordError();
        }
      }
      throw err;
    }
  }
}
