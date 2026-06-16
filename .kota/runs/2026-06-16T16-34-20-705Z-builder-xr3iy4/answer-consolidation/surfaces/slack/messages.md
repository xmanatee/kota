# Slack Answer Message Fixture

Source: `src/modules/slack-channel/commands.ts`.

Slack uses the same plain answer render helpers as Telegram for the answer body,
answer log rows, and answer show body.

## `/answer How does answer history work?`

```text
KOTA chains cited answers from knowledge [knowledge:kota-answer] and prior answer envelopes [answer:answer-prev].

Citations
knowledge  0.993  kota-answer  Answer surface contract
answer     0.884  answer-prev  [ok(1)] How does answer history work?
```

## `/answer no match`

```text
No matching sources across the second brain — nothing to synthesize.
```

## `/answer unavailable`

```text
Cross-store recall has no registered contributors.
```

## `/answer synthesis failure`

```text
Synthesis failed (model unreachable or unable to cite resolvable sources).
```

## `/answer`

```text
Usage: /answer <query>
```

## `/answer-log 2`

```text
2026-06-16T16:00:00Z  ok(2)                 answer-rec-1  How does answer history work?
2026-06-16T15:59:00Z  no_hits               answer-rec-2  What if nothing matches?
```

## `/answer-log` with empty store

```text
No past answer records yet.
```

## `/answer-log abc`

```text
Usage: /answer-log [N]
```

## `/answer-show answer-rec-1`

```text
KOTA chains cited answers from knowledge [knowledge:kota-answer] and prior answer envelopes [answer:answer-prev].

Citations
knowledge  0.993  kota-answer  Answer surface contract
answer     0.884  answer-prev  [ok(1)] How does answer history work?
```

## `/answer-show missing`

```text
No answer record found for id "missing".
```

## `/answer-show`

```text
Usage: /answer-show <id>
```
