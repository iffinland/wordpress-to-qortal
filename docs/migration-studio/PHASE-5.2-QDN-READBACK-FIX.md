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

## Final live verification (2026-11-04)

The existing publication was re-verified read-only after the corrected module
was deployed; no new transaction was created.

- Publication: `pub_602a5fbbbb927367b05343ff`
- Transaction signature: `4Epsz7FJgteHsJiiaz12qUXyoAvD6XBrJXNJLdNUT5MijderHjf4v3tKdWFePQRAeAHWNBUVh4u2xJiJTUoXh8Qq`
- State: `remote_verified`; code: `EXACT_READBACK_VERIFIED`
- Actual payload: **23 bytes**
- Full SHA-256: `4a884888e0d9199078cc59ba4e30b0ac8d5bbbc5c162f07b28c0d30e21fca587`
- QDN HTTP 200, `Content-Type: text/plain`; properties size 163 was directory metadata and was correctly ignored.

**Phase 5.2 acceptance: PASSED.** The live publication and exact QDN read-back both succeeded.
