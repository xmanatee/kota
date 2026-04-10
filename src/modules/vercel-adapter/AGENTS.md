# Vercel Adapter Module

This directory owns the `vercel-adapter` repo module — Vercel AI SDK Data Stream Protocol integration.

- Contributes `POST /api/chat/vercel` route for stateless Vercel `useChat` clients.
- Each request creates a fresh `AgentSession` — aligns with the full-message-array pattern of `useChat`.

