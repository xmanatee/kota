import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import React from 'react';
import { render } from '@testing-library/react-native';
import { initialState } from '../context/state';
import { PRIMARY_OPERATOR_TABS } from '../navigation/operatorIntents';
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
});
