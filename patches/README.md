# Vendor patches

These patches are maintained against pinned upstream revisions. They are
**not** pushed to third-party repositories. The Phase 5.2 deployment script
does not apply this patch: the broker now sends the atomic fee that Core
expects, so the External Auth restart (and possible wallet relock) is not
required for the fee fix. The patch is stored for upstream review or a later
operator-approved hardening step.

## qortal-external-auth-0.2.0-qdn-publish.patch

- Upstream: Qortal External Auth 0.2.0
- Pinned commit: `7e5d498221cf15ccbc01e7241efbcd0c6e76d09c`
- File: `packages/auth-daemon/src/index.ts`
- Change:
  1. `POST /qdn/publish` validates `fee` as a positive **atomic** integer
     (100000000 = 1 QORT). A fractional QORT amount such as `0.01` now fails
     with a clear error instead of being forwarded to Core, where
     `@QueryParam("fee") Long` cannot bind it.
  2. `service`, `registeredName` and `identifier` are percent-encoded exactly
     once when building `/arbitrary/{service}/{name}[/{identifier}]/base64`.
     This hardens names containing `#`, `?`, `%` or `\`; a plain space was
     already encoded to `%20` by Node's WHATWG URL parser.

Verify before applying:

```bash
git -C /home/iffiolen/qortal-external-auth-src rev-parse HEAD   # must be the pinned commit
git -C /home/iffiolen/qortal-external-auth-src apply --check /home/iffiolen/qms-broker-deploy/patches/qortal-external-auth-0.2.0-qdn-publish.patch
```

The operator script performs the same check and is idempotent (it detects an
already-applied patch with `git apply --reverse --check`).
