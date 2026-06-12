import type { RenderNode } from "#modules/rendering/primitives.js";

export type ScreenName = "status" | "inbox" | "work" | "knowledge" | "setup";

export interface NavigatorPrompt {
  ask(prompt: string): Promise<string | null>;
  close(): void;
}

export interface NavigatorOutput {
  write(node: RenderNode): void;
}
