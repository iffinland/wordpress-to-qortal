# Qortal Migration Studio 0.8.0-beta.4 — Desktop beta.2

<!-- qms-release-version: 0.8.0-beta.4 -->

This public beta ships **Qortal Migration Studio Desktop 0.8.0-beta.2**, after owner runtime acceptance. Migration Publisher **0.8.0-beta.1** and Generic CMS **0.9.0-beta.1** are unchanged and retain their original verified ZIP bytes.

## What's new in Desktop beta.2

- A four-step guided workflow starts with your WordPress website address, fills in site information, helps choose content, and prepares the Qortal package automatically.
- Local planning, media downloads, file checks and ZIP export run as one durable workflow. Pause and continue from saved work, including after restarting the app.
- Preview article text and optionally load a small number of pictures. Choose a small sample, date range or archive, posts and/or pages, and download limits.
- Import the Publisher confirmation file and let QMS independently verify exact QDN bytes. A confirmed group automatically leads to the next preparation; Qortal Hub still asks you to approve each publication and fee.
- Save and restore a project backup while keeping the same site identity, media and history. Existing projects remain available, and Advanced tools keeps the detailed controls.
- Repair planning refresh, approved plan IDs, media Pause/Cancel, credential timeouts, preferred-node preservation and QDN response timeouts. Preserve typed errors across the Electron boundary so interrupted projects show their explicit recovery controls. Stream ZIP exports and update Electron/build tooling.
- Broader amd64 DEB compatibility, including t64 dependency names and an explicit ALSA dependency to avoid incompatible substitute packages.

## Installation and compatibility

Download `qortal-migration-studio_0.8.0-beta.2_amd64.deb`, verify it against SHA256SUMS and install:

```bash
sudo apt install ./qortal-migration-studio_0.8.0-beta.2_amd64.deb
```

No Node.js, npm, Git or compiler is needed on the target computer. The package is **unsigned** and **amd64/x86-64**. Debian 12/13, Ubuntu 22.04/24.04 and compatible derivatives are targets; DEB does not guarantee every historical distribution or CPU architecture.

The accepted trial passed 315 engine-related and 94 desktop tests, packaged guided/advanced/receipt checks, and isolated installation checks on those four distribution versions. The public release is separately built from clean source and covered by the attached validation, security, reproducibility and provenance evidence. The original trial's checksum is historical and must not be used to check this clean-source release build.

Read [the desktop guide](https://github.com/iffinland/wordpress-to-qortal/blob/main/docs/migration-studio/DESKTOP-BETA.2-TESTING.md). Keep a project backup before upgrading a beta. Migration copies supported editorial content and referenced media; it does not recreate WordPress plugins, carts, accounts or interactive forms. External media downloads depend on the source.

QMS never holds wallet keys, signs or sends QDN transactions. Downloading a Publisher/CMS ZIP does not publish it: deployment and fees require wallet approval in Qortal Hub. Generic CMS may be published as APP or WEBSITE where supported. No QDN update-registry transaction is sent by this GitHub release.
