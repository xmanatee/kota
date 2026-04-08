# Research: Tooling And Knowledge Adapter Extensions

Explorer should inspect concrete external-tool plugins and skills to identify high-value adapter opportunities for KOTA.

Focus:
- adapter wrappers around useful OSS tools
- extensionized access to external knowledge and productivity systems
- compare native implementation versus thin wrapper around existing tools

Questions:
- Which integrations are mature enough to wrap instead of rebuilding?
- What common adapter protocol would cover browser/search/docs/knowledge/productivity tools?
- Which of these should remain optional extensions rather than core features?

Resources:
- https://clawhub.ai/steipete/github — GitHub skill/plugin listing.
- https://clawhub.ai/steipete/gog — Google Workspace CLI wrapper for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.
- https://clawhub.ai/steipete/obsidian — Obsidian-oriented plugin/skill listing.
- https://clawhub.ai/steipete/nano-pdf — PDF-oriented plugin/skill listing.
- https://clawhub.ai/matrixy/agent-browser-clawdbot — browser skill/plugin listing.
- https://clawhub.ai/gpyangyoujun/multi-search-engine — multi-search-engine listing.

Desired outcome:
- recommendations for a shared adapter pattern for tool-facing extensions
- concrete follow-up tasks where KOTA can support wrappers instead of bespoke integrations
