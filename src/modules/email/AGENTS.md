# Email Module

Outbound email notification channel for KOTA using SMTP (nodemailer).

- Subscribes to workflow and module bus events and sends formatted emails.
- Contributes an `email-alerts` ChannelDef that verifies SMTP on startup.
- Disabled gracefully when `smtp.host`, `from`, or `to` is absent in config.
- Credentials (`smtp.auth`) are read from config; never logged.

## Config

```json
{
  "email": {
    "smtp": {
      "host": "smtp.example.com",
      "port": 587,
      "secure": false,
      "auth": { "user": "kota@example.com", "pass": "${SMTP_PASS}" }
    },
    "from": "kota@example.com",
    "to": "operator@example.com",
    "events": ["workflow.build.committed"]
  }
}
```

`events` is an opt-in list for events that are off by default. All standard
notification events are always active when the module is configured.

