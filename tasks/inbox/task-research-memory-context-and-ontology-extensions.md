# Research: Memory, Context, And Ontology Extensions

Explorer should compare file-backed, graph-backed, and plugin-backed memory/context systems and decide which patterns KOTA should support through extensions or adapters.

Focus:
- integrable memory systems, not paid hosted lock-in
- clean adapter boundaries for memory/context stores
- ontology and graph layers that can coexist with KOTA's current model

Questions:
- Which memory/context systems are realistic adapter targets for KOTA?
- What should KOTA expose as a storage/memory protocol?
- Where should ontology, episodic memory, and context indexing live?

Resources:
- https://github.com/volcengine/OpenViking — open-source context database for agents, centered on memory/resources/skills.
- https://github.com/1st1/lat.md — markdown knowledge graph for codebases.
- https://clawhub.ai/plugins/episodic-claw — episodic memory style plugin listing.
- https://clawhub.ai/plugins/memrok — memory-oriented plugin listing.
- https://clawhub.ai/plugins/openclaw-cortex-memory — cortex memory plugin listing.
- https://clawhub.ai/oswalpalash/ontology — file-backed ontology skill with local graph storage.

Desired outcome:
- recommendations for KOTA memory/ontology adapter surfaces and extension boundaries
- follow-up tasks only for patterns that fit KOTA's extension-first architecture
