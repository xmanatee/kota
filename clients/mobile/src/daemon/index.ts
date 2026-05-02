// Per-namespace daemon contract types and parsers. Each namespace mirrors
// one daemon capability surface (knowledge search, recall, capture, …).
// See `clients/mobile/AGENTS.md` for the split shape; the path-flat
// `types` barrel re-exports this module so existing import sites keep
// working unchanged.

export * from './core';
export * from './approvals';
export * from './ownerQuestions';
export * from './tasks';
export * from './sse';
export * from './sessions';
export * from './voice';
export * from './digest';
export * from './attention';
export * from './knowledge';
export * from './memory';
export * from './history';
export * from './repoTasks';
export * from './recall';
export * from './answer';
export * from './capture';
export * from './retract';
export * from './push';
