Also i'm thinking we should introduce smth like checker agent or step... basically from what i can see often tasks are
  picked up by builder and then marked as finished while they aren't... I want there to be some llm call to "critic"
  agent which would look at what has been done by an agent step of workflow and return back to it if the it didn't do a
  good job... it should basically critically assess what was asked from the agent and what has been done and whether the
  result is complete and honest and unbiased...
 
  Basically how i see things working is :
  - builder/improver/inbox-sorter pick up work
  - they do the work and mark stuff as completed
  - the tests and other validations run - if anything fails we return the execution of the builder/improver/inbox-sorter
  agent so that they clean up after themselves
  - when tests and validations pass a critic agent is provided with inputs and results of the work of the agent... it
  should do an unbiased review and assessment of the work and flag issues if there are any. If it finds any critical
  issues the execution should similarly be returned to the builder/improver/inbox-sorter agent so that they clean up
  after themselves... maybe critic should also highlight warnings (non-critical) issues so that we could notify agent of
  them, but agent should be able to terminate without fixing them..
 
  Does the current workflow system support returning to agent execution if smth like that fails?
 
  It's very important that critic is unbiased and objective and doesn't pick in minor issues, but at the same time it
  MUST catch critical issues like breakages, inconsistencies, unfinished changes/migrations/tasks e.t.c. You need to
  research how it is achieved in existing systems and adopt that nicely...