(this inbox item duplicates already processed inbox entry)

currently docs/ directory contains some large documents with stuff... it feels wrong...
e.g. 
- info from docs/DEAMON-CLIENTS.md must be in clients/AGENTS.md
- info from docs/GRAFANA.md must be in the dedicated module which declares/sets up these metrics stuff
- info from docs/MOBILE-CLIENT-DESIGN.md belongs to clients/mobile/AGENTS.md
- ...


And generally in the app there shouldn't be so much documentation... only non-trivial stuff or methodologies or high-level overviews or conventions or guidelines can be documented.

hard rule: nothing that can be understood in 1-2 simple bash commands should be documented! So no directory structures, no extracts from files and nothing similar to that!


generally i don't think there's need in docs/ at all and the info should live in where it belongs and where it's relevant... but it shouldn't be over-documented! 

Make sure to update relevant prompts and guidelines and verifications and docs... NO BLOAT!

the global aim must be clean/concise/complete/intuitive/maintainable architechture and structure and ux.