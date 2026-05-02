// Path-flat barrel re-exporting every daemon contract type the mobile
// client depends on. The actual definitions live under `./daemon/<namespace>`,
// split per capability namespace (knowledge, recall, capture, …).
// See `clients/mobile/AGENTS.md` for the split shape.

export * from './daemon';
