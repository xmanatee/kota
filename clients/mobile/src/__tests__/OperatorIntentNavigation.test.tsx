import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { initialState } from '../context/state';
import { PRIMARY_OPERATOR_TABS } from '../navigation/operatorIntents';
import { ApprovalListScreen } from '../screens/ApprovalListScreen';
import { InboxHomeScreen } from '../screens/IntentHomeScreens';

const mockUseDaemon = jest.fn();

jest.mock('../context/DaemonContext', () => ({
  useDaemon: () => mockUseDaemon(),
}));

const noop = () => {};

function renderInbox() {
  return render(
    <InboxHomeScreen
      onApprovalsPress={noop}
      onQuestionsPress={noop}
      onBlockedWorkPress={noop}
      onAttentionPress={noop}
    />,
  );
}

describe('mobile operator intent navigation', () => {
  afterEach(() => {
    mockUseDaemon.mockReset();
  });

  test('pins the five primary mobile intents and renders blocked owner work in Inbox', () => {
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        approvals: [
          {
            id: 'approval-rendered-evidence',
            tool: 'git add',
            input: {},
            review: {
              status: 'available',
              input: {},
              digest: 'a'.repeat(64),
            },
            risk: 'elevated',
            createdAt: '2026-06-18T18:47:15.290Z',
            status: 'pending',
          },
        ],
        ownerQuestions: [
          {
            id: 'question-copy',
            context: 'client release',
            question: 'Confirm owner-facing copy before release',
            reason: 'Operator-visible wording changed',
            source: 'builder',
            createdAt: '2026-06-18T18:47:15.290Z',
            status: 'pending',
          },
        ],
        tasks: {
          counts: { doing: 1, ready: 0, blocked: 1, backlog: 0, inbox: 0 },
          tasks: {
            doing: [],
            ready: [],
            backlog: [],
            blocked: [
              {
                id: 'task-operator-capture',
                title: 'Capture operator evidence',
                priority: 'p1',
                area: 'client',
                summary: 'Waiting on operator capture',
              },
            ],
          },
        },
      },
    });

    const view = renderInbox();
    expect([...PRIMARY_OPERATOR_TABS]).toEqual([
      'Status',
      'Inbox',
      'Work',
      'Knowledge',
      'Setup',
    ]);
    expect(view.getByText('Inbox')).toBeTruthy();
    expect(view.getByText('Approvals')).toBeTruthy();
    expect(view.getByText('Owner questions')).toBeTruthy();
    expect(view.getByText('Blocked work')).toBeTruthy();
    expect(view.getByText('Capture operator evidence')).toBeTruthy();
    expect(view.getByText('Confirm owner-facing copy before release')).toBeTruthy();

    const dest = process.env.KOTA_RUN_DIR
      ? resolve(process.env.KOTA_RUN_DIR, 'rendered-mobile-operator-intents.json')
      : null;
    if (dest) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(
        dest,
        JSON.stringify(
          {
            generatedBy:
              'clients/mobile/src/__tests__/OperatorIntentNavigation.test.tsx',
            primaryTabs: PRIMARY_OPERATOR_TABS,
            surface: 'clients/mobile/src/screens/IntentHomeScreens.tsx',
            tree: view.toJSON(),
          },
          null,
          2,
        ),
        'utf8',
      );
    }
  });

  test('requires opening the complete approval review before taking action', () => {
    const approve = jest.fn();
    const reject = jest.fn();
    const onApprovalPress = jest.fn();
    mockUseDaemon.mockReturnValue({
      state: {
        ...initialState,
        approvals: [
          {
            id: 'approval-review-required',
            tool: 'shell',
            review: {
              status: 'available',
              input: {
                command: 'deploy --path /srv/production --force',
                paths: ['/srv/production', '/srv/production/config'],
              },
              context: 'Deploy the production release after validation.',
              digest: 'b'.repeat(64),
            },
            risk: 'elevated',
            createdAt: '2026-06-18T18:47:15.290Z',
            status: 'pending',
          },
        ],
      },
      client: { approve, reject },
      refresh: jest.fn(),
    });

    const view = render(
      <ApprovalListScreen onApprovalPress={onApprovalPress} />,
    );

    expect(
      view.getByText('Open to review the complete input and conversation context'),
    ).toBeTruthy();
    expect(view.queryByText('Approve')).toBeNull();
    expect(view.queryByText('Reject')).toBeNull();

    fireEvent.press(view.getByLabelText('Review approval for shell'));

    expect(onApprovalPress).toHaveBeenCalledWith('approval-review-required');
    expect(approve).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });
});
