# Migration Publisher Q-App

Universal Qortal Hub Q-App for Qortal Migration Studio Phase 5.

It does not contain example-site defaults. It validates a portable handoff
folder produced by the desktop app, checks the active Hub account and target
name ownership, reviews dependencies and existing-resource collisions, requires
explicit approval, publishes at most 20 resources per multi-publish request,
and exports a versioned receipt.

## Workflow

1. Build the desktop app and create a handoff package.
2. Open Qortal Hub and launch the Migration Publisher Q-App.
3. Select the whole handoff folder.
4. Connect the account and verify that it owns the target name.
5. Review remote state and collisions.
6. Approve the selected resources and Hub fee.
7. Save the receipt.
8. Import the receipt in Migration Studio and run independent exact QDN
   verification.

## Safety

- Never asks for a seed, private key or wallet password.
- Hub performs signing and approval.
- A READY status or approval is not proof; exact read-back uses base64 bytes and
  compares SHA-256.
- Pending or ambiguous results stop the batch. Nothing is automatically
  resubmitted.
- A receipt is Publisher evidence, not proof of QDN availability.

## Build

~~~bash
npm install
npm run build
~~~

See ../docs/migration-studio/PHASE-5-QDN-PUBLISHING.md.
