# Durable completion notifications

A finished QMS run must not depend on an agent remembering to send a message.
The repository ships a small, testable module that writes the real final report
to a durable outbox first and only then attempts Telegram delivery.

## Usage

    npm run notify:completion -- --report=release/completion-report.json --status=success
    npm run notify:completion -- --report=... --status=blocked --dry-run
    npm run notify:retry

Alternatively call the CLI directly:

    node scripts/notify/telegram-notify.mjs --report=... --status=failure
    node scripts/notify/telegram-notify.mjs --report=... --status=success --secrets-env=/run/secrets/qms-notify.env

Supported statuses: success, failure, timeout, cancelled, blocked.

## Credentials

Only environment or SecretRef-style env files are read:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- TELEGRAM_API_BASE (optional, defaults to https://api.telegram.org)

Tokens and chat ids are never hardcoded, never written to the outbox and are
redacted from errors and messages. If credentials are absent the report is
recorded in the outbox and the command exits 0; a notification problem must not
fail the build. The outbox lives in .notify-outbox/ (gitignored).

## Durability and idempotency

- Every report is written atomically (temp file + fsync + rename).
- The dedupe key is a SHA-256 of the run id, branch, remote SHA, title, status
  and artifact list, or an explicit --dedupe value. Re-running the same report
  cannot send a second message.
- Failed/deferred deliveries keep the report and last error in the outbox;
  --retry sends each pending entry at most once.

## What the message contains

The message is the actual final report, not a generic "task finished": title,
status, branch, remote main SHA, PR, release URL, artifact names/sizes/SHA-256,
registry handoff path/hash and explicit limitations.

## Tests

test/notify/telegram-notify.test.js covers success, failure, timeout, cancelled
and blocked reports, unconfigured credentials, Telegram HTTP errors, token
redaction, idempotent duplicate dispatch and retry after a retained failure.
All HTTP is mocked; no real token is used.
