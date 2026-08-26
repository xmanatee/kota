# Module Testing

Module behavior is owned by the production loader and host modes.

- Load modules through the production loader in the narrowest applicable mode,
  then call their public tool, route, command, event, or lifecycle surface.
- Fake only typed external ports. Do not duplicate module registration,
  dependency resolution, initialization, subscription, or teardown semantics in
  a test interpreter.
- `ModuleTestHarness` is legacy migration surface. Do not add capabilities or
  new consumers. Replace its scenarios with production-loader scenarios and
  delete migrated harness behavior.
- Pure schemas, parsers, and domain decisions may be tested directly when the
  test owns a distinct accepted, rejected, or transformed behavior.
