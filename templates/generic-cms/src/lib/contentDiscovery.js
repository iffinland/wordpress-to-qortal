/** Public content discovery shared by Generic CMS and custom site templates.
 * Only resources published by the actual hosting QDN name can be connected.
 * APP/WEBSITE are presentation coordinates, not content ownership coordinates.
 */
import {
  fetchQdnResource,
  getNodeUrl,
  hasQortalBridge,
  requestQortal,
  sha256Hex,
} from "./qortal.js";
import { normalizeManifest } from "./manifest.js";

export const CONTENT_CONNECTION_SCHEMA = "qms-cms-connection@1";
export const sameQdnName = (a, b) =>
  String(a || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase() ===
  String(b || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
export const standaloneSiteId = (name) =>
  "cms:" +
  String(name || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
const missing = (error) =>
  /404|not found|couldn't find.*transaction/i.test(
    String(error?.message || error),
  );
const manifestIdentifier = (value) =>
  value === "qms-cms-manifest" ||
  value === "cr-qdn-manifest" ||
  /-man-site-manifest(?:-|$)/.test(String(value || ""));

export async function connectionIdentifier(hosting) {
  if (!hosting.identifier || hosting.identifier === "default")
    return "qms-cms-connection";
  const digest = await sha256Hex(
    new TextEncoder().encode(String(hosting.identifier)),
  );
  return "qms-cms-connection-" + digest.slice(0, 32);
}

export function validateDiscoveredManifest(raw, ref, ownerName) {
  if (ref.service !== "DOCUMENT" || !sameQdnName(ref.name, ownerName))
    throw Error("The content catalog is not published by this site owner.");
  const parsed = normalizeManifest(raw, { expectedName: ownerName });
  if (!["qms-qdn", "qms-cms", "cr-qdn"].includes(parsed.kind))
    throw Error("Unsupported imported catalog.");
  const siteId =
    raw.site_id ||
    raw.site?.id ||
    (parsed.kind === "cr-qdn" ? parsed.site.id : "");
  if (!siteId || !parsed.entrypoints.posts || !parsed.entrypoints.pages)
    throw Error(
      "The catalog has no complete site identity and content entrypoints.",
    );
  for (const entry of Object.values(parsed.resources.byIdentifier || {})) {
    if (entry?.name && !sameQdnName(entry.name, ownerName))
      throw Error("The catalog references a different QDN publisher.");
  }
  return {
    siteId: String(siteId),
    ref: { service: "DOCUMENT", name: ownerName, identifier: ref.identifier },
    title:
      parsed.site.title === "Qortal Site"
        ? ownerName
        : parsed.site.title || ownerName,
    generatedAt: parsed.generatedAt,
    counts: parsed.counts,
  };
}

async function listPage(name, offset, identifier) {
  const params = new URLSearchParams({
    service: "DOCUMENT",
    mode: "ALL",
    name,
    exactmatchnames: "true",
    limit: "100",
    offset: String(offset),
    reverse: "true",
    includemetadata: "false",
  });
  if (identifier) params.set("identifier", identifier);
  let directError;
  try {
    const response = await fetch(
      getNodeUrl() + "/arbitrary/resources/search?" + params,
      { cache: "no-store", signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok)
      throw Error("Catalog search returned HTTP " + response.status);
    const result = await response.json();
    if (!Array.isArray(result))
      throw Error("Catalog search returned an invalid response.");
    return result;
  } catch (error) {
    directError = error;
  }
  if (!hasQortalBridge()) throw directError;
  let result = await requestQortal(
    {
      action: "SEARCH_QDN_RESOURCES",
      service: "DOCUMENT",
      mode: "ALL",
      name,
      exactMatchNames: true,
      identifier,
      limit: 100,
      offset,
      reverse: true,
    },
    15_000,
  );
  if (typeof result === "string") result = JSON.parse(result);
  if (!Array.isArray(result))
    throw Error("Hub did not return a usable catalog search.");
  return result;
}

export async function readContentConnection(hosting, read = fetchQdnResource) {
  const identifier = await connectionIdentifier(hosting);
  let raw;
  try {
    raw = await read(
      { service: "DOCUMENT", name: hosting.name, identifier },
      8000,
    );
  } catch (error) {
    if (missing(error)) return null;
    throw Error(
      "The saved content connection could not be read: " + error.message,
    );
  }
  if (
    raw?.schema !== CONTENT_CONNECTION_SCHEMA ||
    raw.version !== 1 ||
    !sameQdnName(raw.name, hosting.name) ||
    raw.deploymentIdentifier !== (hosting.identifier || "default") ||
    raw.manifest?.service !== "DOCUMENT" ||
    !sameQdnName(raw.manifest?.name, hosting.name) ||
    !raw.manifest.identifier ||
    !raw.siteId
  )
    throw Error(
      "The published content connection is invalid or belongs to another site.",
    );
  const manifest = await read(raw.manifest, 12000);
  const candidate = validateDiscoveredManifest(
    manifest,
    raw.manifest,
    hosting.name,
  );
  if (candidate.siteId !== raw.siteId)
    throw Error(
      "The saved connection no longer matches the published site identity.",
    );
  return candidate;
}

export async function discoverSiteContent(
  hosting,
  { read = fetchQdnResource, search = listPage } = {},
) {
  if (!hosting.name)
    return {
      status: "unavailable",
      candidates: [],
      message:
        "The hosting Qortal name is unavailable. Open this CMS through its APP or WEBSITE address.",
    };
  try {
    // Missing arbitrary resources can return HTTP 500 on Qortal. Check the
    // resource index first; never classify a generic repository error as absence.
    const connectionId = await connectionIdentifier(hosting);
    const connectionRows = await search(hosting.name, 0, connectionId);
    if (
      connectionRows.some(
        (row) =>
          row.service === "DOCUMENT" &&
          sameQdnName(row.name, hosting.name) &&
          row.identifier === connectionId,
      )
    ) {
      const saved = await readContentConnection(hosting, read);
      if (!saved)
        throw Error(
          "The saved connection is not ready on this node. Refresh when QDN finishes loading.",
        );
      return {
        status: "connected",
        selected: saved,
        candidates: [saved],
        source: "published-connection",
        message: "",
      };
    }
    const refs = new Map();
    let complete = false;
    for (let page = 0; page < 100; page++) {
      const rows = await search(hosting.name, page * 100);
      for (const row of rows)
        if (
          sameQdnName(row.name, hosting.name) &&
          row.service === "DOCUMENT" &&
          manifestIdentifier(row.identifier)
        )
          refs.set(row.identifier, {
            service: "DOCUMENT",
            name: hosting.name,
            identifier: row.identifier,
          });
      if (rows.length < 100) {
        complete = true;
        break;
      }
    }
    if (!complete)
      throw Error(
        "This account has too many resources for automatic discovery. Configure an explicit catalog connection.",
      );
    const candidates = [];
    let unreadable = false;
    for (const ref of refs.values()) {
      try {
        candidates.push(
          validateDiscoveredManifest(await read(ref, 12000), ref, hosting.name),
        );
      } catch {
        unreadable = true;
      }
    }
    if (unreadable)
      return {
        status: "unavailable",
        candidates,
        message:
          "Some imported catalogs could not be verified yet. Refresh the connection when QDN finishes loading; no other site was selected automatically.",
      };
    if (candidates.length === 1)
      return {
        status: "connected",
        selected: candidates[0],
        candidates,
        source: "discovery",
        message: "",
      };
    if (candidates.length > 1)
      return {
        status: "ambiguous",
        candidates,
        message:
          "More than one imported site was found. The owner can choose the correct content catalog in Admin → Content connection.",
      };
    return {
      status: "empty",
      candidates: [],
      message:
        "No imported catalog is visible on this node yet. You can publish new CMS content now; Refresh connection will find imported content after it is published.",
    };
  } catch (error) {
    return {
      status: "unavailable",
      candidates: [],
      message: error.message || String(error),
    };
  }
}

export function buildContentConnection(hosting, candidate) {
  if (
    !hosting.name ||
    !candidate?.siteId ||
    !sameQdnName(candidate.ref?.name, hosting.name) ||
    candidate.ref?.service !== "DOCUMENT"
  )
    throw Error("Select a catalog published by this Qortal name.");
  return {
    schema: CONTENT_CONNECTION_SCHEMA,
    version: 1,
    name: hosting.name,
    deploymentIdentifier: hosting.identifier || "default",
    siteId: candidate.siteId,
    manifest: { ...candidate.ref, name: hosting.name },
  };
}

/** Reusable adapter for bespoke Web2-style frontends. Visual defaults stay local;
 * only content identity is bound to the QDN owner and selected import. */
export function bindDiscoveredContent(base, hosting, candidate = null) {
  if (!hosting?.name) throw Error("A trusted QDN hosting name is required.");
  if (
    candidate &&
    (!sameQdnName(candidate.ref?.name, hosting.name) ||
      candidate.ref?.service !== "DOCUMENT")
  )
    throw Error("The selected content belongs to another QDN publisher.");
  return {
    ...base,
    deployment: {
      name: hosting.name,
      service: hosting.service === "WEBSITE" ? "WEBSITE" : "APP",
      identifier: hosting.identifier || "default",
    },
    site: {
      ...base.site,
      id: candidate?.siteId || standaloneSiteId(hosting.name),
      ownerName: hosting.name,
    },
    admin: { ...base.admin, qdnName: hosting.name },
    content: {
      ...base.content,
      source: "qdn",
      manifestIdentifier: candidate?.ref.identifier || "",
      legacyManifestIdentifier: "",
    },
  };
}
