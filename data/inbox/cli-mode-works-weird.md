```
pnpm build && node dist/cli.js

> kota@0.1.0 build /Users/xmanatee/Desktop/mono/apps/kota
> rm -rf dist && tsc -p tsconfig.json

node:unfunction: no such hash table element: node
KOTA — interactive mode. Type your task, or 'exit' to quit.

kota> [module:browser] WARN: Playwright is not installed — browser tools will fail at runtime. Install with: pnpm add playwright
[module:email] WARN: email module: smtp.host, from, and to are required — module inactive
[module:github] WARN: GitHub module: modules.github.token is required but missing — module inactive
[module:google-workspace] WARN: Google Workspace module: modules.google-workspace.clientId, clientSecret, and refreshToken are required — module inactive
[module:slack-channel] WARN: slack-channel module: botToken and appToken are required — module inactive
[module:sqlite-memory] Registered as provider for "memory"
[module:sqlite-memory] SQLite memory provider registered
[module:tool-cache] Tool result cache enabled
[module:tool-retry] Tool retry middleware enabled

kota> 
kota> hi
Error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted

kota> /reset
Error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted

kota> /status
Error: Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted

kota> 
```

lots of warnings and weird comments and some things are blatantly wrong and tools like claude or codex work properly...

also it must use anthropic-sdk if no other models are configured similar to how `pnpm build && node dist/cli.js deamon` works...

investigate that all and make it all consistent and robust!

also are there any commands? commands must work nicely and cleanly even if no auth or model is configured...