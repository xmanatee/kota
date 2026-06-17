export type AgentHarnessTranscriptTurn = {
  user: string;
  assistant: string;
};

/**
 * Compose a local chat transcript into a single harness prompt. This lets
 * stateless harness adapters receive prior turns without adding a second
 * conversation protocol.
 */
export function composeAgentHarnessTranscriptPrompt(
  transcript: AgentHarnessTranscriptTurn[],
  userInput: string,
): string {
  if (transcript.length === 0) return userInput;
  const parts: string[] = [
    "The following is the running transcript of an interactive session. Respond only to the final user message; the earlier turns are context.",
    "",
  ];
  for (const turn of transcript) {
    parts.push("<user>");
    parts.push(turn.user);
    parts.push("</user>");
    parts.push("<assistant>");
    parts.push(turn.assistant);
    parts.push("</assistant>");
    parts.push("");
  }
  parts.push("<user>");
  parts.push(userInput);
  parts.push("</user>");
  return parts.join("\n");
}
