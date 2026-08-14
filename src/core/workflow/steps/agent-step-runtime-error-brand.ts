export const AGENT_STEP_RUNTIME_ERROR = Symbol("kota.agent-step-runtime-error");

type ErrorType = { readonly prototype: Error };

export function installAgentStepRuntimeErrorBrand(errorType: ErrorType): void {
  if (Object.hasOwn(errorType, Symbol.hasInstance)) return;
  Object.defineProperty(errorType, Symbol.hasInstance, {
    configurable: true,
    value(this: ErrorType, value: object): boolean {
      const nativeMatch = Function.prototype[Symbol.hasInstance].call(
        this,
        value,
      );
      if (this !== errorType) return nativeMatch;
      return nativeMatch ||
        (typeof value === "object" && value !== null &&
          (value as { [AGENT_STEP_RUNTIME_ERROR]?: boolean })[
            AGENT_STEP_RUNTIME_ERROR
          ] === true);
    },
  });
}
