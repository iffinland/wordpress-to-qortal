# Phase 5.1 — Qortal name validation correction

Status: implementation and local verification complete. No live node, wallet,
transaction or QDN publish was used.

## 1. Confirmed defect

Phase 5 rejected any Qortal display name that did not match an ASCII
letter/digit/underscore/hyphen regex. The real registered name
`developer iffi` (owner `QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E`) was therefore
rejected even though Qortal Core returned it as a registered name.

The old rule was a local invention. Qortal Core has no such whitelist.

## 2. Qortal Core rule audit

Audited from `github.com/Qortal/qortal`, default branch commit
`108bf191d42d710ec617f535af30cfd82fc03c87`, project version 6.1.9:

- `src/main/java/org/qortal/naming/Name.java`
  - `MIN_NAME_SIZE = 3`, `MAX_NAME_SIZE = 40`.
- `src/main/java/org/qortal/transaction/RegisterNameTransaction.java`
  - `Utf8.encodedLength(name)` must be 3..40 (UTF-8 bytes, not Java chars).
  - `name.equals(Unicode.normalize(name))` is required, otherwise
    `NAME_NOT_NORMALIZED`.
  - `Crypto.isValidAddress(name)` is rejected as `INVALID_ADDRESS`.
  - There is no character whitelist.
- `src/main/java/org/qortal/utils/Unicode.java`
  - `normalize()`: NFKC, remove zero-width characters
    (U+200B, U+200C, U+200D, U+2060, U+FEFF), trim and collapse all
    Unicode whitespace to one ASCII space.
  - `sanitize()`: NFKD, remove zero-width characters, trim/collapse
    whitespace, strip marks/Other, lowercase with `Locale.ROOT`, then reduce
    homoglyphs. This is Core's `reducedName`.
- `src/main/java/org/qortal/naming/Name.java` and
  `src/main/java/org/qortal/api/resource/NamesResource.java`
  - The stored display `name` is the exact registered string.
  - `reducedName` is the uniqueness/search key. `GET /names/{name}`
    sanitizes the request to a reduced key and returns the exact display
    `name` plus `owner`.

Consequences:

- Internal single spaces are valid.
- Non-ASCII letters are valid.
- Leading/trailing whitespace is invalid because normalization trims it.
- Repeated or non-space whitespace is invalid because normalization collapses
  it.
- Decomposed/compatibility Unicode is invalid unless it is already the NFKC
  display form.
- Uniqueness is reducedName-based (case/homoglyph folding); identity is the
  exact display name.

## 3. Implemented validator

`lib/engine/qortal-name.js` is the engine source of truth. Mirrors exist in
`desktop/src/shared/qortalName.ts` and `viewer/src/publisher/name.ts`.

The validator:

1. Requires a non-empty string.
2. Computes Core's display normalization and rejects any input that is not
   already byte-for-byte that display form (no silent trimming).
3. Rejects Unicode control characters and unpaired UTF-16 surrogates as
   defensive hardening beyond Core.
4. Enforces 3..40 **UTF-8 bytes** via `TextEncoder`, so `é`.repeat(20) is
   40 bytes and valid, while `é`.repeat(21) and `日`.repeat(14) are rejected.
5. Rejects address-shaped names (`^Q[1-9A-HJ-NP-Za-km-z]{33}$`) as a
   conservative lookalike guard for Core's checksum-based address rejection.
6. Returns the exact input string. It never returns normalized text and never
   computes or stores `reducedName`.

`validateQortalName()` throws `TARGET_NAME_INVALID` (or
`TARGET_NAME_REQUIRED`) with `details.reason`, `minBytes`, `maxBytes`,
`utf8Bytes` and the normalization preview.

## 4. Exact display name vs reducedName

- Handoff manifest target and every resource `name` use the exact display
  name.
- Receipts, Publisher comparisons and ownership checks use the exact display
  name.
- `reducedName` is never accepted as identity. Qortal may return it for
  lookup/uniqueness, but a different returned `name` blocks ownership even if
  the reduced key matches.
- Ownership requires `record.name === requestedName` and
  `record.owner === expectedAddress`. Every other outcome is `blocked`
  (`NAME_MISMATCH`, `OWNER_MISMATCH`, `NAME_NOT_FOUND`,
  `NODE_UNREACHABLE`, authorization or invalid response).

## 5. URL path encoding

QDN names are raw path segments and are encoded exactly once with
`encodeURIComponent`:

- `developer iffi` -> `developer%20iffi`
- `Café` -> `Caf%C3%A9`
- `a+b` -> `a%2Bb`
- `100% name` -> `100%25%20name`

Space is never `+`. A raw percent is escaped, so callers must not pass an
already-encoded name. Ownership lookup and exact read-back use the same helper;
no double encoding.

## 6. Verification evidence

Deterministic fixtures and mocked HTTP only; no live node was contacted.

- `test/phase5/name-rules.test.js` covers exact preservation of
  `developer iffi`, Unicode/NFKC, UTF-8 boundaries, whitespace/control
  rejection, reducedName non-identity, owner mismatch/missing/unreachable,
  handoff and Publisher handoff validation, and URL encoding.
- Core name fixture: `GET /names/developer%20iffi` returns exact
  `name=developer iffi`, `owner=QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E`;
  lookup is `verified`.
- Desktop IPC validation accepts `developer iffi` and `Café 日本語`,
  rejects non-NFKC/control/double-space input and >40 UTF-8 bytes.
- Publisher `evaluateNameOwnership` requires exact name and exact owner;
  case-folded, wrong-owner and owner-less entries are blocked.

## 7. Remaining uncertainty

- Java's `java.text.Normalizer`/Guava whitespace data and V8's
  `String.normalize`/`p{White_Space}` can differ for Unicode characters
  assigned after the Java runtime's Unicode version. Stable, already-assigned
  characters used in the tests agree; a future Core Unicode upgrade should be
  re-audited.
- The address guard is a shape check, not a Base58Check implementation. It can
  reject a 34-character Q-prefixed name that Core would accept; this is a
  deliberate, documented safety trade-off for a name space where such a
  collision is implausible.
- Core also rejects AT-style addresses through `Crypto.isValidAddress`; the
  local guard covers normal `Q...` addresses only.
- Core's homoglyph table is not reproduced locally because reducedName is
  deliberately not used for identity, ownership or handoff validation.
