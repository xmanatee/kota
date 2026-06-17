import { line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, printToStderr } from "#modules/rendering/transport.js";

function renderTextBlock(text: string) {
  const lines = text.split("\n");
  return stack(...lines.map((entry) => line(plain(entry))));
}

export function printWorkflowText(text = ""): void {
  print(renderTextBlock(text));
}

export function printWorkflowError(text: string): void {
  printToStderr(line(span(text, "error")));
}
