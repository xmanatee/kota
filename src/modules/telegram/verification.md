## Verification ownership

Bot delivery fixtures use real sessions, module loaders and scoped stores with
controlled model and HTTP responses. Assert incoming identity, scoped delivery
and denied routing; shared session continuity journeys own restart persistence.
Do not replace AgentSession or its transports with constructor spies.

Notification tests use the adapter's credential, event, scope and client ports;
provider-shaped Bot API messages prove delivery and callback binding. Keep
command checks for parsing, chat/scope admission and Telegram output limits.
Exercise command delivery through the production command handler; polling checks
must drive the interactive bot's live update stream, not the standalone status poller.
Domain result matrices, scheduler transitions and inbound routing decisions stay
with their shared owners. Retain daemon journeys only for distinct channel
composition behavior, using the production channel and client namespace handlers.
Scope fixtures supply the production adapter ports and use the provider registry;
they do not fabricate module lifecycle, tool execution, or session creation.
Do not recreate domain HTTP routes or client transport encoders in channel fixtures.
