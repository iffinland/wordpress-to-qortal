# Product Requirements — Qortal Migration Studio

| Field | Value |
| --- | --- |
| Document | Product requirements |
| Product working name | Qortal Migration Studio |
| Executing agent | DeepSeek (`opencode-development` profile) |
| Date | 2026-11-02 |
| Status | Requirements baseline for architecture/planning; not a release commitment. Phases 3–5 are implemented as documented in their phase documents; a real Hub-signed live publication remains unverified. Phases 6–10 remain unimplemented. |
| Companion audit | [`PHASE-0-ARCHITECTURE-AUDIT.md`](PHASE-0-ARCHITECTURE-AUDIT.md) |

> **Phase 3 implementation note (2026-11-03):** BAT-02/04/05/06, MED-01..07,
> IDM-01..06 and the relevant SYN checks are implemented for the engine and
> local fixtures. “Implemented” means tested against synthetic WordPress/media
> fixtures; it does not mean a live WordPress or QDN end-to-end migration.
> `BAT-02` includes exactly 15 posts per batch by default and rejects invalid
> values. `MED-02` keeps external media linked-only unless explicitly enabled.
> `IDM-03/04` prevent duplicate planning and surface conflicts; publication
> status is still reserved for Phase 5. GUI acceptance criteria belong to
> Phase 4.

> **Phase 5 implementation note (2026-11-03):** PUB-01..08 are implemented for
> the portable handoff and universal Publisher workflow. Exact QDN read-back
> uses `encoding=base64`; receipts are Publisher evidence, not proof. A real
> Hub-signed live publication and fee/transaction acceptance have not been
> executed. See [`PHASE-5-QDN-PUBLISHING.md`](PHASE-5-QDN-PUBLISHING.md).

## 1. Product definition

### 1.1 Vision

Qortal Migration Studio is a guided desktop application that moves an existing
website into Qortal QDN safely, repeatably and incrementally. It lets a
non-technical operator connect a CMS, preview what will be migrated, prepare
media and content batches within disk and fee limits, publish through supported
Qortal signing, verify the result, and keep the Qortal copy synchronized over
time.

The first source is WordPress. The architecture must support Joomla, Wix and
other sources through adapters without rewriting the publishing engine. The first
target platform is Debian-based Linux, distributed as a self-contained `.deb`.
Windows is a future platform.

### 1.2 Target users

| Persona | Needs |
| --- | --- |
| Site owner / operator | A guided flow, clear progress, no terminal, no Node.js knowledge, no private keys |
| Publisher / coauthor | A Qortal name they own, fee visibility, safe retry after partial failures |
| Migration consultant | Multiple independent projects, resumable runs, audit history, reproducible batches |
| Qortal site maintainer | A generic CMS/site template, optional custom template, verifiable QDN resources |
| Developer/integrator | A stable engine API, adapter contract, structured events and tests |

### 1.3 Non-goals for v1

- Becoming a general-purpose web hosting control panel.
- Replacing Qortal Hub or implementing a Qortal wallet.
- Collecting, storing or transmitting seeds, private keys or wallet passwords.
- Guaranteeing a fully standalone desktop publish if Qortal does not expose a
  supported external signer.
- Deleting content from the Qortal network (QDN has no on-chain delete).
- Migrating every CMS feature in v1 (memberships, e-commerce, plugin-specific
  behavior, private/draft content, comments) unless explicitly scoped later.
- Real-money or mainnet transactions without explicit owner authorization.

## 2. Product principles

1. **No key custody.** The desktop app never asks for or stores Qortal private
   keys, seeds or wallet passwords. Signing is delegated to a supported Qortal
   mechanism.
2. **Preview before write.** Every publish is planned, costed, validated and
   explicitly confirmed.
3. **Truthful state.** The UI distinguishes planned, prepared, submitted,
   confirmed, verified, partial, failed, skipped and withdrawn.
4. **Idempotent by identity.** Stable source identity maps to stable QDN
   identity; retries do not create duplicate resources.
5. **Crash-safe.** A killed app, power loss or disk-full event leaves a
   recoverable project, not a corrupt one.
6. **Disk is a first-class resource.** Downloads are bounded and never allowed
   to exhaust the volume.
7. **Derived data is rebuildable.** Catalogs, indexes and CMS views are not the
   authority; source entities and publication mappings are.
8. **Adapters, not forks.** New CMS sources implement a contract; they do not
   fork the engine.
9. **Preserve proven workflows.** The Corbett Report and AstuAeda-style flows
   remain supported as compatibility profiles/templates.
10. **English first, localizable by design.** No hard-coded user-facing strings
    in domain code.

## 3. Scope and assumptions

### 3.1 Assumptions

- The user has a Qortal account with a registered name that owns the target QDN
  resources.
- Qortal Hub (or a compatible host) is available for signing/publication in the
  supported v1 model.
- The source CMS exposes a supported API (WordPress REST API for v1).
- The user can provide a WordPress application password or, as a fallback, a
  login session.
- The machine has enough disk for the selected content; the app will refuse or
  reduce scope when it does not.
- Qortal service limits, fees and bridge behavior can change; the app must
  detect and explain these conditions rather than assume them.

### 3.2 Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| Qortal Core node | Read-only QDN/status/name operations | Required |
| Qortal Hub (or compatible host) | Approval and signing for publication | Required for integrated publication |
| WordPress REST API | Source discovery/content/media | Required for WordPress adapter |
| OS keyring (`libsecret` on Linux) | Secret storage | Required for production |
| SQLite or equivalent | Project/state/identity store | Proposed |
| HTML sanitizer | Safe rendering of imported HTML | Required |
| Electron (proposed) | Desktop shell and bundled runtime | Proposed |
| Packaging tool | `.deb` artifact | Required |

## 4. Functional requirements

Priority: **M** = must for first public release, **S** = should, **C** = could.

### 4.1 Projects and onboarding

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| PRJ-01 | Create, name, open, duplicate and archive multiple independent migration projects. | M | Two projects can coexist with separate source settings, Qortal names, state, media, receipts and history; actions in one never mutate the other. |
| PRJ-02 | Each project records source adapter, source URL, target Qortal names, template, storage root and created/updated metadata. | M | Project settings survive restart and are exportable/importable without secrets. |
| PRJ-03 | Guided first-run wizard: choose source, connect, validate, choose target/template, review, prepare. | M | A non-technical user can reach a validated plan without a terminal. |
| PRJ-04 | Project-level lock prevents two app instances/workers from writing the same project. | M | A second writer is refused with a clear message; stale lock recovery is explicit. |
| PRJ-05 | Delete/archive a project only with explicit confirmation and retained audit metadata. | S | Deleting local data never deletes QDN resources; receipts/history remain until the user chooses otherwise. |

### 4.2 Source adapters and WordPress

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| SRC-01 | Define a versioned source-adapter contract with capability declarations. | M | At least WordPress implements it; unsupported capabilities are reported, not silently ignored. |
| SRC-02 | WordPress connection check discovers REST root, auth mode, permissions and required endpoints. | M | The UI reports pass/fail per check with actionable errors. |
| SRC-03 | WordPress discovery covers posts, pages, categories, tags, media and featured media. | M | Counts and sample items match the source; empty/partial responses are distinguished from errors. |
| SRC-04 | WordPress adapter supports application passwords and session login fallback. | M | Application-password path is preferred; session path is isolated and documented as brittle. |
| SRC-05 | Adapter preserves source IDs, slugs, old URLs, dates, modified dates, status and terms. | M | Normalized records retain all required fields and a stable source key. |
| SRC-06 | Adapter detects unsupported/custom content types and reports them. | S | A capability report lists unsupported types and counts. |
| SRC-07 | Future adapters (Joomla, Wix) can be added without changing the engine or publisher. | M | A conformance test suite passes a second fixture adapter. |

### 4.3 Common content model

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| MOD-01 | A versioned, source-neutral content model represents items, terms, assets, links and provenance. | M | The same model can represent WordPress and a second fixture source. |
| MOD-02 | Each item has a stable adapter source key and a content hash. | M | Re-importing unchanged content produces the same hash and no new QDN resource. |
| MOD-03 | The model distinguishes published, draft, private, trashed, withdrawn and unknown states. | M | The UI can filter and explain each state; unsupported source states map explicitly. |
| MOD-04 | The model separates editorial author/public author from technical QDN publisher. | M | UI and published payloads never conflate the two. |
| MOD-05 | The model carries media references without requiring local files to exist. | M | Planning can show linked-only media and unpublishable references. |

### 4.4 Planning, batches and limits

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| BAT-01 | User can preview the next batch before any download or publish. | M | Preview shows item counts, media counts/bytes, estimated fees and disk impact. |
| BAT-02 | Configurable batch size, including 15 posts per batch. | M | A project can set 15; the plan, run and state use exactly 15 for that batch; validation rejects unsafe values. |
| BAT-03 | Configurable historical/recent strategy and cursors. | M | The user can run historical-only, recent-only or combined; cursors are visible and resumable. |
| BAT-04 | Per-run download limits: max files, max bytes, per-file cap. | M | A run refuses or pauses before exceeding a limit and explains how to continue. |
| BAT-05 | Available-disk protection with reserved headroom. | M | The app refuses to start or pauses before the reserve is breached; the reserve is configurable. |
| BAT-06 | Batch planning is deterministic and reproducible from recorded settings. | M | The same project/cursor/settings produce the same item set and identifiers (excluding timestamps). |
| BAT-07 | Batch history persists after local files are cleaned. | M | The UI still shows counts, items, hashes, publish evidence and errors after cleanup. |

### 4.5 Media processing

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| MED-01 | Extract images, audio, video, documents, embeds and linked files from HTML. | M | Fixtures cover `src`, `srcset`, lazy attributes, links, audio/video/source and iframes. |
| MED-02 | Same-site media downloads by default; external media is a policy choice. | M | External media is linked-only unless the user opts in. |
| MED-03 | Stream downloads to temporary files, verify content type/size, hash and atomically rename. | M | Interrupted downloads leave no valid-looking final file; re-run recovers. |
| MED-04 | Retry transient failures with bounded attempts/backoff; do not retry permanent failures forever. | M | The UI distinguishes retryable and permanent errors; no infinite loops. |
| MED-05 | Deduplicate media by content hash and source identity. | S | The same file referenced by multiple items is stored once per project. |
| MED-06 | Shared media is reference-counted across items/batches. | M | Cleanup cannot delete a file still referenced by a pending or unverified item/batch. |
| MED-07 | Media validation reports missing, blocked, HTML-instead-of-media, oversized and unsupported items. | M | Validation produces per-item issues and a safe batch decision. |

### 4.6 Identity mapping, duplicate prevention and conflicts

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| IDM-01 | Persist a source→QDN mapping for every published item and asset. | M | Mapping survives cleanup and restart; it includes source key, QDN triple, content hash, revision/tx and timestamps. |
| IDM-02 | Stable identifiers are derived from the source key, not from mutable titles/slugs. | M | Renaming a slug does not create a new QDN resource unless the user explicitly chooses a new identity. |
| IDM-03 | Duplicate prevention: an unchanged item is not republished. | M | Re-running the same plan reports "unchanged" and publishes nothing. |
| IDM-04 | Conflict detection: source changed, local plan changed, or QDN content differs from the last mapping. | M | Conflict records are visible with source/local/QDN values and require a resolution choice. |
| IDM-05 | Conflict resolution options: keep Qortal, take source, duplicate, skip, or mark withdrawn. | M | Each choice is audited and idempotent. |
| IDM-06 | Project lock prevents concurrent publication of the same identity. | M | Concurrent runs are refused or serialized; no duplicate transactions. |

### 4.7 Incremental synchronization

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| SYN-01 | Detect new content since the last successful sync. | M | New posts/pages are classified and planned. |
| SYN-02 | Detect modified content, including modifications older than the "latest new post" cursor. | M | A modified old post is detected via a modified watermark/overlap or reconciliation scan. |
| SYN-03 | Detect source deletion/unpublication without claiming network deletion. | M | Item becomes withdrawn/hidden per policy; QDN record is not described as deleted. |
| SYN-04 | Full reconciliation is available and bounded. | S | It reports missing/unmapped items and never rewrites an unreadable/partial index blindly. |
| SYN-05 | Sync is resumable and reports partial/unavailable source states honestly. | M | A failed scan does not produce a false "no changes" state. |

### 4.8 QDN preparation and publication

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| PUB-01 | Prepare a QDN publish plan with service, name, identifier, local path, content hash, bytes and estimated fee. | M | Plan is reviewable before approval; invalid resources are blocked. |
| PUB-02 | Publish media before content and indexes; publish the manifest/index last. | M | A failed media step blocks dependent content; a failed index does not corrupt authoritative content. |
| PUB-03 | Use only supported Qortal signing (Hub-mediated in v1); never collect keys. | M | No key/seed input exists anywhere in the desktop UI or logs. |
| PUB-04 | Chunk multi-resource publication to respect Qortal limits. | M | No single request exceeds the configured safe batch; unconfirmed-transaction limits are respected. |
| PUB-05 | Normalize partial/ambiguous publish results per resource. | M | Thrown and resolved `error.unsuccessfulPublishes` are handled; no auto-retry of ambiguous writes. |
| PUB-06 | Verify exact `(service,name,identifier)` content after publication. | M | Verification compares served content/hash to the intended resource; status alone is insufficient. |
| PUB-07 | Show fee, balance prerequisite and target name ownership before approval. | M | User sees cost and target; wrong-name publishing is blocked. |
| PUB-08 | Provide a clear fallback when integrated Hub handoff is unavailable. | M | UI explains how to open the publisher Q-App and select the batch; no dead end. |
| PUB-09 | Publication history records submission, verification, tx signature (if available), errors and retries. | M | History is queryable per item and per run. |

### 4.9 Default CMS, website and templates

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| CMS-01 | Provide a default generic Qortal CMS/website template with no Corbett-specific branding or identifiers. | M | A new project can build/publish a neutral site with configurable title, tagline, navigation and colors. |
| CMS-02 | Default template supports posts, pages, categories, tags, media, search, archive and a minimal author/import view. | M | Acceptance fixtures render all routes and empty/error/partial states. |
| CMS-03 | Optional custom website clones/templates without changing the engine. | M | Corbett remains a custom template/profile; a second clone can override presentation/config only. |
| CMS-04 | CMS reads a versioned manifest/catalog and treats it as derived, not authority. | M | Missing/stale/partial catalogs produce honest UI states and bounded reconciliation. |
| CMS-05 | CMS can import/adopt migrated content when the template chooses that workflow. | S | The default can serve the catalog directly; adoption remains available for custom templates. |
| CMS-06 | Owner/coauthor detection is based on current name ownership, not hard-coded names. | M | Owner mode works when `_qdnName` matches an owned name; non-owner sees read-only. |
| CMS-07 | Imported HTML is sanitized before rendering. | M | Malicious HTML/URL fixtures cannot execute script or navigate unsafely. |

### 4.10 Recovery, history and cleanup

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| REC-01 | Every run has a durable state machine and can resume after process crash. | M | Kill/power-loss simulation resumes without duplicate downloads or publications. |
| REC-02 | Pause/cancel is safe and leaves a resumable state. | M | Cancel stops new work, preserves completed work and marks the run paused/cancelled. |
| REC-03 | Retry is scoped to failed items, not the whole archive. | M | Retry reuses completed media/content and same identifiers. |
| REC-04 | Cleanup is allowed only for verified completed runs. | M | Unverified/partial/failed runs cannot be cleaned. |
| REC-05 | Cleanup is two-phase with receipts and an undo/quarantine window. | M | Marking does not delete; deletion is explicit; receipts remain readable. |
| REC-06 | History survives cleanup and includes manifest, hashes, mappings and publication evidence. | M | UI can explain what was migrated, published, verified and deleted locally. |
| REC-07 | Diagnostics export redacts secrets and personal data. | M | Export contains no credentials, cookies, seeds or keys. |

### 4.11 Desktop, installation and localization

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| DES-01 | Guided graphical UI for the full flow. | M | No terminal required for normal operation. |
| DES-02 | Self-contained Linux `.deb` without requiring users to install Node.js, npm or Git. | M | Clean Debian/Ubuntu VM installs and launches from the desktop menu. |
| DES-03 | Windows is a future platform, not a fork of domain logic. | S | Shell/platform adapters isolate OS-specific code. |
| DES-04 | English UI, documentation and development artifacts. | M | All user-facing strings are externalized. |
| DES-05 | Future localization support. | S | Message catalogs, locale-aware dates/numbers and RTL-ready layout primitives. |
| DES-06 | Accessible controls, keyboard navigation and reduced-motion support. | S | Automated and manual a11y checks pass for primary flows. |
| DES-07 | Crash reporting/telemetry is opt-in and documented. | C | Off by default; no secrets/content. |

## 5. Key user flows

### 5.1 First run / new project

```text
Welcome
-> Choose source (WordPress)
-> Enter site URL + credentials (application password preferred)
-> Connection checks (REST root, posts/pages/terms/media, permissions)
-> Choose Qortal target names + template
-> Review capability report and unsupported items
-> Save project
-> Run a dry plan with a small batch (default 15)
```

**Exit criteria:** project saved; checks pass or failures are actionable; a
preview shows item/media counts, estimated bytes and fees; no network write has
occurred.

### 5.2 Prepare and review a batch

```text
Plan next batch
-> Fetch source metadata (no full media yet)
-> Normalize + hash
-> Classify new/modified/unchanged/withdrawn/conflict
-> Estimate media sizes (HEAD) and fees
-> Show disk projection, limits and warnings
-> User approves
-> Fetch/convert/download/validate
-> Review prepared resources and issues
```

**Exit criteria:** a prepared batch with per-item state, media plan and publish
plan; no QDN write; all failures have codes and retry guidance.

### 5.3 Publish through Hub

```text
Open publish review
-> Show target name, ownership status, services, counts, fee
-> Write portable batch/manifest for the publisher
-> User opens the publisher Q-App in Qortal Hub
-> User selects the batch and approves publications
-> Desktop (or Q-App) records results
-> Read back exact resources and verify content
-> Mark verified only when evidence matches
```

**Exit criteria:** every resource has submitted/verified/failed/partial state;
the manifest/index is verified last; no false success.

### 5.4 Incremental sync

```text
Run sync
-> Scan source for new + modified + withdrawn
-> Show delta and conflicts
-> User resolves conflicts
-> Prepare/publish only the delta
-> Verify and update mappings
```

**Exit criteria:** unchanged items are untouched; modified items update the same
QDN identity; withdrawn items follow the chosen policy; no duplicate resources.

### 5.5 Cleanup

```text
Select verified completed run
-> Preview files/bytes to delete and receipts to keep
-> Confirm quarantine
-> Wait retention window or delete now
-> Remove only unreferenced project files
-> Keep history/mappings/receipts
```

**Exit criteria:** no referenced/pending media deleted; history remains; QDN is
untouched.

## 6. Non-functional requirements

### 6.1 Reliability

- No single point of failure in local state; crash-safe writes.
- Bounded retries; no infinite loops; no automatic retry of ambiguous writes.
- Deterministic classification and idempotent operations.
- Project lock and stale-lock recovery.
- Graceful handling of network loss, source rate limits, node unavailability,
  disk exhaustion, malformed API responses and partial QDN results.

### 6.2 Performance

- UI remains responsive during scans/downloads; work runs off the UI thread.
- Bounded concurrency (source, media, QDN) and pagination.
- No N+1 QDN discovery in list views.
- Lazy media loading in the CMS; no full media download for listing.
- Measured budgets to be established from current apps, not invented.

### 6.3 Security and privacy

- No private keys, seeds or wallet passwords collected or stored.
- Secrets stored in OS keyring; file-permission fallback only with explicit
  warning.
- Renderer sandbox/context isolation; strict preload API; no remote code.
- Loopback-only local services with random tokens and origin checks.
- Sanitized HTML rendering.
- SSRF/path traversal/symlink protections for source and media.
- Redacted logs/diagnostics.
- Explicit external-write authorization; no background publication.

### 6.4 Compatibility

- Preserve the existing Corbett identifiers and workflows as a compatibility
  profile.
- Version all persisted formats and migrate them explicitly.
- Support current Qortal Hub bridge behavior and fail clearly on drift.
- Do not transfer Qortium behavior to Qortal or vice versa.

### 6.5 Accessibility and localization

- WCAG-oriented controls, labels, focus states, keyboard paths and reduced
  motion.
- English default; externalized strings; pluralization/date/number formatting;
  RTL-ready layout.

### 6.6 Packaging and operations

- Self-contained `.deb`; no Node/npm/Git requirement.
- Desktop entry, icons, uninstall behavior and data locations documented.
- Signed builds, checksums and SBOM; reproducible release process.
- User data under a documented XDG location; backups/exports available.

## 7. Constraints and policies

### 7.1 Batch and publication defaults

| Setting | Default | Notes |
| --- | --- | --- |
| Posts per batch | 15 for first run; configurable | Requirement explicitly includes 15 |
| Recent posts per batch | 100 | Current toolkit behavior; review with owner |
| Media scope | selected posts | Current Corbett behavior |
| External media | off | Preserve as links unless opted in |
| Multi-publish chunk | ≤20 resources | Qortal guidance; poll unconfirmed |
| Publish fee | Show per resource | 0.01 QORT typical; verify current |
| Disk reserve | 2 GiB or 10%, whichever is larger | Proposed; owner decision |
| Per-run download cap | Configurable | Proposed default to be set after measurement |
| Cleanup retention | Quarantine then delete | Proposed; owner decision |
| Localization | English | Future locales |

### 7.2 Deletion policy

- The UI must never say content was deleted from QDN.
- Default: mark withdrawn locally and hide from the site.
- Optional: publish a tombstone/withdrawn marker to the same identifier, with an
  explicit warning that older bytes remain retrievable on the network.
- Keep an audit record of every withdrawal.

### 7.3 Authority and publication policy

- Publication requires the current owner of the target name.
- The desktop app never signs; the host does.
- Every publish is user-initiated and approved.
- Partial results are reported truthfully and are not automatically retried.
- Fees and target names are shown before approval.

## 8. Traceability to the 20 required capabilities

| # | Required capability | Requirements | Status after Phase 0 |
| --- | --- | --- | --- |
| 1 | Guided graphical desktop application | PRJ-03, DES-01 | Not implemented |
| 2 | Multiple independent migration projects | PRJ-01, PRJ-02, PRJ-04 | Not implemented |
| 3 | WordPress API discovery and connection checks | SRC-02, SRC-03 | CLI-level only |
| 4 | Full WordPress content migration | SRC-03..SRC-05, MOD-01..MOD-05 | Corbett-specific pipeline exists |
| 5 | Incremental synchronization of new and modified content | SYN-01..SYN-05 | New content partial; modified missing |
| 6 | Persistent source-to-QDN identity mapping | IDM-01, IDM-02 | Implicit only |
| 7 | Duplicate prevention and conflict protection | IDM-03..IDM-06 | Partial (cursors/CMS key) |
| 8 | Configurable batch sizes, including 15 | BAT-02 | Env-supported, not productized |
| 9 | Download limits and available-disk protection | BAT-04, BAT-05, MED-03 | Warning only |
| 10 | Safe cleanup of verified completed batches | REC-04..REC-06, MED-06 | Coarse cleanup exists |
| 11 | Persistent migration history after cleanup | BAT-07, REC-06 | Receipts only |
| 12 | Crash recovery, retry and resume | REC-01..REC-03 | Batch retry only |
| 13 | Integrated QDN publication where feasible | PUB-01..PUB-09 | Hub Q-App handoff exists |
| 14 | Secure signing through supported Qortal mechanisms | PUB-03, PUB-05 | Hub-mediated; no keys collected |
| 15 | No private-key collection | PUB-03, 6.3 | Satisfied by current design; verify in new UI |
| 16 | Default generic Qortal CMS/website | CMS-01, CMS-02 | Not implemented (Corbett only) |
| 17 | Optional custom website clones/templates | CMS-03 | Not implemented |
| 18 | Future adapters without rewriting publisher | SRC-01, SRC-07 | Not implemented |
| 19 | Self-contained Linux install (.deb) | DES-02, 6.6 | Not implemented |
| 20 | English UI/docs, future localization | DES-04, DES-05 | English only, hard-coded |

## 9. Release acceptance criteria (product level)

A first public release is acceptable only when all of the following hold:

1. A clean Debian-based system installs the `.deb` and runs the app without
   Node.js, npm or Git installed.
2. A new user can create two projects, run a 15-post dry plan, prepare a batch,
   publish through the supported Qortal mechanism, verify exact resources, and
   clean up one project without affecting the other.
3. A crash/power-loss simulation during fetch, download and publish resumes
   without duplicate QDN resources or corrupt state.
4. Disk-full and download-limit tests pause safely and leave resumable state.
5. A modified old post is detected and updates the same QDN identity; an
   unchanged post is not republished.
6. The default generic CMS builds and renders all primary routes with honest
   empty/partial/error states; imported HTML is sanitized.
7. No private key, seed or wallet password is requested or logged anywhere.
8. The Corbett compatibility profile still produces its existing identifiers
   and workflows.
9. Automated tests, packaging checks and an owner-authorized live validation on
   the chosen network pass.
10. Documentation, support boundaries and known limitations are published.

**Passing this audit or the roadmap does not itself satisfy these criteria.**

## 10. Open product decisions

The following block implementation choices and require owner input (also listed
in the audit):

1. Accepted publication model: Hub handoff only, or also Hub Dev Mode loopback?
2. Qortal network(s) and names for development/acceptance; who authorizes writes.
3. Default generic CMS identity, branding, license and identifier prefix.
4. Direct catalog serving vs CMS adoption as the default import experience.
5. Withdrawal policy: local hide, tombstone, or both.
6. Disk reserve, download caps, retention/quarantine duration.
7. Import scope: drafts/private content, users, comments, menus, custom types,
   redirects, SEO.
8. WordPress auth policy (application password required vs session fallback).
9. Telemetry/error reporting policy.
10. Windows timeline and supported versions.
11. Localization roadmap.
12. `.deb` signing/update trust model.
13. Compatibility guarantee for Corbett and AstuAeda identifiers.
14. Product naming/trademark/support ownership.

## 11. What this document does not claim

This is a requirements baseline derived from an architecture audit. It does not
claim that the current toolkit meets these requirements, that Qortal supports a
standalone desktop signer, or that any migration/publication is complete. The
current Corbett workflow is a valuable proof and regression baseline, not the
target product.
