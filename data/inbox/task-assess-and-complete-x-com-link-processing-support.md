# Assess and complete x.com link processing support

Owner note: long ago some x.com / ex-Twitter links were added for processing,
but it is unclear whether they were actually read and dispositioned.

Check the existing related work before normalizing:

- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-review-inaccessible-research-resources-when-access`
- Browser module `x_post_read` / authenticated-profile behavior

Desired outcome:

- Confirm whether KOTA can reliably process `https://x.com/<user>/status/<id>`
  links from inbox/tasks/watchlist/resource batches.
- If support is incomplete, create or update the normalized task that makes the
  mechanism complete: authenticated access, clear blocked state when auth is
  missing, retry/disposition flow, and evidence capture.
- Do not silently mark X links as processed from URL shape or surrounding
  summaries; each post needs actual readable source evidence or an explicit
  inaccessible/auth-walled disposition.

