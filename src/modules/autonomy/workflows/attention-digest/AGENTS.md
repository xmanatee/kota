# Attention Digest Workflow

This directory contains the attention digest workflow definition and test.

- The workflow reacts to a small set of explicit attention-worthy events plus failed/interrupted queue workflows.
- Any `workflow.completed` trigger here must stay filtered so it cannot match the digest workflow's own completion.
- The runtime validates this: any `workflow.completed` trigger that can match its own completion payload is a hard validation error.
