# Thin-Client Contract Conformance

Pinned canonical artifacts for the cross-client conformance gate.

The mechanism is a single shared fixture corpus plus a shared decoder catalog
and case table. Every thin-client decoder suite consumes the same fixture
through equivalent typed decoders. Negative fixtures exercise the "unknown
reason / source / target" rejection paths so strict decoding stays intentional
rather than accidentally lax.

## Boundary

- The fixture is a frozen contract, not a wishlist — only add a
  top-level key once a corresponding daemon route or field exists.
- Negative cases are the contract's lower bound; they make strict
  decoding load-bearing and must reject on unknown discriminators.
- Web and core import the canonical TypeScript catalog directly. The
  mobile workspace cannot resolve helpers outside its tree (expo babel
  transform), so byte-identical copies live under
  `clients/mobile/src/daemon/conformance/` and a cross-client integration
  test enforces byte-identity. The mobile copies sit in the production
  tree (not under `__tests__/`) so the same strict-decode parsers back
  both the conformance fixture suite and the mobile production runtime
  paths (`clients/mobile/src/daemon/digest.ts`, `attention.ts`, …).
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
2. Add a typed TypeScript decoder that mirrors the daemon's wire shape
   and throws on unknown discriminators, then register it in the shared
   case table.
3. Mirror a Swift Codable decoder under the macOS sources and add a
   positive + negative `XCTestCase` method.
4. Refresh the embedded mobile and macOS copies of the canonical
   artifacts in the same change.
5. Run the cross-client guard, the four conformance suites, and the
   macOS test target. Every suite must stay green.
