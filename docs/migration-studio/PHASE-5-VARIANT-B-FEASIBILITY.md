# Phase 5 — Variant B feasibility and security assessment

| Field | Value |
| --- | --- |
| Document | Secure automatic desktop-to-Hub Publisher transfer assessment |
| Date | 2026-11-03 |
| Status | Deferred; Variant A remains the guaranteed workflow |
| Scope | Browser/Q-App sandbox, file access, Hub bridge capabilities, localhost/CORS/CSP, authenticated transfer sessions, package integrity, user consent |
| Recommendation | Do not ship Variant B in Phase 5 |

## 1. Question

Can the desktop app automatically transfer a prepared handoff package into the
Hub-hosted Migration Publisher Q-App without the user selecting a folder?

## 2. Constraints observed in Qortal Hub and Core sources

- Q-Apps run in a sandboxed, isolated guest session. The renderer has no direct
  filesystem or Node access.
- The supported Q-App bridge is qortalRequest plus marked postMessage requests.
  It is not a general-purpose filesystem or command API.
- File/Blob arguments cross the bridge only through Hub's authenticated file
  worker. Hub retains validation, permission, fee and signing decisions.
- Core's Q-App script can read QDN resources and base64 payloads, but a Q-App
  cannot silently read arbitrary local files.
- The Electron desktop app has a narrow preload API and no generic IPC bridge.
- A localhost HTTP service would be a new attack surface. Websites and Q-Apps
  are untrusted origins from the desktop's perspective.
- CORS and CSP are browser-enforced and are not an authentication mechanism.
- A Q-App-to-localhost request that is not authenticated and origin-bound would
  be CSRF-able by any web page the user visits.
- Exposing an arbitrary local file path or command endpoint to a web origin is
  unacceptable.

## 3. Candidate designs

### A. User-selected folder (Variant A, current)

User clicks a folder picker in the Publisher and selects the handoff directory.
The package is validated inside the Q-App.

Advantages:

- no local service;
- no cross-origin trust;
- no automatic file exfiltration;
- simple operational model;
- works with Hub's sandbox and file APIs.

Disadvantages:

- one manual step;
- large folders are copied through the browser file picker.

Verdict: primary and sufficient.

### B. One-time authenticated localhost transfer

Desktop starts an ephemeral localhost listener with:

- a random 256-bit one-time token;
- an origin allowlist for the exact Hub/Q-App origin;
- a 60-second expiry and single use;
- GET only for a manifest descriptor and POST only for an explicitly approved
  package id;
- strict path allowlist rooted at the handoff directory;
- package SHA-256 and per-file hashes;
- no commands, no arbitrary paths, no directory listing;
- CSRF protection via unpredictable token plus Origin/Sec-Fetch-Site checks;
- user consent in both desktop and Hub.

This is technically possible but requires:

- resolving mixed-content and CORS/CSP behavior in Hub's Electron guest;
- ensuring no other local app or website can race the token;
- protecting against DNS rebinding and localhost origin confusion;
- a threat model for token leakage through logs, history, redirects or
  screenshots;
- a user-visible consent design;
- tests on Windows, macOS and Linux Hub builds.

Residual risk remains nontrivial. A website that learns the token (for example
through a malicious Q-App) could request package bytes. Origin checks are only
as strong as the guest's isolation and the desktop's implementation.

Verdict: defer. Do not implement an unauthenticated or general-purpose local
publishing API.

### C. Clipboard/paste descriptor

Desktop places a signed descriptor (not the bytes) on the clipboard. The Q-App
still needs the bytes through a file picker, or fetches them from a QDN staging
resource.

Problems:

- staging bytes on QDN before publication is itself a write and may leak content;
- clipboard contents are observable by other apps;
- descriptor signing requires a key the desktop should not hold.

Verdict: reject.

### D. Hub deep link with a package path

A custom URL scheme could pass a path to Hub.

Problems:

- arbitrary path disclosure;
- scheme hijacking;
- Hub would still need a filesystem capability it intentionally does not expose
  to Q-Apps;
- no user-visible consent over the exact file set.

Verdict: reject.

### E. Shared folder watched by Hub

Desktop writes into a directory Hub watches.

Problems:

- Hub has no documented watched-folder import contract;
- any process can write there;
- no origin or user consent binding;
- cleanup and stale-package handling are ambiguous.

Verdict: reject.

## 4. Threat model for Variant B

Assets:

- unpublished content and media;
- project/site identity and QDN namespace;
- target Qortal name and account identity;
- transaction fees and signing authority;
- local filesystem confidentiality.

Adversaries:

- malicious website or Q-App running in the same browser/Electron profile;
- another local user or process;
- network attacker on localhost (limited but real on shared hosts);
- malicious package content attempting path traversal or hash confusion;
- accidental user approval of the wrong package.

Primary threats:

1. Any web origin reads arbitrary local files through the local service.
2. CSRF causes publication or package disclosure without desktop consent.
3. DNS rebinding bypasses an Origin check.
4. Token leakage enables replay.
5. A malicious package replaces expected bytes after validation.
6. The service is left running after a crash and becomes a persistent backdoor.
7. The Q-App is induced to publish a different project or target identity.
8. Signing/fee approval is confused with package transfer consent.

Required controls if pursued:

- bind to 127.0.0.1 only, random port, random one-time token;
- exact Origin and Sec-Fetch-Site validation, no wildcard CORS;
- no credentials, cookies or authorization headers accepted;
- explicit desktop confirmation of package id, target name, resource count,
  total bytes and SHA-256;
- package bytes read only from the handoff directory and re-hashed immediately
  before serving;
- single-use, short TTL, immediate shutdown after transfer or cancel;
- no directory listing and no path parameter from the web origin;
- no shell, process, wallet or signing endpoint;
- structured audit log with redaction;
- tests for CSRF, rebinding, token replay, concurrent requests, crash cleanup
  and malicious packages;
- platform testing of Hub's Electron guest CORS/CSP behavior.

Even with all controls, the design adds a new local network service and a new
trust boundary for a one-click convenience. That is not justified for Phase 5.

## 5. Recommendation

- Keep Variant A as the guaranteed, documented workflow.
- Do not ship a local HTTP publishing API.
- Do not expose arbitrary local files or commands to websites or Q-Apps.
- Revisit Variant B only if Hub adds a first-class, authenticated,
  origin-bound import API with explicit user consent and a documented security
  model.
- If an experimental Variant B is ever built, it must be opt-in, disabled by
  default, fully threat-modeled, covered by integration tests, and never
  required for publication.
