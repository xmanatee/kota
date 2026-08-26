export type WorkflowDispatchPauseStatus =
  | { paused: false; kind: "none" }
  | {
      paused: true;
      kind: "operator";
      source: "database";
      message: string;
      nextAction: string;
    }
  | {
      paused: true;
      kind: "runtime";
      source: "runtime";
      message: string;
      nextAction: string;
    };
