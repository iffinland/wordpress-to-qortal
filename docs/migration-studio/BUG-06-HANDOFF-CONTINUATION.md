# BUG-06 — safe continuation after a corrected CMS declaration

## Scope

This document records the `0.8.0-rc.5` desktop/engine behavior for a project
whose previous handoff was prepared before the corrected Generic CMS package
logic. It does not authorize a QDN write, wallet action, receipt deletion,
project reset or replacement of a deployed APP/WEBSITE resource.

## Why the old handoff is not equivalent

Earlier desktop versions reused a handoff using only `planId` and selected
source keys. That could reopen a Content only package after the same project
had selected Generic CMS. The package looked reusable even though it had no CMS
deployment and could not safely prove its CMS configuration.

`rc.5` compares a handoff using:

- each selected content resource's source key, QDN service/name/identifier,
  canonical content hash and route hash;
- CMS selection and APP/WEBSITE deployment triple; and
- a normalized CMS bundle fingerprint. The fingerprint excludes only the
  generated timestamp; it retains the template members, bound manifest
  identifier, site identity and runtime configuration.

Therefore a selection change, a service/name/identifier change, or a CMS
configuration/template change cannot reopen a stale handoff as if it were the
new deployment.

## Partial predecessor safety

The predecessor handoff, its files, receipt and verified-resource records are
never modified or removed. If a changed CMS declaration is requested while any
predecessor resource is pending, submitted or ambiguous, preparation fails
closed with the handoff id and a count by state. The owner must select that
original handoff in **Publishing → Step 2** and run exact QDN verification.
That operation is read-only; it does not submit resources.

For the reported `hof_wb4ik3jht7v5zamkqff24rd6` case, 17 exact verified
resources and 17 pending/ambiguous resources are not sufficient. The next
safe action is reconciliation of the 17 uncertain records, not a new
35-resource package.

## CMS-only successor

Only after every resource in the predecessor has `remote_verified` state does
QMS create a successor. It contains exactly two resources, in dependency order:

1. the predecessor's exact, independently verified site manifest; and
2. the new Generic CMS APP or WEBSITE bundle, which depends on that manifest.

No former content, media or index resource is copied into this package. The
Migration Publisher first reads the manifest's remote triple and SHA-256. If it
is already exact, it skips publication of that manifest and only permits the
CMS bundle after the dependency is verified. If the manifest cannot be read
back exactly, normal Publisher collision/ambiguity protection blocks the CMS
write; it does not overwrite a different site or resubmit an uncertain source
resource.

The successor records `predecessorHandoffId` and retains the original history
for audit. Repeating preparation with unchanged canonical content and CMS
bundle reopens the successor rather than creating another package.

## Owner retest

1. Install the rc.5 `.deb`; existing QMS project data is retained.
2. Open `DEV nasa test`, select the old handoff, and in Step 2 run exact
   read-only QDN verification against the intended node. Do not export the old
   package or click Publisher publish for uncertain records.
3. If any resource remains pending or ambiguous, stop. The error message lists
   the old handoff and tells you to reconcile; this is the expected safe state.
4. Only after all old resources are **remote verified**, return to the same
   plan and choose **Generate handoff package**. Confirm that the result says
   **CMS-only successor** and has exactly two resources: manifest then APP or
   WEBSITE.
5. Export that successor and inspect it in Migration Publisher. Confirm the
   target name, service and identifier. Publisher must report the exact
   manifest as already present before any CMS approval. Approve only the CMS
   action you intend; QMS does not approve it for you.

## Evidence

Focused regression: `test/phase5/handoff.test.js` covers a legacy rc.3
content-only partial handoff, mixed exact/ambiguous evidence, the fail-closed
message, preservation of the old record, CMS-only successor creation after
independent verification, repeat idempotence and a changed CMS bundle for the
same selected content. The package build and extracted-engine handshake are
recorded with the build artifact for this candidate.
