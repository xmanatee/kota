const mockRegisterRootComponent = jest.fn();

jest.mock('expo/src/launch/registerRootComponent', () => ({
  __esModule: true,
  default: mockRegisterRootComponent,
}));

test('the package entry resolves and registers the production app', () => {
  const packageJson = require('../../package.json') as { main?: unknown };
  if (typeof packageJson.main !== 'string' || packageJson.main.length === 0) {
    throw new Error('The mobile package needs a resolvable main entry.');
  }

  const entryPath = require.resolve(`../../${packageJson.main}`);
  require(entryPath);

  expect(mockRegisterRootComponent).toHaveBeenCalledTimes(1);
  expect(mockRegisterRootComponent.mock.calls[0]?.[0]).toEqual(expect.any(Function));
});
