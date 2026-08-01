# Thin-Client Contract Conformance

Pinned canonical artifacts for the cross-client conformance gate.

The mechanism is a single shared fixture corpus plus a shared decoder catalog
and case table. Handwritten route decoders remain here, while the UI surface
schema and bindings are generated from the daemon-owned `UiSurfaceBundle`
contract. Every thin-client decoder suite consumes the same fixture through
equivalent typed decoders. Negative fixtures exercise unknown discriminators
so strict decoding stays intentional rather than accidentally lax.

## Boundary

- The fixture is a frozen contract, not a wishlist — only add a
  top-level key once a corresponding daemon route or field exists.
- Negative cases are the contract's lower bound; they make strict
  decoding load-bearing and must reject on unknown discriminators.
- Web and core import the canonical TypeScript catalog directly. The mobile
  workspace cannot resolve helpers outside its tree (expo babel transform),
  so the generator emits its TypeScript UI binding inside the mobile tree and
  the cross-client integration test enforces byte identity. Other decoder
  copies remain in the production tree so the same strict parsers back both
  conformance and mobile runtime paths.
- The macOS suite consumes a `Bundle.module` resource copy declared in
  the Swift package manifest; the same cross-client guard asserts the
  copy parses to the same JSON tree as the canonical file.
- `recall-render-fixture.json` is the golden cross-surface render contract for
  recall hits: per-source description text, normalized score precision, the
  module-owned plain-text layout, empty results, and the
  `semantic_unavailable` envelope. Web imports it directly; mobile and Apple
  consume embedded copies that the cross-client guard compares to this file.

## Adding a new surface

1. Add a positive arm and at least one negative arm
   (`negative_unknownReason` / `negative_unknownSource` /
   `negative_unknownTarget`) to the canonical fixture.
2. For `ui.surface.v1`, change only the daemon-owned TypeScript contract and
   run `pnpm build:ui-bindings`; for other surfaces, update the owned typed
   decoders and shared case table.
3. Add positive and negative Swift `XCTestCase` coverage for the generated
   Codable binding.
4. Refresh the embedded mobile and macOS fixture copies in the same change.
5. Run the generated-binding check, cross-client guard, four conformance
   suites, and Apple test target.
