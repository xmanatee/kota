kota deamon works but kota serve fails:
```
pnpm build && node dist/cli.js serve

> kota@0.1.0 build /Users/xmanatee/Desktop/mono/apps/kota
> rm -rf dist && tsc -p tsconfig.json

node:unfunction: no such hash table element: node
Fatal: ModuleLoader.getRoutes() requires lifecycle mode "runtime"; this loader is in "commands" mode. A "commands" loader skips onLoad / provider activation, so route handlers and module health probes would call into unregistered providers. Construct a runtime loader (loadRuntimeModules() or new ModuleLoader(config, verbose, { mode: "runtime" })) before consuming routes, control routes, or health checks.
```

that is terrible! It must work! And all other clients too.. and there should be tests checking that everything works!