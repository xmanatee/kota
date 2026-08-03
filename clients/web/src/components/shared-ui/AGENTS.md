# Shared UI Renderer

This directory owns the React presentation of the daemon-generated
`ui.surface.v1` graph.

- Keep rendering exhaustive over generated unions; unknown protocol arms must
  fail at the decoder rather than fall through in React.
- The graph owns navigation, availability, forms, confirmations, effects, and
  action semantics. Components here own browser layout, accessibility, and
  responsive behavior only.
- Execute actions through `/ui/actions/execute` and refresh the shared bundle;
  do not call capability-specific routes from view code.
- Keep specialized presentation keyed to typed node kinds, never surface ids
  or module names.
