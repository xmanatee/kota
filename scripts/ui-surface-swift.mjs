import {
  lowerCamel,
  singular,
  swiftCaseReference,
  swiftIdentifier,
  upperCamel,
} from "./ui-surface-swift-names.mjs";

function allowedStrings(schema) {
  if (typeof schema.const === "string") return [schema.const];
  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === "string")) {
    return schema.enum;
  }
  if (Array.isArray(schema.anyOf)) {
    const values = schema.anyOf.map(allowedStrings);
    if (values.every((value) => value !== undefined)) return values.flat();
  }
  return undefined;
}

function rawClause(identifier, value) {
  return identifier === value ? "" : ` = ${JSON.stringify(value)}`;
}

class SwiftGenerator {
  constructor(schema) {
    this.definitions = schema.definitions ?? {};
    this.inline = new Map();
    this.emittedInline = new Set();
  }

  resolve(schema) {
    if (schema.$ref === undefined) return schema;
    const name = schema.$ref.replace("#/definitions/", "");
    const resolved = this.definitions[name];
    if (resolved === undefined) throw new Error(`Unresolved Swift schema reference: ${schema.$ref}`);
    return this.resolve(resolved);
  }

  registerInline(name, schema) {
    if (this.definitions[name] === undefined && this.inline.get(name) === undefined) {
      this.inline.set(name, schema);
    }
    return name;
  }

  allowedStrings(schema) {
    const resolved = this.resolve(schema);
    const direct = allowedStrings(resolved);
    if (direct !== undefined) return direct;
    if (!Array.isArray(resolved.anyOf)) return undefined;
    const values = resolved.anyOf.map((candidate) => this.allowedStrings(candidate));
    return values.every((value) => value !== undefined) ? values.flat() : undefined;
  }

  nullableMember(schema) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length !== 2) return undefined;
    const members = schema.anyOf.map((candidate) => this.resolve(candidate));
    const nullIndex = members.findIndex((candidate) => candidate.type === "null");
    return nullIndex === -1 ? undefined : schema.anyOf[nullIndex === 0 ? 1 : 0];
  }

  type(schema, hint) {
    if (schema.$ref !== undefined) return schema.$ref.replace("#/definitions/", "");
    const values = this.allowedStrings(schema);
    if (values !== undefined) {
      this.registerInline(hint, schema);
      return hint;
    }
    if (schema.anyOf !== undefined) {
      const nullable = this.nullableMember(schema);
      if (nullable !== undefined) return `${this.type(nullable, hint)}?`;
      this.registerInline(hint, schema);
      return hint;
    }
    if (Array.isArray(schema.type)) {
      const withoutNull = schema.type.filter((type) => type !== "null");
      if (withoutNull.length === 1 && withoutNull.length !== schema.type.length) {
        return `${this.type({ ...schema, type: withoutNull[0] }, hint)}?`;
      }
      this.registerInline(hint, schema);
      return hint;
    }
    switch (schema.type) {
      case "string": return "String";
      case "number": return "Double";
      case "integer": return "Int";
      case "boolean": return "Bool";
      case "array": return `[${this.type(schema.items, `${hint}${upperCamel(singular(hint))}`)}]`;
      case "object": {
        if (typeof schema.additionalProperties === "object") {
          return `[String: ${this.type(schema.additionalProperties, `${hint}Value`)}]`;
        }
        this.registerInline(hint, schema);
        return hint;
      }
      default: throw new Error(`Unsupported Swift schema at ${hint}: ${JSON.stringify(schema)}`);
    }
  }

  propertyType(schema, parent, property) {
    const resolved = this.resolve(schema);
    const itemHint = `${parent}${upperCamel(singular(property))}`;
    if (resolved.type === "array") {
      return `[${this.type(resolved.items, itemHint)}]`;
    }
    return this.type(schema, `${parent}${upperCamel(property)}`);
  }

  emitRawEnum(name, schema) {
    const values = this.allowedStrings(schema);
    if (values === undefined) throw new Error(`${name} is not a string enum`);
    const cases = values.map((value) => {
      const identifier = lowerCamel(value);
      return `    case ${swiftIdentifier(value)}${rawClause(identifier, value)}`;
    });
    return [`enum ${name}: String, Codable, Equatable, CaseIterable {`, ...cases, "}"].join("\n");
  }

  emitStruct(name, schema) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(properties).map(([property, child]) => {
      const propertyType = this.propertyType(child, name, property);
      const optional = required.has(property) || propertyType.endsWith("?") ? "" : "?";
      return `    let ${swiftIdentifier(property)}: ${propertyType}${optional}`;
    });
    const identifiable = required.has("id") && properties.id !== undefined ? ", Identifiable" : "";
    return [`struct ${name}: Codable, Equatable${identifiable} {`, ...fields, "}"].join("\n");
  }

  constants(schema) {
    return Object.entries(schema.properties ?? {}).flatMap(([property, raw]) => {
      const resolved = this.resolve(raw);
      return resolved.const === undefined ? [] : [{ property, value: resolved.const }];
    });
  }

  variantName(schema, index) {
    const constants = this.constants(schema);
    const stringValue = constants.find((entry) => typeof entry.value === "string");
    if (stringValue !== undefined) return swiftIdentifier(stringValue.value);
    const booleanValue = constants.find((entry) => typeof entry.value === "boolean");
    if (booleanValue?.property === "ok") return booleanValue.value ? "success" : "failure";
    if (booleanValue?.property === "available") return booleanValue.value ? "available" : "unavailable";
    return `variant${index + 1}`;
  }

  refinedVariantName(schema, baseName) {
    const constants = this.constants(schema);
    const stringValue = constants.find((entry) =>
      typeof entry.value === "string" && swiftIdentifier(entry.value) !== baseName
    );
    if (stringValue !== undefined) {
      return `${baseName}${upperCamel(stringValue.value)}`;
    }
    const booleanValue = constants.find((entry) => typeof entry.value === "boolean");
    if (booleanValue?.property === "ok") {
      return `${baseName}${booleanValue.value ? "Success" : "Failure"}`;
    }
    if (booleanValue?.property === "available") {
      return `${baseName}${booleanValue.value ? "Available" : "Unavailable"}`;
    }
    return baseName;
  }

  unionFields(name, schema, caseName) {
    const required = new Set(schema.required ?? []);
    const constantProperties = new Set(this.constants(schema).map(({ property }) => property));
    return Object.entries(schema.properties ?? {})
      .filter(([property]) => !constantProperties.has(property))
      .map(([property, schema]) => ({
        property,
        label: lowerCamel(property),
        binding: swiftIdentifier(property),
        type: this.propertyType(schema, `${name}${upperCamel(caseName)}`, property),
        optional: !required.has(property),
      }));
  }

  expandUnionVariants(schema) {
    return schema.anyOf.flatMap((candidate) => {
      const resolved = this.resolve(candidate);
      if (this.constants(resolved).length > 0) return [resolved];
      const enumProperty = Object.entries(resolved.properties ?? {}).find(([, raw]) => {
        const child = this.resolve(raw);
        return Array.isArray(child.enum) && child.enum.every((value) => typeof value === "string");
      });
      if (enumProperty === undefined) return [resolved];
      const [property, raw] = enumProperty;
      const values = this.resolve(raw).enum;
      return values.map((value) => ({
        ...resolved,
        properties: {
          ...resolved.properties,
          [property]: { const: value, type: "string" },
        },
      }));
    });
  }

  emitUnion(name, schema) {
    const resolvedVariants = this.expandUnionVariants(schema);
    const baseNames = resolvedVariants.map((resolved, index) =>
      this.variantName(resolved, index)
    );
    const variants = resolvedVariants.map((resolved, index) => {
      const baseName = baseNames[index];
      const caseName = baseNames.filter((value) => value === baseName).length > 1
        ? this.refinedVariantName(resolved, baseName)
        : baseName;
      return {
        schema: resolved,
        caseName,
        constants: this.constants(resolved),
        fields: this.unionFields(name, resolved, caseName),
      };
    });
    const duplicateCases = variants.map((variant) => variant.caseName)
      .filter((value, index, all) => all.indexOf(value) !== index);
    if (duplicateCases.length > 0) {
      throw new Error(`Swift union ${name} has duplicate generated cases: ${duplicateCases.join(", ")}`);
    }
    const allProperties = [...new Set(variants.flatMap((variant) =>
      Object.keys(variant.schema.properties ?? {}),
    ))].sort();

    const caseLines = variants.map((variant) => {
      const values = variant.fields.map((field) => `${field.label}: ${field.type}${field.optional ? "?" : ""}`);
      return `    case ${variant.caseName}${values.length === 0 ? "" : `(${values.join(", ")})`}`;
    });
    const codingKeys = allProperties.map((property) => `        case ${swiftIdentifier(property)}`);
    const decodeCases = variants.flatMap((variant) => {
      const values = variant.fields.map((field) => {
        const method = field.optional ? "decodeIfPresent" : "decode";
        return `${field.label}: try container.${method}(${field.type}.self, forKey: ${swiftCaseReference(field.property)})`;
      });
      const assignment = values.length === 0
        ? `self = .${variant.caseName}`
        : `self = .${variant.caseName}(\n                ${values.join(",\n                ")}\n            )`;
      const checks = variant.constants.map(({ property, value }) => {
        const swiftType = typeof value === "boolean" ? "Bool" : typeof value === "number" ? "Double" : "String";
        const swiftValue = typeof value === "string" ? JSON.stringify(value) : String(value);
        return `(try? container.decode(${swiftType}.self, forKey: ${swiftCaseReference(property)})) == ${swiftValue}`;
      });
      for (const field of variant.fields) {
        const propertySchema = variant.schema.properties?.[field.property];
        if (field.optional || propertySchema === undefined || this.allowedStrings(propertySchema) === undefined) continue;
        checks.push(`(try? container.decode(${field.type}.self, forKey: ${swiftCaseReference(field.property)})) != nil`);
      }
      if (checks.length === 0) throw new Error(`Swift union ${name}.${variant.caseName} has no literal discriminator`);
      return [
        `        if ${checks.join(" && ")} {`,
        `            ${assignment}`,
        "            return",
        "        }",
      ];
    });
    const encodeCases = variants.flatMap((variant) => {
      const bindings = variant.fields.map((field) => field.binding);
      const pattern = bindings.length === 0
        ? `case .${variant.caseName}:`
        : `case .${variant.caseName}(${bindings.map((binding) => `let ${binding}`).join(", ")}):`;
      const writes = variant.fields.map((field) => {
        const method = field.optional ? "encodeIfPresent" : "encode";
        return `            try container.${method}(${field.binding}, forKey: ${swiftCaseReference(field.property)})`;
      });
      const constants = variant.constants.map(({ property, value }) =>
        `            try container.encode(${typeof value === "string" ? JSON.stringify(value) : String(value)}, forKey: ${swiftCaseReference(property)})`
      );
      return [
        `        ${pattern}`,
        ...constants,
        ...writes,
      ];
    });

    return [
      `indirect enum ${name}: Codable, Equatable {`,
      ...caseLines,
      "",
      "    private enum CodingKeys: String, CodingKey {",
      ...codingKeys,
      "    }",
      "",
      "    init(from decoder: Decoder) throws {",
      "        let container = try decoder.container(keyedBy: CodingKeys.self)",
      ...decodeCases,
      "        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: \"Unknown generated union variant\"))",
      "    }",
      "",
      "    func encode(to encoder: Encoder) throws {",
      "        var container = encoder.container(keyedBy: CodingKeys.self)",
      "        switch self {",
      ...encodeCases,
      "        }",
      "    }",
      "}",
    ].join("\n");
  }

  emitDefinition(name, rawSchema) {
    const schema = this.resolve(rawSchema);
    if (this.allowedStrings(schema) !== undefined) return this.emitRawEnum(name, schema);
    if (schema.anyOf !== undefined) {
      const nullable = this.nullableMember(schema);
      if (nullable !== undefined) return `typealias ${name} = ${this.type(nullable, name)}?`;
      return this.emitUnion(name, schema);
    }
    if (Array.isArray(schema.type)) return this.emitScalarUnion(name, schema.type);
    if (schema.type === "object") return this.emitStruct(name, schema);
    if (["string", "number", "integer", "boolean"].includes(schema.type)) {
      return `typealias ${name} = ${this.type(schema, name)}`;
    }
    throw new Error(`Unsupported Swift definition ${name}`);
  }

  emitScalarUnion(name, types) {
    const supported = new Set(["string", "number", "integer", "boolean", "null"]);
    if (!types.every((type) => supported.has(type))) {
      throw new Error(`Unsupported Swift scalar union ${name}: ${types.join(",")}`);
    }
    const unique = [...new Set(types.map((type) => type === "integer" ? "number" : type))];
    const cases = unique.map((type) => {
      if (type === "string") return "    case string(String)";
      if (type === "number") return "    case number(Double)";
      if (type === "boolean") return "    case bool(Bool)";
      return "    case null";
    });
    const decodes = unique.map((type) => {
      if (type === "null") return "        if container.decodeNil() { self = .null; return }";
      const swiftType = type === "string" ? "String" : type === "number" ? "Double" : "Bool";
      const caseName = type === "boolean" ? "bool" : type;
      return `        if let value = try? container.decode(${swiftType}.self) { self = .${caseName}(value); return }`;
    });
    const encodes = unique.map((type) => {
      if (type === "null") return "        case .null: try container.encodeNil()";
      const caseName = type === "boolean" ? "bool" : type;
      return `        case .${caseName}(let value): try container.encode(value)`;
    });
    return [
      `enum ${name}: Codable, Equatable {`,
      ...cases,
      "",
      "    init(from decoder: Decoder) throws {",
      "        let container = try decoder.singleValueContainer()",
      ...decodes,
      "        throw DecodingError.dataCorruptedError(in: container, debugDescription: \"Unknown generated scalar value\")",
      "    }",
      "",
      "    func encode(to encoder: Encoder) throws {",
      "        var container = encoder.singleValueContainer()",
      "        switch self {",
      ...encodes,
      "        }",
      "    }",
      "}",
    ].join("\n");
  }

  generate() {
    const chunks = [];
    for (const [name, schema] of Object.entries(this.definitions)) {
      chunks.push(this.emitDefinition(name, schema));
    }
    while (true) {
      const next = [...this.inline.entries()].find(([name]) => !this.emittedInline.has(name));
      if (next === undefined) break;
      this.emittedInline.add(next[0]);
      chunks.push(this.emitDefinition(next[0], next[1]));
    }
    return chunks.join("\n\n");
  }
}

export function generateSwiftBinding(schema, options = {}) {
  const body = new SwiftGenerator(schema).generate();
  const command = options.command ?? "pnpm build:ui-bindings";
  const source = options.source ?? "src/core/daemon/ui-surface.ts";
  return [
    `// Generated by \`${command}\` from ${source}.`,
    "// Do not edit this file directly.",
    "",
    "import Foundation",
    "",
    body,
    ...(options.aliases ?? []),
    "",
  ].join("\n");
}
