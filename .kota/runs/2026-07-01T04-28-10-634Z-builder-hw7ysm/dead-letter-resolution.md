# Builder DLQ Cleanup

## Before

`builder-dlq-before-dismissal.json` was exported from the canonical daemon
control route `/workflow/dead-letter?status=open&workflow=builder&limit=20`.
It recorded both cited items as open:

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6`
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28`

## Resolution

Both items were dismissed through the canonical daemon-control DLQ route.
Redrive was not used because the failed work was superseded:

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6` was replaced by successful
  builder run `2026-06-30T19-53-51-915Z-builder-ggdpuf`, which completed the
  claimed task and merged `8cef38bb177119e4ca81e219190324e0d052207e`.
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28` was the stale Git index-lock
  `commit-stageable` failure repaired and validated in
  `.kota/runs/2026-06-30T22-39-06-955Z-builder-ez3sip/dead-letter-resolution.md`.

## After

`builder-dlq-after-dismissal.json` records both items with
`status: "dismissed"` and dismissal timestamps:

- `dlq-754fe914-9936-4a2c-a35d-21d5cfdc57b6`: `2026-07-01T06:00:39.270Z`
- `dlq-547d6311-4c9c-491f-a834-b94587f1af28`: `2026-07-01T06:00:39.329Z`

The same canonical open-builder query now reports `counts.open: 0` and
`citedIdsStillOpen: []`.
