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

  type(schema, hint) {
    if (schema.$ref !== undefined) return schema.$ref.replace("#/definitions/", "");
    const values = allowedStrings(schema);
    if (values !== undefined) {
      this.registerInline(hint, schema);
      return hint;
    }
    if (schema.anyOf !== undefined) {
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
    const values = allowedStrings(schema);
    if (values === undefined) throw new Error(`${name} is not a string enum`);
    const cases = values.map((value) => {
      const identifier = lowerCamel(value);
      return `    case ${swiftIdentifier(value)}${rawClause(identifier, value)}`;
    });
    return [`enum ${name}: String, Codable, Equatable {`, ...cases, "}"].join("\n");
  }

  emitStruct(name, schema) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(properties).map(([property, child]) => {
      const optional = required.has(property) ? "" : "?";
      return `    let ${swiftIdentifier(property)}: ${this.propertyType(child, name, property)}${optional}`;
    });
    return [`struct ${name}: Codable, Equatable {`, ...fields, "}"].join("\n");
  }

  discriminator(schema) {
    const candidates = schema.anyOf.map((candidate) => this.resolve(candidate));
    const first = candidates[0]?.properties ?? {};
    const property = Object.keys(first).find((key) =>
      candidates.every((candidate) => allowedStrings(this.resolve(candidate.properties?.[key] ?? {})) !== undefined)
    );
    if (property === undefined) throw new Error("Swift unions require a string discriminator");
    const variants = candidates.flatMap((candidate) =>
      allowedStrings(this.resolve(candidate.properties[property])).map((value) => ({ value, schema: candidate }))
    );
    return { property, variants };
  }

  unionFields(name, variant) {
    const required = new Set(variant.schema.required ?? []);
    return Object.entries(variant.schema.properties ?? {})
      .filter(([property]) => property !== variant.discriminator)
      .map(([property, schema]) => ({
        property,
        label: lowerCamel(property),
        binding: swiftIdentifier(property),
        type: this.propertyType(schema, `${name}${upperCamel(variant.value)}`, property),
        optional: !required.has(property),
      }));
  }

  emitUnion(name, schema) {
    const { property: discriminator, variants: rawVariants } = this.discriminator(schema);
    const variants = rawVariants.map((variant) => ({
      ...variant,
      discriminator,
      caseName: swiftIdentifier(variant.value),
      fields: this.unionFields(name, { ...variant, discriminator }),
    }));
    const allProperties = [...new Set(variants.flatMap((variant) =>
      Object.keys(variant.schema.properties ?? {}),
    ))].sort();

    const caseLines = variants.map((variant) => {
      const values = variant.fields.map((field) => `${field.label}: ${field.type}${field.optional ? "?" : ""}`);
      return `    case ${variant.caseName}${values.length === 0 ? "" : `(${values.join(", ")})`}`;
    });
    const discriminatorCases = variants.map((variant) => {
      const identifier = lowerCamel(variant.value);
      return `        case ${variant.caseName}${rawClause(identifier, variant.value)}`;
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
      return [`        case .${variant.caseName}:`, `            ${assignment}`];
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
      return [
        `        ${pattern}`,
        `            try container.encode(Discriminator.${variant.caseName}, forKey: ${swiftCaseReference(discriminator)})`,
        ...writes,
      ];
    });

    return [
      `indirect enum ${name}: Codable, Equatable {`,
      ...caseLines,
      "",
      "    private enum Discriminator: String, Codable {",
      ...discriminatorCases,
      "    }",
      "",
      "    private enum CodingKeys: String, CodingKey {",
      ...codingKeys,
      "    }",
      "",
      "    init(from decoder: Decoder) throws {",
      "        let container = try decoder.container(keyedBy: CodingKeys.self)",
      `        switch try container.decode(Discriminator.self, forKey: ${swiftCaseReference(discriminator)}) {`,
      ...decodeCases,
      "        }",
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
    if (allowedStrings(schema) !== undefined) return this.emitRawEnum(name, schema);
    if (schema.anyOf !== undefined) return this.emitUnion(name, schema);
    if (schema.type === "object") return this.emitStruct(name, schema);
    throw new Error(`Unsupported Swift definition ${name}`);
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

export function generateSwiftBinding(schema) {
  const body = new SwiftGenerator(schema).generate();
  return [
    "// Generated by `pnpm build:ui-bindings` from src/core/daemon/ui-surface.ts.",
    "// Do not edit this file directly.",
    "",
    "import Foundation",
    "",
    body,
    "",
  ].join("\n");
}
