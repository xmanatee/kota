---
status: open
priority: p2
---
# Prevent historical module failures from reopening recovered autonomy issues

## Problem



## Desired Outcome

Operators see current module incidents and genuine recurrence without repeated investigations caused solely by rescanning previously observed failures. Reconcile scheduled module-log evidence with the canonical operation-health and issue lifecycle, preserving stable evidence identity and occurrence chronology. Retain unresolved failures and historical provenance without allowing recovered polling episodes or unchanged backfill to masquerade as new incidents. Preserve distinctions between polling and message delivery; polling success must not clear an unrelated send failure.

## Constraints

- Preserve the stable issue identity and cited provenance.
- Implement through builder; this proposal is not evidence that the issue is fixed.

## How We Will Know

Replay the exported Telegram failure/recovery chronology through the production audit and issue projection owners. After recovery, repeated audits and restart/replay of unchanged records must not reopen recovered episodes or request another investigation. A genuinely later failure must reopen the same lineage, while a previously missed unresolved failure remains discoverable. Verify that polling recovery does not imply message-delivery recovery. Retain a scoped operator-visible issue timeline showing these outcomes and use focused owner/integration verification.

## Context

Issue reviewer disposition:     Issue autonomy-issue-a0a5540ecf3ae944cbab has no linked owner. The scoped issue-evidence.json shows September 14 polling recovery at 14:33:29 after failure at 14:32:39; history records a clear at 15:33:29, followed by revision 14 reopening at 18:11:37. That reopening cites September 7–11 records, including hashes 4d52af3b… and b0d47ceb… for September 11 polling failures. runtime-health-audit-module-logs.ts aggregates historical failures without reconciling recovery, and runtime-health-audit-finalize.ts emits them as present at the new audit time. This supports an actionable reconciliation defect, rather than evidence of a new sustained Telegram outage. The archived task-report-retrying-channel-operations-through-shared-health implemented retry/recovery reporting; current bot.ts and channels.ts retain it. No active task or related inbox item covers reconciliation. Legacy line references are unavailable, and polling recovery does not establish successful message delivery.

Evidence:

- module-log: .kota/modules/telegram/logs.jsonl
- module-log: .kota/modules/telegram/logs.jsonl#L693
- module-log: .kota/modules/telegram/logs.jsonl#L694
- module-log: .kota/modules/telegram/logs.jsonl#L695
- module-log: .kota/modules/telegram/logs.jsonl#L696
- module-log: .kota/modules/telegram/logs.jsonl#L697
- module-log: .kota/modules/telegram/logs.jsonl#L698
- module-log: .kota/modules/telegram/logs.jsonl#L699
- module-log: .kota/modules/telegram/logs.jsonl#L700
- module-log: .kota/modules/telegram/logs.jsonl#L701
- module-log: .kota/modules/telegram/logs.jsonl#L702
- module-log: .kota/modules/telegram/logs.jsonl#L703
- module-log: .kota/modules/telegram/logs.jsonl#L704
- module-log: .kota/modules/telegram/logs.jsonl#L707
- module-log: .kota/modules/telegram/logs.jsonl#L708
- module-log: .kota/modules/telegram/logs.jsonl#L752
- module-log: .kota/modules/telegram/logs.jsonl#L753
- module-log: .kota/modules/telegram/logs.jsonl#L754
- module-log: .kota/modules/telegram/logs.jsonl#L755
- module-log: .kota/modules/telegram/logs.jsonl#L756
- module-log: .kota/modules/telegram/logs.jsonl#L757
- module-log: .kota/modules/telegram/logs.jsonl#L758
- module-log: .kota/modules/telegram/logs.jsonl#L759
- module-log: .kota/modules/telegram/logs.jsonl#L760
- module-log: .kota/modules/telegram/logs.jsonl#L764
- module-log: .kota/modules/telegram/logs.jsonl#L811
- module-log: .kota/modules/telegram/logs.jsonl#L845
- module-log: .kota/modules/telegram/logs.jsonl#L846
- module-log: .kota/modules/telegram/logs.jsonl#L847
- module-log: .kota/modules/telegram/logs.jsonl#L848
- module-log: .kota/modules/telegram/logs.jsonl#L849
- module-log: .kota/modules/telegram/logs.jsonl#L850
- module-log: .kota/modules/telegram/logs.jsonl#L856
- module-log: .kota/modules/telegram/logs.jsonl#L858
- module-log: .kota/modules/telegram/logs.jsonl#L863
- module-log: .kota/modules/telegram/logs.jsonl#L944
- module-log: .kota/modules/telegram/logs.jsonl#L945
- module-log: .kota/modules/telegram/logs.jsonl#L946
- module-log: .kota/modules/telegram/logs.jsonl#L947
- module-log: .kota/modules/telegram/logs.jsonl#L948
- module-log: .kota/modules/telegram/logs.jsonl#L949
- module-log: .kota/modules/telegram/logs.jsonl#L950
- module-log: .kota/modules/telegram/logs.jsonl#L951
- module-log: .kota/modules/telegram/logs.jsonl#L952
- module-log: .kota/modules/telegram/logs.jsonl#L953
- module-log: .kota/modules/telegram/logs.jsonl#L954
- module-log: .kota/modules/telegram/logs.jsonl#L955
- module-log: .kota/modules/telegram/logs.jsonl#sha256=03050ec6a43f5b84a6385b7da11dd286a2a2f2c42fbd6fda781109db456c75c1
- module-log: .kota/modules/telegram/logs.jsonl#sha256=3b8ecb887befa21728d43cb236db1caf7ba90b44bd896aca5b0f5c857976a45a
- module-log: .kota/modules/telegram/logs.jsonl#sha256=4d52af3be71de4425f5159131551a5ca4fe8b73ca785299008e890350bc68324
- module-log: .kota/modules/telegram/logs.jsonl#sha256=64a643675a5eb9c9ee48b9d7954e260df71f433042ba7a0deaea2573e2355a70
- module-log: .kota/modules/telegram/logs.jsonl#sha256=6c9c9f2bfc9f20df8b11ca18ec7f75c36def07a5f0a8c8484ac53f783e2afd19
- module-log: .kota/modules/telegram/logs.jsonl#sha256=6f1fc179c5d4ceb52442f02e20c8a449856835747a6fcef17e4a7b2e763baedd
- module-log: .kota/modules/telegram/logs.jsonl#sha256=7939fadbae262058987945f2bba402323dffa80e8b8958c732bad25e081d608f
- module-log: .kota/modules/telegram/logs.jsonl#sha256=aa38a4b087bdf9ca72b8c482cf635fc69169931eaf428c1b9e5382732e859e7c
- module-log: .kota/modules/telegram/logs.jsonl#sha256=ad6aeea10bd6c1f6c0009a992e2ce393df4ba0998811143b13fa4cd167fb2627
- module-log: .kota/modules/telegram/logs.jsonl#sha256=b0d47ceb3ad6e202426230295e2303b1639b2d7a38e02180d4973a681145a002
- module-log: .kota/modules/telegram/logs.jsonl#sha256=b2488660804bd6a3195476c5b16a71eeea3805383c6a28e2d294d439e1aef27b
- module-log: .kota/modules/telegram/logs.jsonl#sha256=c8e1ea2c3d22b667e44edf8feba37f1308e87f0e6323e2f08301f97daa7eef38
- module-log: .kota/modules/telegram/logs.jsonl#sha256=ce90acc66704bbe9d7688fdaea9224aecbb3a949b34a01388469e4a2ac61517f
- module-log: .kota/modules/telegram/logs.jsonl#sha256=f21a015dde7d1dbb5222331e3588a57e9dc89f5322e50566c814b85dad85ea43
