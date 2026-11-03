# Implementation Roadmap — Qortal Migration Studio

| Field | Value |
| --- | --- |
| Document | Implementation roadmap |
| Product working name | Qortal Migration Studio |
| Executing agent | DeepSeek (`opencode-development` profile) |
| Date | 2026-11-02 |
| Status | Phase 0–4 implemented on dedicated agent branches (Phase 4 desktop prototype); Phases 5–10 not started |
| Companion documents | [Audit](PHASE-0-ARCHITECTURE-AUDIT.md), [Requirements](PRODUCT-REQUIREMENTS.md), [Architecture](ARCHITECTURE.md) |

## 1. How to use this roadmap

- Phases are ordered by dependency, not by visual polish.
- Each phase has one primary outcome, explicit deliverables and measurable exit
  criteria.
- A phase is not complete because code compiles or a demo looks right. It is
  complete when its acceptance criteria are evidenced.
- Later phases may overlap in research, but implementation should not skip the
  engine/state foundation.
- The current Corbett pipeline is a compatibility baseline; refactors must keep
  it working or provide an explicit migration path.

**Priority legend:** P0 = blocking first release; P1 = required for a credible
public release; P2 = follow-up/expansion.

## 2. Phase summary

| Phase | Outcome | Priority | Depends on |
| --- | --- | --- | --- |
| 0 | Architecture audit and plan | P0 | — |
| 1 | Engine foundation, projects, state, events | P0 | 0 |
| 2 | Generic WordPress adapter and content model | P0 | 1 |
| 3 | Planning, media, disk, identity and dedupe | P0 | 1–2 |
| 4 | Desktop shell and Linux packaging prototype | P0 | 1–3 |
| 5 | Hub-mediated publication and verification | P0 | 1–4 |
| 6 | Generic CMS/site template | P0 | 1–2, 5 |
| 7 | Incremental sync, withdrawal and conflicts | P1 | 2–5 |
| 8 | Recovery, cleanup, history hardening | P1 | 1–5 |
| 9 | Production `.deb`, release automation, security review | P1 | 4–8 |
| 10 | Future adapters, Windows, localization | P2 | stable core |

## 3. Phase 0 — Architecture audit (complete)

**Outcome:** verified baseline, constraints, target architecture and plan.

**Deliverables:** the four documents in `docs/migration-studio/`.

**Exit criteria:**

- [x] Current repository capabilities and gaps audited with file references.
- [x] Qortal Core/Hub integration reviewed and labeled verified vs unverified.
- [x] Standalone signing feasibility assessed honestly.
- [x] Common content model, adapter contract, state machines and cleanup safety
  designed.
- [x] Phased roadmap with acceptance criteria and open owner decisions.
- [x] No source, test, dependency, profile, QDN or wallet changes.
- [x] Existing checks still pass (`npm test`, `npm run check`; 15/15 tests).

**Explicit non-claim:** Phase 0 does not prove production readiness or migration
correctness.

## 4. Phase 1 — Engine foundation, projects, state and events (P0)

> **Status (2026-11-02):** implemented on a dedicated agent branch; see
> [`PHASE-1-ENGINE.md`](PHASE-1-ENGINE.md) for the shipped API, storage format,
> acceptance evidence and known limits. Phase 2 has not started.

**Outcome:** a reusable engine with multiple independent projects, crash-safe
state, structured progress and a stable host protocol.

### Deliverables

- Extract engine modules from the CLI scripts without changing behavior:
  config/profile loading, source client, conversion, media, validation, QDN
  planning.
- Project registry and per-project storage roots; project create/open/archive.
- Project lock with stale-lock recovery.
- SQLite (or journal+snapshot) state store with schema version and migrations.
- `qms-event@1` event stream and `qms-project@1`/`qms-content@1` initial schemas.
- JSON-RPC/IPC host with request/response and event channels.
- Thin CLI compatibility wrappers for the existing commands.
- Test harness: temp projects, fake clock, fake fetch, in-memory/transactional
  store.

### Acceptance criteria

1. **AC1.1** Two projects can be created with distinct roots, settings and state;
   operations in one do not read or write the other.
2. **AC1.2** Closing and reopening the app restores both projects and their last
   run state exactly.
3. **AC1.3** A simulated crash (process kill) during planning, fetch and download
   leaves a valid state that resumes without duplicate files or duplicate QDN
   identities.
4. **AC1.4** A second writer is refused by the project lock; stale lock recovery
   is explicit and tested.
5. **AC1.5** State schema migration from an older fixture succeeds; an unknown
   newer schema fails closed with a clear message.
6. **AC1.6** Every long operation emits ordered events with stable codes; a
   renderer can reconstruct progress from events plus a snapshot.
7. **AC1.7** Existing unit tests pass; existing CLI commands still work through
   compatibility wrappers.
8. **AC1.8** No Electron dependency exists in engine modules.

### Risks / notes

- SQLite native module packaging must be proven on the target Electron/Node
  version before committing to it.
- Do not port the current `spawnSync` orchestration into the engine.

## 5. Phase 2 — Generic WordPress adapter and common content model (P0)

**Outcome:** WordPress is one adapter behind a versioned contract; the engine no
longer contains Corbett-specific assumptions.

### Deliverables

- `SourceAdapter` contract and capability report.
- WordPress adapter covering posts, pages, categories, tags, media, featured
  media, application-password and session auth.
- Versioned `qms-content@1` normalization with stable source keys and content
  hashes.
- Capability/unsupported-content reporting.
- Adapter conformance suite and fixture WordPress server.
- Corbett compatibility adapter/profile that preserves `cr-*` identifiers and
  current output.

### Acceptance criteria

1. **AC2.1** The WordPress adapter passes the shared conformance suite.
2. **AC2.2** A fixture site with posts, pages, terms and media produces a
   complete normalized dataset with stable source keys and hashes.
3. **AC2.3** Re-running normalization on unchanged fixtures produces identical
   content hashes.
4. **AC2.4** Colliding slugs, HTML entities, lazy images, `srcset`, audio,
   video, documents, iframes and external links are preserved/extracted
   correctly.
5. **AC2.5** Unsupported/custom content types are reported, not silently dropped.
6. **AC2.6** No engine module imports a WordPress-specific field outside the
   adapter.
7. **AC2.7** The Corbett compatibility profile still emits the existing `cr-*`
   identifiers and route rewrites (golden fixtures).
8. **AC2.8** Existing 15 tests plus new adapter tests pass.

### Implementation evidence (Phase 2)

Phase 2 is implemented on a dedicated agent branch. Evidence is recorded in
[`PHASE-2-WORDPRESS-ADAPTER.md`](PHASE-2-WORDPRESS-ADAPTER.md):

- SourceAdapter contract, registry and a non-WordPress fixture adapter pass the
  same engine discovery path.
- WordPress posts, pages, categories, tags, media, featured media, lazy images,
  srcset, relative/absolute URLs, audio, video, documents, embeds and external
  links are normalized into `qms-content@1`.
- Deterministic hashes, stable source identity, duplicate slugs and slug renames
  are covered by tests.
- Custom post types and unsupported features are reported with counts.
- Corbett golden fixtures prove legacy post/page output and route rewriting are
  byte-identical; `cr-*` identifiers are unchanged.
- 102/102 repository tests pass. No live migration or QDN publish was performed.

Phase 2 deliberately does not implement media download, planning, cleanup or
publication; those remain Phase 3.

## 6. Phase 3 — Planning, media, disk, identity and dedupe (P0)

**Outcome:** a safe batch planner with enforceable disk/download limits, a
persistent identity map, duplicate prevention and conflict detection.

### Deliverables

- Batch planner with configurable size, including 15.
- Classification: new/modified/unchanged/withdrawn/conflict/error.
- HEAD-based media estimates + per-run/per-file caps + disk reserve preflight.
- Streaming downloads with `.part`, hash, atomic rename and resumable state.
- Content-addressed asset store and reference counts.
- `qdn_mappings` persistence and stable identifier derivation.
- Conflict records and resolution API.
- Plan/review UI data model (even if the UI is not final yet).

### Acceptance criteria

1. **AC3.1** A project can plan exactly 15 posts per batch; invalid values are
   rejected with a clear error.
2. **AC3.2** The plan shows item/media counts, known/unknown bytes, estimated
   fee, free space, reserve and whether the run fits.
3. **AC3.3** When projected size + reserve exceeds free space, the run refuses
   or reduces scope; no download starts.
4. **AC3.4** Per-run file/byte caps and per-file caps are enforced; the run pauses
   with resumable state.
5. **AC3.5** Interrupted downloads never leave a valid-looking final file;
   re-run recovers or re-downloads correctly.
6. **AC3.6** The same media referenced by multiple items is stored once and
   reference-counted.
7. **AC3.7** An unchanged item is classified unchanged and is not republished.
8. **AC3.8** A modified item updates the same QDN triple; a target collision
   creates a conflict, not a silent overwrite.
9. **AC3.9** A project lock prevents concurrent publication of the same identity.
10. **AC3.10** Disk-full and limit tests leave the project recoverable.

### Implementation evidence (Phase 3)

Phase 3 is implemented on a dedicated agent branch from the verified Phase 2
commit `f34e5229dd0eee1cef5d611f57569d6c72920d01`. Evidence is recorded in
[`PHASE-3-PLANNING-MEDIA-IDENTITY.md`](PHASE-3-PLANNING-MEDIA-IDENTITY.md):

- automatic immutable `site_id`, project-scoped QDN namespace, stable
  service/name/identifier mappings, explicit target migration and conflict
  resolution;
- default 15-item deterministic plans with date/modified filters, classification
  (new/modified/unchanged/route_changed/conflict/error/unsupported), plan
  persistence and restart-safe retrieval;
- 10 GiB default reserve, per-run/per-file/file-count caps, bounded unknown-size
  policy, filesystem-specific preflight and runtime disk enforcement;
- streaming media downloads with `.part` resume, SHA-256 verification, atomic
  finalization, content-addressed dedupe, reference counts and receipts;
- host/CLI operations for identity, plan, media and disk inspection;
- 37 new Phase 3 tests, 139/139 total, plus viewer and CMS builds in
  `npm run check`. No live WordPress migration or QDN publish was performed.

Phase 3 deliberately stops before publication and destructive cleanup. Phase 4
still requires the desktop shell, packaging, keyring integration and real
operator workflows.

## 7. Phase 4 — Desktop shell and Linux packaging prototype (P0)

**Status: implemented as a prototype (2026-11-03).** See
[PHASE-4-DESKTOP-GUI.md](PHASE-4-DESKTOP-GUI.md). The engine, secure Electron
shell, wizard, plan review, progress, history/diagnostics and `.deb` build are
implemented and tested with fixtures. Full `dpkg -i` installation in a graphical
VM and keyring persistence remain unverified.

**Outcome:** a usable guided desktop app on Debian-based Linux, without requiring
Node/npm/Git, with a first-run project flow.

### Deliverables

- Electron shell with context isolation, sandboxing and narrow preload API.
- Wizard: source, connection, target names, template, first plan.
- Plan/review, progress, pause/resume, errors and diagnostics views.
- Secure secret storage integration (OS keyring; fallback warning).
- Engine packaged with the app; no external runtime.
- `electron-builder`/equivalent `.deb` prototype.
- Desktop entry, icons, XDG storage paths and uninstall behavior.

### Acceptance criteria

1. **AC4.1** A clean Debian/Ubuntu VM with no Node.js/npm/Git installs the
   `.deb` and launches from the desktop menu. **Partially verified:** the package
   was extracted with `dpkg-deb -x` and launched headlessly with no Node/npm/Git
   in PATH; a full graphical `dpkg -i` install remains unverified.
2. **AC4.2** First-run wizard reaches a validated project and a 15-post dry plan
   without a terminal.
3. **AC4.3** The UI stays responsive during scan/download; progress and errors
   are visible and cancellable.
4. **AC4.4** No private key/seed/wallet password field or log exists.
5. **AC4.5** Renderer has no direct Node/filesystem/network access; preload API
   is allowlisted and validated.
6. **AC4.6** Secrets are stored in the OS keyring; logs/diagnostics redact them.
   **Partially verified:** diagnostics redaction and session-only fallback are
   tested; a real desktop keyring session was not available.
7. **AC4.7** Uninstall preserves user projects unless explicitly removed.
8. **AC4.8** The `.deb` includes engine version metadata and a support bundle
   command. **Partially verified:** engine/desktop versions are exposed and
   metadata-only diagnostics export exists; there is no separate CLI support
   bundle command.

## 8. Phase 5 — Hub-mediated publication and verification (P0)

> **Phase 5 implementation note (2026-11-03):** Variant A is implemented:
> portable `qms-publication-handoff@1` packages, universal Publisher Q-App,
> controlled <=20 batches, exact base64 read-back, receipt import and desktop
> verification. Local tests pass; a real Hub-signed live publication remains
> unverified until an authorized live test is run. See
> [PHASE-5-QDN-PUBLISHING.md](PHASE-5-QDN-PUBLISHING.md).

> **Phase 5.2 implementation note (2026-11-03):** A development-only policy
> broker for autonomous QDN test publication is implemented in `broker/` with
> Ed25519 request authentication, exact-name/owner/service/identifier/payload
> policy, atomic fee budgets, crash-safe state, hash-chained audit and an
> operator Unix-socket kill switch. It calls External Auth only through
> `POST /qdn/publish` and reuses Phase 5 exact read-back. Deterministic tests
> pass. Live deployment is blocked on signing-host provisioning, External Auth
> installation and operator wallet unlock; no wallet or QDN write occurred. See
> [PHASE-5.2-TEST-PUBLISHING-BROKER.md](PHASE-5.2-TEST-PUBLISHING-BROKER.md).

**Outcome:** a truthful, resumable publication flow that prepares resources,
hands off to Qortal Hub, and verifies exact QDN content without collecting keys.

### Deliverables

- Publish plan with service/name/identifier/path/hash/bytes/fee.
- Publisher adapter modes: `dry-run`, `hub-handoff`, optional `hub-devserver`,
  `disabled`.
- Portable handoff folder and instructions.
- Generic or project-scoped Migration Publisher Q-App handoff.
- Chunked multi-publish (≤20), unconfirmed-transaction awareness and partial
  result normalization.
- Read-back verification of exact `(service,name,identifier)` and content hash.
- Per-resource states: prepared/handoff_ready/submitted/confirmed/verified/
  partial/failed/ambiguous/declined.
- Publication history and retry only for explicit failed resources.

### Acceptance criteria

1. **AC5.1** A dry-run plan blocks missing files, invalid identifiers (>64),
   missing services, wrong target names and duplicate identities.
2. **AC5.2** A prepared handoff contains everything the publisher needs and no
   secrets.
3. **AC5.3** A selected publish set is chunked so no request exceeds the safe
   batch limit; unconfirmed limits are respected.
4. **AC5.4** Thrown and resolved partial results (`error.unsuccessfulPublishes`)
   produce per-resource partial/failed states; no auto-retry.
5. **AC5.5** A resource is `verified` only when an exact read-back matches the
   intended content hash/schema; `READY`/approval alone is insufficient.
6. **AC5.6** Derived indexes/manifests are published after content and verified;
   a failed index creates a repair task without rolling back content.
7. **AC5.7** Wrong-name/ownership failures are shown before approval.
8. **AC5.8** No private key/seed/password is requested, stored or logged.
9. **AC5.9** Publication history survives app restart and reports submission,
   verification, tx signature (if available) and errors.
10. **AC5.10** An owner-authorized live test on the chosen Qortal network
    verifies at least one synthetic resource end-to-end (read-only verification
    is mandatory; the write requires explicit authorization).

## 9. Phase 6 — Generic CMS/site template (P0)

**Outcome:** a neutral, production-quality default Qortal CMS/site plus a
custom-template mechanism; Corbett remains a custom clone.

### Deliverables

- Generic template package with config, routes, theme tokens, nav/footer,
  content repository, manifest adapter, admin/import view.
- Versioned `qms-cms-manifest@1` compatibility layer for `cr-qdn-manifest`.
- Sanitized HTML rendering with a maintained sanitizer.
- Owner/coauthor detection via current name ownership.
- Sane loading/empty/partial/stale/error states.
- Template compatibility check and build command.
- Corbett custom template/profile preserving current experience and identifiers.

### Acceptance criteria

1. **AC6.1** A new project can build a neutral site with configurable title,
   tagline, navigation and colors; no Corbett strings/identifiers are required.
2. **AC6.2** Home, post, page, category, tag, archive, search and admin/import
   routes render from a fixture manifest.
3. **AC6.3** Missing/stale/partial catalog states are visible and do not render
   as false emptiness.
4. **AC6.4** Malicious HTML/URL fixtures are sanitized; script/event handlers and
   dangerous schemes do not execute.
5. **AC6.5** Owner mode works only when the current account owns `_qdnName`;
   non-owner sees read-only.
6. **AC6.6** The Corbett clone retains its public routes, branding and import/
   adoption behavior with golden fixtures.
7. **AC6.7** Template build produces a valid root-layout Q-App bundle; no engine
   code is imported into the template.
8. **AC6.8** Accessibility checks pass for primary flows.

## 10. Phase 7 — Incremental sync, withdrawal and conflicts (P1)

**Outcome:** true ongoing synchronization, not just historical batches.

### Deliverables

- Modified watermark + overlap window, optional full reconciliation.
- Source deletion/unpublication detection.
- Withdrawal policy: local hide, optional tombstone republish.
- Conflict queue and resolution UI.
- Delta plans and delta publication.
- Reconciliation report for orphaned mappings/indexes.

### Acceptance criteria

1. **AC7.1** A new post since the last sync is detected and published once.
2. **AC7.2** A modified old post (older than the latest new-post cursor) is
   detected via modified watermark/overlap or reconciliation.
3. **AC7.3** An unchanged post is not republished.
4. **AC7.4** A source deletion is reported honestly; the UI does not claim the
   QDN resource was deleted.
5. **AC7.5** Withdrawal policy hides/withdraws per configuration and records an
   audit entry.
6. **AC7.6** A source/QDN/local conflict is persisted, displayed and resolved
   with an audited choice.
7. **AC7.7** A failed source scan cannot be reported as "no changes".
8. **AC7.8** An unreadable/partial derived index is not blindly rewritten from an
   incomplete view.

## 11. Phase 8 — Recovery, cleanup and history hardening (P1)

**Outcome:** crash-safe recovery, verified cleanup and durable history suitable
for long-lived projects.

### Deliverables

- Run journal/checkpoints and resume across all steps.
- Two-phase cleanup with quarantine and retention.
- Reference-counted shared media (from Phase 3) enforced at cleanup.
- Receipts with hashes, mappings, publication evidence and errors.
- History UI that survives cleanup.
- Support bundle/export with redaction.
- Fault-injection tests for kill, disk-full, network loss and partial publish.

### Acceptance criteria

1. **AC8.1** Kill during each run step resumes without duplicate downloads or
   publications.
2. **AC8.2** Cleanup is refused for unverified/partial/failed runs.
3. **AC8.3** Cleanup never deletes shared/referenced media.
4. **AC8.4** Receipts are written before deletion and remain readable.
5. **AC8.5** History shows what was migrated/published/verified/deleted locally
   after cleanup.
6. **AC8.6** Support bundle contains no secrets, cookies, keys or content bodies.
7. **AC8.7** Quarantine restore works within the retention window.
8. **AC8.8** No cleanup can escape the project root via symlink/path tricks.

## 12. Phase 9 — Production `.deb`, release automation and security review (P1)

**Outcome:** a reproducible, signed, self-contained release process.

### Deliverables

- Clean-build pipeline with locked dependencies and full checks.
- `.deb` production artifact with engine, renderer and templates.
- SBOM, checksums, provenance, signed artifacts.
- Version synchronization across app, engine, templates and docs.
- Clean-VM install/smoke matrix.
- Security review: renderer isolation, local services, secrets, SSRF, path
  traversal, sanitizer, dependency audit.
- Release notes and known limitations.

### Acceptance criteria

1. **AC9.1** Clean checkout builds the `.deb` reproducibly (same inputs produce
   equivalent output/checksums within documented constraints).
2. **AC9.2** Install and primary flows pass on at least two Debian-based
   distributions.
3. **AC9.3** Full test suite, packaging checks and security checks pass.
4. **AC9.4** Artifact checksum/SBOM/provenance match the source commit.
5. **AC9.5** No secrets or generated test data are in the artifact.
6. **AC9.6** Release state is recorded separately from install/verification.
7. **AC9.7** An owner-authorized validation passes on the chosen Qortal network.

## 13. Phase 10 — Future adapters, Windows and localization (P2)

**Outcome:** expansion without rewriting the engine.

### Deliverables

- Joomla adapter and conformance fixtures.
- Wix adapter and conformance fixtures.
- Windows shell/packaging (reusing the engine/protocol).
- Localization framework and first additional locale(s).
- Optional advanced modes (Hub Dev Mode) if owner-approved.
- Template marketplace/import mechanism if desired.

### Acceptance criteria

1. **AC10.1** A second adapter passes the shared conformance suite without
   publisher/identity/cleanup changes.
2. **AC10.2** A third adapter demonstrates the same contract.
3. **AC10.3** Windows installer runs the same primary flows.
4. **AC10.4** UI strings are externalized; locale switch works without code
   changes.
5. **AC10.5** Regression suite still passes for WordPress/Corbett.

## 14. Prioritized backlog (P0/P1/P2)

### P0 — first credible release

1. Engine extraction, projects, lock, SQLite/journal, events.
2. Generic WordPress adapter + content model + compatibility profile.
3. Planner with 15-post batches, disk/download limits, media hash/dedupe.
4. Identity map, duplicate prevention, conflict records.
5. Electron shell, secure preload, keyring, `.deb` prototype.
6. Hub handoff publisher, chunking/partial handling, read-back verification.
7. Generic CMS template + Corbett clone + sanitizer.
8. Crash-safe resume and verified cleanup (minimum viable).
9. Packaging/release checks.

### P1 — public-release hardening

- Modified-content sync and withdrawal policy.
- Two-phase cleanup/quarantine and ref counts.
- History UI and support bundles.
- Security review and fault-injection suite.
- Signed/reproducible release.
- Accessibility and documentation.

### P2 — expansion

- Joomla/Wix adapters.
- Windows.
- Localization.
- Optional Hub Dev Mode.
- Template distribution/import.

## 15. Definition of done per implementation task

A task is done only when:

1. The change is scoped to one outcome and reviewed.
2. Unit/contract/integration tests pass.
3. Required state migrations are tested.
4. No secret/key collection or logging was introduced.
5. Progress/error states are truthful (no false completion).
6. Existing Corbett regression fixtures still pass.
7. Documentation and versioned formats are updated.
8. External writes (publish/commit/push/release) have explicit authorization.

## 16. Release gates

| Gate | Requirement |
| --- | --- |
| G0 — Engine | Projects, state, events, adapters and tests pass |
| G1 — Migration | WordPress full + incremental fixtures pass |
| G2 — Safety | Disk, crash, cleanup and security tests pass |
| G3 — Publication | Hub handoff + exact verification pass |
| G4 — CMS | Generic template + Corbett clone pass |
| G5 — Packaging | Clean-VM `.deb` install/run passes |
| G6 — Release | Signed artifact, checksums/SBOM, owner acceptance |

No gate may be skipped because a later gate passed. A passing build or a
successful QDN publish is not a substitute for exact read-back verification or
owner acceptance.

## 17. Next implementation phase

**Recommended next phase: Phase 1 — Engine foundation, projects, state and
events.**

Why:

- Every other requirement depends on multiple projects, crash-safe state and a
  structured engine API.
- Building the GUI first would encode the current single-project `state.json`
  and `spawnSync` model into the product.
- Building the publisher first would be blocked by the missing project/identity
  foundation and would risk another Hub-only workflow.
- The existing Corbett pipeline can be preserved as a compatibility wrapper
  while the engine is extracted.

Phase 1 should begin with a bounded spike to choose SQLite vs journal+snapshot
and to prove native module packaging in the target Electron version. That spike
is an implementation decision, not a new architecture phase.

## 18. Open decisions that block or shape phases

| # | Decision | Blocks |
| --- | --- | --- |
| D1 | Accept Hub-mediated publication as v1 model? | Phase 5, product promise |
| D2 | Allow optional Hub Dev Mode loopback mode? | Phase 5/10 security design |
| D3 | Qortal network(s)/names and write authorization | Phase 5 live acceptance |
| D4 | Default generic CMS identity/branding/license/prefix | Phase 6 |
| D5 | Direct catalog serving vs CMS adoption default | Phase 6 |
| D6 | Withdrawal policy (hide/tombstone/both) | Phase 7 |
| D7 | Disk reserve, download caps, retention | Phases 3, 8 |
| D8 | Import scope (drafts/private/users/comments/menus/custom types) | Phase 2 |
| D9 | WordPress auth policy | Phase 2 |
| D10 | Telemetry/crash reporting | Phase 4/9 |
| D11 | Windows timeline/versions | Phase 10 |
| D12 | Localization roadmap | Phase 10 |
| D13 | `.deb` signing/update trust model | Phase 9 |
| D14 | Corbett/AstuAeda compatibility guarantee | Phases 2, 6 |
| D15 | Product naming/trademark/support ownership | Phase 4+ |

## 19. Roadmap risks

- **Scope creep into a general web migration platform.** Keep the first release
  WordPress + generic Qortal CMS; add adapters later.
- **Underestimating Qortal publication UX.** Hub handoff is a real user flow with
  fees and approvals; it needs design and testing, not just an API call.
- **Underestimating cleanup/data integrity.** Cleanup is the most dangerous local
  operation; invest in ref counts and receipts.
- **Packaging surprises.** Native modules, Chromium sandbox and `.deb` dependency
  differences can consume a phase; prototype early.
- **Compatibility drift.** Corbett/AstuAeda behavior must be pinned with golden
  fixtures before refactoring.
- **False confidence from the existing Corbett success.** A working single-site
  pipeline is not evidence of multi-project, incremental or generic behavior.

## 20. What this roadmap does not claim

This is a plan. Phase 0 is complete as an audit; no implementation phase has been
executed. The current toolkit is operational for the existing Corbett workflow,
but the target product is not production ready, and no phase in this roadmap
should be reported as complete without its acceptance evidence.
