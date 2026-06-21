export type NodeOptionsSourceConditionResult = {
  nodeOptions: string | undefined;
  removedSourceCondition: boolean;
};

export function nodeOptionsWithoutSourceCondition(
  value: string | undefined,
): NodeOptionsSourceConditionResult {
  if (value === undefined) {
    return { nodeOptions: undefined, removedSourceCondition: false };
  }

  const parts = value.split(/\s+/).filter((part) => part.length > 0);
  const kept: string[] = [];
  let removedSourceCondition = false;

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part === "--conditions=source") {
      removedSourceCondition = true;
      continue;
    }
    if (part === "--conditions" && parts[index + 1] === "source") {
      removedSourceCondition = true;
      index++;
      continue;
    }
    kept.push(part);
  }

  return {
    nodeOptions: kept.length > 0 ? kept.join(" ") : undefined,
    removedSourceCondition,
  };
}

export function envWithoutSourceConditionNodeOption(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result = nodeOptionsWithoutSourceCondition(env.NODE_OPTIONS);
  if (!result.removedSourceCondition) {
    return env;
  }

  const nextEnv = { ...env };
  if (result.nodeOptions === undefined) {
    delete nextEnv.NODE_OPTIONS;
  } else {
    nextEnv.NODE_OPTIONS = result.nodeOptions;
  }
  return nextEnv;
}
