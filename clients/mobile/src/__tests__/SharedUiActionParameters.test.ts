import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import {
  type UiAction,
  parseUiSurfaceBundle,
} from '../daemon/ui-surface.generated';
import {
  initialFieldValues,
  readActionParameters,
} from '../shared-ui/action-parameters';

const bundle = parseUiSurfaceBundle(fixture.operatorBundle);
const surface = bundle.surfaces.find(
  (candidate) => candidate.surfaceId === 'operator-control',
)!;
const action = surface.actions.find(
  (candidate) => candidate.actionId === 'workflow.launch',
)!;
const fields = action.parameters!.fields;

describe('shared UI action parameters', () => {
  test('derives defaults and typed structured values from the generated schema', () => {
    const defaults = initialFieldValues(action, fields);
    expect(defaults.name).toBe('builder');
    expect(
      readActionParameters(
        action,
        fields,
        { ...defaults, tags: '["mobile"]', payload: '{"source":"android"}' },
        {},
      ),
    ).toEqual({
      name: 'builder',
      tags: ['mobile'],
      payload: { source: 'android' },
    });
  });

  test('rejects structured values whose JSON shape disagrees with the schema', () => {
    const defaults = initialFieldValues(action, fields);
    expect(() =>
      readActionParameters(
        action,
        fields,
        { ...defaults, tags: '{}', payload: '[]' },
        {},
      ),
    ).toThrow('Run tags JSON must be a JSON array.');
    expect(() =>
      readActionParameters(
        action,
        fields,
        { ...defaults, tags: '[]', payload: '[]' },
        {},
      ),
    ).toThrow('Payload JSON must be a JSON object.');
  });

  test('preserves an explicit daemon-host path entered in a native field', () => {
    const addAction: UiAction = {
      ...action,
      parameters: {
        fields: [{
          id: 'directoryRoot',
          label: 'Daemon host folder',
          input: 'path',
          required: true,
        }],
        schema: {
          type: 'object',
          required: ['directoryRoot'],
          properties: {
            directoryRoot: {
              type: 'string',
              format: 'path',
              description: 'Absolute path on the daemon host.',
            },
          },
          additionalProperties: false,
        },
      },
    };
    const fields = addAction.parameters?.fields ?? [];
    expect(readActionParameters(
      addAction,
      fields,
      { directoryRoot: '/srv/operator-selected' },
      {},
    )).toEqual({ directoryRoot: '/srv/operator-selected' });
  });
});
