# Site continuation and cumulative publication catalogs

## Product behavior (0.8.0 rc.3)

Use **Continue existing QMS site** on the dashboard, or **Continue this site**
on its project card, for every batch of one WordPress migration. This opens the
original durable project and preserves its immutable `siteId`, derived namespace,
source mappings and verified publication history. No identity is typed or guessed.
**New site/project** intentionally creates a separate identity and catalog, even
when its Qortal name matches another project's destination. The dashboard warns
about that match and lists the site identity and namespace for explicit selection.

A published site whose project is not on this machine must be continued by
restoring its original QMS workspace. `sync.adoptExisting()` reconciles the
existing project's mappings; it does not import a remote namespace into a newly
created project. Automatic recovery from an arbitrary QDN name is not implemented.
Legacy manifests can have `site_id: null`; never infer an identity from that.
New manifests embed the real `site_id`; existing CMS configurations already embed
`site.id` and `content.manifestIdentifier`, and import manifests contain the site
ID, namespace and target. These are stable evidence for future verified recovery,
not permission to silently replace a local identity.

## Authority and publication flow

Phase 5 builds posts/pages, taxonomy, URL, media and full-text search indexes from
Phase 7's `sync.catalog({ resources: true })` plus the selected batch. The merge
uses stable source keys: A15 then B15 gives 30 imported entries; modifying A3
replaces its existing logical entry and QDN triple. Only the selected new/modified
content and unverified media are handed to the Publisher. Previous content and
media remain catalog references, not additional publication requests.

A mapping's current planned hash is distinct from its last exact published
revision. Only independent exact QDN read-back records `verifiedPublication`
(handoff ID, exact resource descriptor, required verified media and timestamp).
A new plan preserves that snapshot but resets the new revision's publication
status. Preparing or importing a Publisher receipt cannot advance public authority.
Reverification and receipt import update the handoff's own revision; their shared
resource IDs cannot accidentally verify a newer prepared payload.

Verified snapshot descriptors and mappings are authoritative durable state.
Hash-checked payload files remain in the retained handoffs; full bodies are not
copied into the state journal. The catalog is reconstructed from those records,
not the most recent temporary handoff. Pre-upgrade projects recover their verified
revision from the original handoff's independent verification state. Content with
unverified required media is excluded, and missing/corrupted retained evidence
fails closed. Withdrawn/skipped mappings stay excluded by the existing rules.
Explicit target migration clears authority for the old triple while keeping its
historical handoffs and receipts; it never relabels old evidence as a new publish.

After verification, Phase 5 automatically calls
`sync.writeCatalog({ publishedOnly: true })`, producing
`artifacts/sync/published-catalog.json`. This needs no exhaustive scan: it derives
from verified publication evidence. The existing scan-oriented catalog APIs remain
available for planning and retain their complete-scan requirements. The derived
file itself does not write QDN; updated indexes/manifest are published through the
ordinary next handoff and Hub approval.

Only one unresolved handoff is prepared per site at a time. Complete publication
and exact verification before preparing the next batch. Proven pre-submission
failed/declined packages may be superseded locally; submitted, ambiguous or
read-back-blocked writes must first be reconciled. Legacy stale unsubmitted
packages are regenerated when reopened; stale and superseded exports are refused.
Historical receipts cannot erase an independently verified revision.

## CMS reading and deployment

The manifest and index identifiers stay stable inside one immutable namespace.
The deployed CMS keeps reading `content.manifestIdentifier`; new batches update
that data resource without requiring adoption for public display. Adoption in the
CMS remains an optional editing workflow. CMS-native resources and edit overlays
are separate documents; the existing production CMS reader merges them over the
imported catalog exactly as before. QMS never rewrites those documents.

If the latest exact verified APP/WEBSITE deployment has the same actual members
and configuration (ignoring only `generated_at`), the next handoff reuses it.
Changing code/configuration requires an APP update; matching an older historical
configuration is insufficient. The publishing screen retains the reused deployment
and opens its exact service/name/identifier, including the site identity in the
review. An independent site under the same name has a different manifest and APP
identifier; it does not continue an older site's catalog.

## Bounded acceptance

`node --test test/phase7/catalog-contract.test.js` exercises the real engine,
durable store, local HTTP/base64 exact verification and production CMS repository:

- 15 A posts, 15 B posts, one modified A3, no duplicate;
- unchanged content, shared media and APP not republished for B;
- native content and owner overlay retained;
- legacy verified handoff recovery, adoption and project reopen;
- independent second project under the same Qortal name;
- withdrawal, unverified revisions and incomplete media exclusion;
- stale package refresh/export refusal and sequential publication;
- APP configuration changes/reverts, obsolete receipt handling and revision cache isolation;
- explicit target migration and safe decline versus blocked-submission handling.

No wallet signing, live QDN write or QORT spending is performed.

## Owner-runtime diagnosis boundary

The reported 122-resource/15-post publication and November-4 CMS result are not
reproducible from the checked-in evidence: no matching owner workspace or live
handoff/manifest/config capture is present in the fetched repository branches.
Therefore its project ID, site ID, namespace and same-versus-different-project
relationship are **unknown**, not proven. The code defects above are independently
reproduced; they must not be described as proof of that specific runtime event.
Read-only diagnosis needs the original project's retained state and the currently
served CMS config/manifest/index. No live writes are authorized by this repair.
