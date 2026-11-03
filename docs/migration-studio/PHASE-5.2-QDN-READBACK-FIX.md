# Phase 5.2 — QDN read-back size mismatch fix

## Confirmed cause

Qortal Core 6.1.9 `ArbitraryResource.getFileProperties()` sets:

```java
fileProperties.size = FileUtils.sizeOfDirectory(outputPath.toFile());
```

That is the size of the resource directory, including the `.qortal`
publication metadata directory, not the size of the published payload file.
For `qms-dev-live-001`, the payload was 23 bytes and the directory size was
163 bytes. The old verifier compared `properties.size` to the intended payload
before fetching the payload and returned `REMOTE_SIZE_MISMATCH` without ever
reading the actual bytes.

## Correction

`lib/engine/publication/remote.js` now:

- treats properties as diagnostic evidence only;
- always fetches the exact Base64 payload;
- decodes it and compares byte length and SHA-256;
- records HTTP status, Content-Type, body length and properties size in the
  verification evidence;
- never promotes a non-Base64 API/HTML response to document bytes.

The properties response is still recorded for diagnostics, but it cannot decide
success or failure on its own.

## Tests

`test/phase5.2/readback-properties.test.js` covers:

- properties `size=163` with an exact 23-byte Base64 payload → `remote_verified`;
- a 163-byte HTML/API error body → `TRANSPORT_NOT_BYTE_SAFE`, never success.

## Existing publication

No republish is required. After deploying the corrected broker source, run the
read-only `POST /v1/publications/pub_602a5fbbbb927367b05343ff/verify` against
the existing publication. The transaction signature and charged fee remain
unchanged; this is read-back only.
