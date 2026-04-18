# Schema

This directory contains published JSON Schema files for KOTA data structures.

- Schemas are generated from source-owned types and module-owned schema
  fragments. Do not hand-edit generated files.

## Adding a schema

- Use JSON Schema Draft-7 (`"$schema": "http://json-schema.org/draft-07/schema#"`).
- Name the file after the structure it validates.
- If the schema is referenced from CLI or runtime code, keep the path stable.
- Update local `AGENTS.md` guidance only when the generation or ownership model changes.
