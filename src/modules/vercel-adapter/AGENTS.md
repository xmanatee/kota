# Vercel Adapter Module

This directory owns the `vercel-adapter` repo module — Vercel AI SDK Data Stream Protocol integration.

- Contributes a stateless chat route for Vercel `useChat` clients.
- Each request creates a fresh `AgentSession` — aligns with the full-message-array pattern of `useChat`.
- `data-stream.ts` owns the Data Stream Protocol v1 transport and wire format helpers.
