review all the existing workflows and workflows and hooks and triggers...
are all the guidelines and conventions followed?
are all the conventions and guidelines and documentations correct?
Make sure there are no
- left-overs
- duplications
- redundancies
- legacy
Also make sure everything is
- complete
- concise
- clean
- clear
- consistent

are all the agents performing well scoped tasks? isn't there too much guard-railing?

actions should be hardcoded only if there's no way to do smth differently ... only if we can be 100% confident about the next step...
most guardrails should run some simple state (whatever it means in whatever context) check and return control to agent until state check succeeds...