# Vendor patches

These patches are maintained against pinned upstream revisions. They are
**not** pushed to third-party repositories. The Phase 5.2 deployment script
applies them in order to the External Auth source checkout, rebuilds the daemon
and installs the new `dist`. External Auth must be restarted for the code to
take effect; that invalidates in-memory sessions and relocks the wallet, so the
procedure includes one operator unlock step.

## Pinned revision

- Upstream: Qortal External Auth 0.2.0
- Pinned commit: `7e5d498221cf15ccbc01e7241efbcd0c6e76d09c`
- Apply order: fee/path patch, then diagnostics patch.

Both patches were generated with `git diff` from that commit and verified in a
clean worktree (`git apply --check`, then apply, for each patch in order).
An earlier stored copy of the fee patch was truncated inside its final hunk and
failed with `corrupt patch at line 58`; the current files are complete and end
with a newline.

## 1. qortal-external-auth-0.2.0-qdn-publish.patch

- File: `packages/auth-daemon/src/index.ts`
- Change:
  1. `POST /qdn/publish` validates `fee` as a positive **atomic** integer
     (100000000 = 1 QORT). A fractional QORT amount such as `0.01` fails with
     a clear error instead of being forwarded to Core, where
     `@QueryParam("fee") Long` cannot bind it.
  2. `service`, `registeredName` and `identifier` are percent-encoded exactly
     once when building `/arbitrary/{service}/{name}[/{identifier}]/base64`.
     This hardens names containing `#`, `?`, `%` or `\`; a plain space was
     already encoded to `%20` by Node's WHATWG URL parser.

## 2. qortal-external-auth-0.2.0-core-diagnostics.patch

- Files:
  - `packages/auth-daemon/src/index.ts`
  - `packages/auth-daemon/src/publishDiagnostics.ts` (new)
  - `packages/auth-daemon/test/publish-diagnostics.test.ts` (new)
- Change:
  1. Non-2xx Core responses keep their HTTP status and a sanitized
     `message` from Core's JSON body.
  2. `POST /qdn/publish` (and `/qortal/request` with
     `PUBLISH_QDN_RESOURCE`) returns
     `{error:"publish_failed", diagnostic:{stage, coreStatus,
     coreErrorCode, coreMessage}}`; the raw body is not returned.
  3. Publish audit records `stage`, `coreStatus` and `coreErrorCode`
     without secrets.
  4. Messages are collapsed to printable ASCII, bounded to 200 characters and
     any run of 48+ token characters becomes `[redacted]`.

## Verify before applying

```bash
EA=/home/iffiolen/qortal-external-auth-src
P=/home/iffiolen/qms-broker-deploy/patches
git -C "$EA" rev-parse HEAD   # must be 7e5d498221cf15ccbc01e7241efbcd0c6e76d09c
git -C "$EA" apply --check "$P/qortal-external-auth-0.2.0-qdn-publish.patch"
git -C "$EA" apply --check "$P/qortal-external-auth-0.2.0-core-diagnostics.patch"
```

The operator script performs marker-based idempotence detection, applies only
the missing patch, aborts on conflict before stopping services where possible,
and rebuilds/installs `packages/auth-daemon/dist`.
