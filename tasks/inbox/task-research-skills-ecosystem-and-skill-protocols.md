# Research: Skills Ecosystem And Skill Protocols

Explorer should study how mature skill ecosystems package instructions, scope context, declare dependencies, and validate quality. The goal is not to copy them blindly, but to see what KOTA might support directly, what could be adapter-compatible, what just needs compatibility checks, and what should remain inspiration.

Focus:
- keep KOTA extension and skill surfaces OSS-friendly and adapter-first
- prefer protocol compatibility over one-off implementations
- avoid paid-only dependencies or hosted lock-in

Things to look at:
- What is the smallest useful KOTA skill protocol?
- How should install requirements, runtime requirements, and safety hints be represented?
- Which ideas seem worth carrying into KOTA, and which should just be observed?

Resources:
- https://ui.shadcn.com/docs/skills — shadcn/ui docs for project-specific skills and instruction packs.
- https://skills.sh/anthropics — anthropics skills catalog; useful as a broad reference set.
- https://skills.sh/anthropics/claude-plugins-official/claude-md-improver — skill for improving `CLAUDE.md`; relevant to agent self-steering and instruction hygiene.
- https://skills.sh/anthropics/skills/pdf — concrete PDF processing skill; useful as a representative capability skill.
- https://skills.sh/remotion-dev/skills/remotion-best-practices — domain-specific skill for media/video workflows; useful as a packaging example.
- https://skills.sh/rivet-dev/skills/sandbox-agent — sandbox-oriented skill; relevant to safe execution patterns.
- https://clawhub.ai/spclaudehome/skill-vetter — ClawHub skill vetting skill; relevant to lightweight validation and trust rails.

What Explorer should produce later:
- a clearer picture of what is useful here for KOTA
- follow-up tasks only where there is a real compatibility, adapter, or architecture opportunity
