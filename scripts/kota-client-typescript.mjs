import {
  DAEMON_OPERATION_DESCRIPTORS,
  GENERATED_DAEMON_CLIENT_GRAPH,
  KOTA_CLIENT_NAMESPACE_GRAPH,
} from "./daemon-contract-graph.mjs";

const DEFAULT_DECODER_SOURCE = "#root/client/daemon-contract.generated.js";

function upperFirst(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function namespaceDefinition(namespace) {
  const definition = KOTA_CLIENT_NAMESPACE_GRAPH.find(([name]) => name === namespace);
  if (!definition) throw new Error(`Generated daemon client has unknown namespace: ${namespace}`);
  return { type: definition[1], source: definition[2] };
}

function generatedOperations(namespace) {
  return DAEMON_OPERATION_DESCRIPTORS.filter(
    (operation) => operation.namespace === namespace,
  );
}

function routineOperations(namespace) {
  return generatedOperations(namespace).filter(
    (operation) => operation.classification === "routine",
  );
}

function methodArgumentNames(operation) {
  return (operation.parameters ?? [])
    .filter((parameter) => parameter.source === undefined)
    .map((parameter) => parameter.name);
}

function renderPath(path) {
  if (!path.includes(":")) return JSON.stringify(path);
  return `\`${path.replace(
    /:([A-Za-z_$][A-Za-z0-9_$]*)/g,
    (_, name) => `\${encodeURIComponent(${name})}`,
  )}\``;
}

function renderQuery(operation) {
  const queryParameters = (operation.parameters ?? []).filter((parameter) =>
    ["query", "queryOptions", "scopeQuery"].includes(parameter.type),
  );
  if (queryParameters.length === 0) return { statements: [], path: renderPath(operation.path) };

  const statements = ["const params = new URLSearchParams();"];
  for (const parameter of queryParameters) {
    if (parameter.type === "query") {
      statements.push(
        `appendQueryValue(params, ${JSON.stringify(parameter.wireName ?? parameter.name)}, ${parameter.name});`,
      );
      continue;
    }
    if (parameter.type === "queryOptions") {
      const wireNames = parameter.wireNames
        ? `, ${JSON.stringify(parameter.wireNames)}`
        : "";
      statements.push(`appendQueryObject(params, ${parameter.name}${wireNames});`);
      continue;
    }
    const value = parameter.source
      ? `${parameter.source}?.${parameter.name}`
      : `${parameter.name}?.scopeId`;
    statements.push("appendQueryValue(params, \"scopeId\", " + value + ");");
  }
  return {
    statements,
    path: `withQuery(${renderPath(operation.path)}, params)`,
  };
}

function renderBody(operation) {
  const parameters = operation.parameters ?? [];
  const direct = parameters.find((parameter) => parameter.type === "bodyDirect");
  if (direct) return direct.name;

  const bodyParameters = parameters.filter((parameter) =>
    ["body", "bodyFilter", "bodySpread"].includes(parameter.type),
  );
  if (bodyParameters.length === 0) return undefined;

  const entries = [];
  for (const parameter of bodyParameters) {
    if (parameter.type === "bodySpread") {
      const omitted = parameters
        .filter((candidate) => candidate.source === parameter.name)
        .map((candidate) => candidate.name);
      const value = omitted.length > 0
        ? `omitBodyKeys(${parameter.name}, ${JSON.stringify(omitted)})`
        : parameter.name;
      entries.push(`...(${value} ?? {})`);
      continue;
    }

    const key = parameter.type === "bodyFilter" ? "filter" : parameter.name;
    if (parameter.defaultValue !== undefined) {
      entries.push(`${key}: ${parameter.name} ?? ${parameter.defaultValue}`);
    } else if (parameter.optional) {
      entries.push(`...(${parameter.name} !== undefined && { ${key}: ${parameter.name} })`);
    } else {
      entries.push(`${key}: ${parameter.name}`);
    }
  }
  return `{ ${entries.join(", ")} }`;
}

function indent(lines, spaces) {
  const prefix = " ".repeat(spaces);
  return lines.map((line) => (line.length > 0 ? prefix + line : line));
}

function renderRoutineMethod(operation, clientType, transportExpression, indentation) {
  const argumentsList = methodArgumentNames(operation);
  const args = argumentsList.join(", ");
  const returnType = `Awaited<ReturnType<${clientType}[${JSON.stringify(operation.clientMethod)}]>>`;
  const parameters = argumentsList.length === 0
    ? ""
    : `...[${args}]: Parameters<${clientType}[${JSON.stringify(operation.clientMethod)}]>`;
  const lines = [
    `async ${operation.clientMethod}(${parameters}): Promise<${returnType}> {`,
  ];

  if (operation.derivedFrom) {
    const resultPath = operation.resultPath ? `.${operation.resultPath}` : "";
    lines.push(`  return (await this.${operation.derivedFrom}(${args}))${resultPath};`, "}");
    return indent(lines, indentation).join("\n");
  }

  const query = renderQuery(operation);
  lines.push(...query.statements.map((statement) => `  ${statement}`));
  const body = renderBody(operation);
  const requestArguments = [JSON.stringify(operation.method), query.path];
  if (body !== undefined) requestArguments.push(body);
  const request = requestArguments.join(", ");

  if (operation.transport === "nullable") {
    lines.push(
      `  const result = await ${transportExpression}.request<${returnType}>(${request});`,
      "  if (!result) {",
      `    throw new Error(${JSON.stringify(operation.unavailableMessage)});`,
      "  }",
      "  return result;",
      "}",
    );
    return indent(lines, indentation).join("\n");
  }

  if (operation.responseDecoder) {
    lines.push(
      `  const decoded = await ${transportExpression}.requestStrict<unknown>(${request});`,
      `  return ${operation.responseDecoder}(decoded);`,
      "}",
    );
    return indent(lines, indentation).join("\n");
  }

  lines.push(
    `  return ${transportExpression}.requestStrict<${returnType}>(${request});`,
    "}",
  );
  return indent(lines, indentation).join("\n");
}

function renderCompleteClient(definition) {
  const { type } = namespaceDefinition(definition.namespace);
  const className = `Routine${upperFirst(definition.namespace)}Client`;
  const methods = routineOperations(definition.namespace)
    .map((operation) => renderRoutineMethod(operation, type, "this.transport", 2))
    .join("\n\n");
  return `class ${className} implements ${type} {
  constructor(private readonly transport: DaemonTransport) {}

${methods}
}`;
}

function renderPartialClient(definition) {
  const { type } = namespaceDefinition(definition.namespace);
  const operations = generatedOperations(definition.namespace);
  const exceptions = operations
    .filter((operation) => operation.classification === "exception")
    .map((operation) => JSON.stringify(operation.clientMethod));
  if (exceptions.length === 0) {
    throw new Error(`Partial generated client has no exceptions: ${definition.namespace}`);
  }
  const methods = routineOperations(definition.namespace)
    .map((operation) => renderRoutineMethod(operation, type, "transport", 4))
    .join(",\n");
  return `export type ${definition.exportStem}DaemonClientExceptions = Pick<
  ${type},
  ${exceptions.join(" | ")}
>;

export function create${definition.exportStem}DaemonClient(
  transport: DaemonTransport,
  exceptions: ${definition.exportStem}DaemonClientExceptions,
): ${type} {
  return {
${methods},
    ...exceptions,
  };
}`;
}

function renderImports() {
  const importsByPath = new Map();
  for (const [, type, path] of KOTA_CLIENT_NAMESPACE_GRAPH) {
    const entry = importsByPath.get(path) ?? { types: new Set(), values: new Set() };
    entry.types.add(type);
    importsByPath.set(path, entry);
  }
  for (const definition of GENERATED_DAEMON_CLIENT_GRAPH) {
    for (const operation of routineOperations(definition.namespace)) {
      if (!operation.responseDecoder) continue;
      const source = operation.responseDecoderSource ?? DEFAULT_DECODER_SOURCE;
      const entry = importsByPath.get(source) ?? { types: new Set(), values: new Set() };
      entry.values.add(operation.responseDecoder);
      importsByPath.set(source, entry);
    }
  }
  return [...importsByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, symbols]) => {
      const lines = [];
      if (symbols.types.size > 0) {
        lines.push(`import type { ${[...symbols.types].sort().join(", ")} } from ${JSON.stringify(path)};`);
      }
      if (symbols.values.size > 0) {
        lines.push(`import { ${[...symbols.values].sort().join(", ")} } from ${JSON.stringify(path)};`);
      }
      return lines;
    })
    .join("\n");
}

export function generateKotaClientAggregate() {
  const imports = renderImports();
  const fields = KOTA_CLIENT_NAMESPACE_GRAPH
    .map(([name, type]) => `  readonly ${name}: ${type};`)
    .join("\n");
  const names = KOTA_CLIENT_NAMESPACE_GRAPH
    .map(([name]) => `  ${JSON.stringify(name)},`)
    .join("\n");
  const completeDefinitions = GENERATED_DAEMON_CLIENT_GRAPH.filter(
    (definition) => definition.kind === "complete",
  );
  const clients = completeDefinitions.map(renderCompleteClient).join("\n\n");
  const partialClients = GENERATED_DAEMON_CLIENT_GRAPH
    .filter((definition) => definition.kind === "partial")
    .map(renderPartialClient)
    .join("\n\n");
  const routineNamespaceUnion = completeDefinitions
    .map((definition) => `  | ${JSON.stringify(definition.namespace)}`)
    .join("\n");
  const routineAssignments = completeDefinitions
    .map(
      (definition) =>
        `    ${definition.namespace}: new Routine${upperFirst(definition.namespace)}Client(transport),`,
    )
    .join("\n");

  return `// Generated from scripts/daemon-contract-graph.mjs.
// Do not edit this file directly. Run \`pnpm build:client-bindings\`.

import type { DaemonTransport } from "#core/server/daemon-transport.js";
${imports}

export interface KotaClient {
  forScope(scopeId: string): KotaClient;
${fields}
}

export const KOTA_CLIENT_NAMESPACES = [
${names}
] as const satisfies ReadonlyArray<keyof KotaClient>;

export type KotaClientNamespace = (typeof KOTA_CLIENT_NAMESPACES)[number];
export type KotaClientPort<K extends KotaClientNamespace> = Readonly<Pick<KotaClient, K>>;
export type ScopedKotaClientPort<K extends KotaClientNamespace> = KotaClientPort<K> &
  Readonly<Pick<KotaClient, "forScope">>;
export type LocalClientHandlers = { [K in KotaClientNamespace]: KotaClient[K] };
export type DaemonClientHandlers = { [K in KotaClientNamespace]: KotaClient[K] };

function assignKotaClientNamespaces(
  target: object,
  handlers: LocalClientHandlers | DaemonClientHandlers,
): void {
  for (const name of KOTA_CLIENT_NAMESPACES) {
    Object.defineProperty(target, name, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: handlers[name],
    });
  }
}

export abstract class KotaClientNamespaceHost implements KotaClient {
  abstract forScope(scopeId: string): KotaClient;
${fields.replaceAll("readonly ", "declare readonly ")}

  constructor(handlers: LocalClientHandlers | DaemonClientHandlers) {
    assignKotaClientNamespaces(this, handlers);
  }
}

export class KotaClientScopeError extends Error {
  readonly reason = "unknown_scope" as const;
  readonly scopeId: string;

  constructor(scopeId: string, cause?: Error) {
    super(\`Unknown scope: \${scopeId}\`, cause ? { cause } : undefined);
    this.name = "KotaClientScopeError";
    this.scopeId = scopeId;
  }
}

function appendQueryValue(
  params: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(params, name, item);
    return;
  }
  params.append(name, String(value));
}

function appendQueryObject(
  params: URLSearchParams,
  value: object | undefined,
  wireNames: Readonly<Record<string, string>> = {},
): void {
  if (!value) return;
  for (const [name, item] of Object.entries(value)) {
    appendQueryValue(params, wireNames[name] ?? name, item);
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query.length > 0 ? \`\${path}?\${query}\` : path;
}

function omitBodyKeys(
  value: object | undefined,
  omitted: readonly string[],
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([name]) => !omitted.includes(name)),
  );
}

${clients}

${partialClients}

export type RoutineDaemonClientHandlers = Pick<
  DaemonClientHandlers,
${routineNamespaceUnion}
>;

export function createRoutineDaemonClientHandlers(
  transport: DaemonTransport,
): RoutineDaemonClientHandlers {
  return {
${routineAssignments}
  };
}
`;
}
