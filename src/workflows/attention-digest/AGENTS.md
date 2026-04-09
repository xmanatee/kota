# Attention Digest Workflow

This directory contains the attention digest workflow definition and test.

- The workflow triggers on `workflow.completed` events from workflows tagged as attention sources.
- The filter is required: without it the workflow would re-trigger on its own completion and create an infinite loop.
- The runtime validates this: any `workflow.completed` trigger that can match its own completion payload is a hard validation error.
