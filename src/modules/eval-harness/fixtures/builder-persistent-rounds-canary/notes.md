# Builder Persistent Rounds Canary

This fixture demonstrates persistent multi-round scoring without importing an
external benchmark. Round 1 asks the builder to implement deterministic ledger
summary behavior. Round 2 injects a new task into the same workspace and checks
that the summary behavior still passes while the export requirement is added.
