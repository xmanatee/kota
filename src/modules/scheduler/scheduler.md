Time-based and event-based scheduling.
Use supported time expressions ('in 30 minutes', 'tomorrow at 9am', 'at 3pm') or an ISO datetime.
Weekday qualifiers require an explicit date; they are rejected rather than guessed.
Recurring intervals must be at least one second and represent whole milliseconds.
Reminders cannot extend beyond JavaScript's finite date range.
Workflows can subscribe to scheduler events instead of embedding prompt actions in schedules.
Event triggers react to runtime.idle, workflow.completed, session.start, session.end, or custom events.
