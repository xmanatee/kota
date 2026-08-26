import fixture from './__fixtures__/ui-behavior-vectors.generated.json';
import { parseUiSurfaceBundle } from '../daemon/ui-surface.generated';
import {
  initialFieldValues,
  readActionParameters,
} from '../shared-ui/action-parameters';
import { surfaceActionIds } from '../shared-ui/graph';

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

  test('discovers the action through the same exhaustive graph traversal', () => {
    expect(surfaceActionIds(surface)).toContain(action.actionId);
  });
});
