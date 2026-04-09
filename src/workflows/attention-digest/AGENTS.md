# Attention Digest Workflow

This directory contains the attention digest workflow definition and test.

- The workflow triggers on `workflow.completed` events filtered to `["inbox-sorter", "explorer", "builder", "improver"]`.
- The filter is required: without it the workflow would re-trigger on its own completion and create an infinite loop.
- The runtime validates this: any `workflow.completed` trigger without a `workflow` filter (or with a filter that includes the workflow's own name) is a hard validation error.
