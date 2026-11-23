import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { readFixture, ownerIdentity } from "./support/fixtures";
import { loadRuntimeCmsConfig, cmsConfig } from "../src/config/cmsConfig";
import {
  buildContentConnection,
  connectionIdentifier,
  discoverSiteContent,
  standaloneSiteId,
  validateDiscoveredManifest,
} from "../src/lib/contentDiscovery.js";
import { createCmsRepository } from "../src/lib/repository.js";
import {
  publishNativePostDraft,
  publishOverlayDraft,
} from "../src/lib/authoring.js";
import { resolveViewerIdentity } from "../src/lib/qortal.js";

const name = "jussi-olen";
const catalogId = "qms-nsabcdefgh-man-site-manifest-0123456789";
let store: Map<string, string>;
let writes: any[];
let reads: string[];
function put(identifier: string, data: any) {
  store.set(identifier, JSON.stringify(data));
}
function host(service = "APP", identifier = "default") {
  Object.assign(window, {
    _qdnName: name,
    _qdnService: service,
    _qdnIdentifier: identifier,
  });
}
function seedImport(identifier = catalogId, siteId = "site-fixture") {
  const fixture = JSON.parse(
    JSON.stringify(readFixture("qms-cms-manifest.json"))
      .split("QortalDemo")
      .join(name),
  );
  const raw = {
    schema: "qms-qdn-manifest@1",
    version: 1,
    site_id: siteId,
    target: { qdnName: name },
    generated_at: new Date().toISOString(),
    namespace: "nsabcdefgh",
    entrypoints: {
      posts: "qms-fixture-posts",
      pages: "qms-fixture-pages",
      categories: "qms-fixture-categories",
      tags: "qms-fixture-tags",
      media_map: "qms-fixture-media",
    },
    resources: fixture.resources,
    summary: { posts: 3, pages: 2, categories: 3, tags: 3 },
  };
  for (const [id, ref] of Object.entries<any>(fixture.resources.by_identifier))
    put(
      id,
      JSON.parse(
        JSON.stringify(readFixture(ref.local_path))
          .split("QortalDemo")
          .join(name),
      ),
    );
  put(identifier, raw);
  return raw;
}
function metadata(identifier?: string) {
  return [...store.keys()]
    .filter((id) => !identifier || id.startsWith(identifier))
    .map((id) => ({ name, service: "DOCUMENT", identifier: id }));
}
function response(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}
beforeEach(() => {
  store = new Map();
  writes = [];
  reads = [];
  localStorage.clear();
  host();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = new URL(String(input), "http://localhost");
      reads.push(url.pathname + url.search);
      if (url.pathname.endsWith("/qms-cms-config.json"))
        return response(404, {});
      if (url.pathname.includes("/names/"))
        return response(200, { name, owner: ownerIdentity.address });
      if (url.pathname === "/arbitrary/resources/search")
        return response(
          200,
          (url.searchParams.get("mode") === "ALL"
            ? metadata(url.searchParams.get("identifier") || undefined)
            : metadata(url.searchParams.get("identifier") || undefined).slice(-1)).slice(
            Number(url.searchParams.get("offset") || 0),
            Number(url.searchParams.get("offset") || 0) + 100,
          ),
        );
      if (url.pathname.startsWith("/arbitrary/")) {
        const parts = url.pathname
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent);
        const id = parts[3];
        if (parts[1] === "APP" || parts[1] === "WEBSITE")
          return response(404, {});
        if (parts[2] !== name || !store.has(id))
          return response(500, { error: 5, message: "repository error" });
        const raw = store.get(id)!;
        return response(
          200,
          url.searchParams.get("encoding") === "base64"
            ? btoa(raw)
            : JSON.parse(raw),
        );
      }
      return response(404, {});
    }),
  );
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    switch (payload.action) {
      case "GET_USER_ACCOUNT":
        return { address: ownerIdentity.address };
      case "GET_ACCOUNT_NAMES":
        return [{ name, owner: ownerIdentity.address }];
      case "GET_PRIMARY_NAME":
        return name;
      case "GET_NAME_DATA":
        return { name, owner: ownerIdentity.address };
      case "GET_QDN_RESOURCE_STATUS":
        return {
          status: store.has(payload.identifier) ? "READY" : "NOT_PUBLISHED",
        };
      case "SEARCH_QDN_RESOURCES":
        return (payload.mode === "ALL" ? metadata(payload.identifier) : metadata(payload.identifier).slice(-1)).slice(
          payload.offset || 0,
          (payload.offset || 0) + (payload.limit || 100),
        );
      case "PUBLISH_MULTIPLE_QDN_RESOURCES":
        writes.push(payload);
        for (const r of payload.resources) {
          expect(r.name).toBe(name);
          store.set(r.identifier, Buffer.from(r.data64, "base64").toString());
        }
        return payload.resources.map(() => ({ signature: "test" }));
      case "PUBLISH_QDN_RESOURCE":
        writes.push(payload);
        store.set(
          payload.identifier,
          Buffer.from(payload.data64, "base64").toString(),
        );
        return { signature: "test" };
      case "FETCH_QDN_RESOURCE":
        if (!store.has(payload.identifier)) throw Error("not published");
        return Buffer.from(store.get(payload.identifier)!).toString("base64");
      default:
        return null;
    }
  });
});
afterEach(() => {
  for (const key of [
    "_qdnName",
    "_qdnService",
    "_qdnIdentifier",
    "qortalRequest",
  ])
    delete (window as any)[key];
  vi.unstubAllGlobals();
});

describe("CMS installed independently of Publisher", () => {
  it("requests ALL resources when a newer settings document hides the imported manifest in default search mode", async () => {
    seedImport();
    put("qms-cms-site-settings", { schema: "qms-cms-site-settings@1" });
    host();
    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.config.content.manifestIdentifier).toBe(catalogId);
    const searches = reads.filter((url) => url.startsWith("/arbitrary/resources/search?"));
    expect(searches.length).toBeGreaterThan(0);
    for (const url of searches) expect(new URL(url, "http://localhost").searchParams.get("mode")).toBe("ALL");
  });

  it("also requests ALL resources through Hub when direct metadata search fails", async () => {
    seedImport();
    put("qms-cms-site-settings", {});
    host("WEBSITE");
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: any, options?: any) => {
      if (String(input).includes("/arbitrary/resources/search")) throw Error("HTTP transport unavailable");
      return originalFetch(input, options);
    }));
    const found = await discoverSiteContent({ name, identifier: "default" });
    expect(found.status).toBe("connected");
    expect(found.selected?.ref.identifier).toBe(catalogId);
    const calls = ((window as any).qortalRequest as any).mock.calls.filter(([payload]: any[]) => payload.action === "SEARCH_QDN_RESOURCES");
    expect(calls.length).toBeGreaterThan(0);
    for (const [payload] of calls) expect(payload.mode).toBe("ALL");
  });

  it.each(["APP", "WEBSITE"])(
    "discovers an existing imported catalog as %s without a project config file",
    async (service) => {
      seedImport();
      host(service);
      const loaded = await loadRuntimeCmsConfig();
      expect(loaded.notice).toBe("");
      expect(loaded.config.content.manifestIdentifier).toBe(catalogId);
      expect(loaded.config.site.id).toBe("site-fixture");
      expect(loaded.config.deployment?.service).toBe(service);
      expect(writes).toHaveLength(0);
      const repo = createCmsRepository(loaded.config);
      const dataset = await repo.loadDataset();
      expect(dataset.posts).toHaveLength(3);
      expect(dataset.pages).toHaveLength(2);
      expect(dataset.site.ownerName).toBe(name);
      // Absent connection resources return 500 on real nodes; never request an absent one.
      expect(
        reads.some((url) =>
          url.startsWith("/arbitrary/DOCUMENT/" + name + "/qms-cms-connection"),
        ),
      ).toBe(false);
    },
  );
  it("finds content published after the CMS was initially installed", async () => {
    const before = await loadRuntimeCmsConfig();
    expect(before.discovery.status).toBe("empty");
    expect(before.config.site.id).toBe(standaloneSiteId(name));
    seedImport();
    const after = await loadRuntimeCmsConfig();
    expect(after.discovery.status).toBe("connected");
    expect(after.config.content.manifestIdentifier).toBe(catalogId);
  });
  it("does not guess between two projects and a saved owner connection works across services", async () => {
    const first = seedImport();
    const other = catalogId.replace("0123456789", "9876543210");
    seedImport(other, "site-other");
    let loaded = await loadRuntimeCmsConfig();
    expect(loaded.discovery.status).toBe("ambiguous");
    expect(loaded.config.content.manifestIdentifier).toBe("");
    const candidate = validateDiscoveredManifest(
      first,
      { service: "DOCUMENT", name, identifier: catalogId },
      name,
    );
    put(
      await connectionIdentifier({ name, identifier: "default" }),
      buildContentConnection({ name, identifier: "default" }, candidate),
    );
    host("WEBSITE");
    loaded = await loadRuntimeCmsConfig();
    expect(loaded.config.content.manifestIdentifier).toBe(catalogId);
    expect(loaded.config.site.id).toBe("site-fixture");
  });
  it("does not trust visitor name parameters, foreign publisher rows or foreign catalog references", async () => {
    seedImport();
    window.history.replaceState(null, "", "/?name=OtherSite&qdnName=OtherSite");
    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.config.admin.qdnName).toBe(name);
    const raw = seedImport();
    raw.target.qdnName = "OtherSite";
    put(catalogId, raw);
    const rejected = await loadRuntimeCmsConfig();
    expect(rejected.discovery.status).toBe("unavailable");
    expect(rejected.config.content.manifestIdentifier).toBe("");
    const result = await discoverSiteContent(
      { name, identifier: "default" },
      {
        read: async () => {
          throw Error("must not read");
        },
        search: async () => [
          { name: "OtherSite", service: "DOCUMENT", identifier: catalogId },
        ],
      },
    );
    expect(result.status).toBe("empty");
  });
  it("fails honestly if another candidate cannot be read, or the resource search is incomplete", async () => {
    const raw = seedImport();
    const refs = [
      { name, service: "DOCUMENT", identifier: catalogId },
      {
        name,
        service: "DOCUMENT",
        identifier: catalogId.replace("0123456789", "1111111111"),
      },
    ];
    const result = await discoverSiteContent(
      { name, identifier: "default" },
      {
        search: async (_name: string, _offset: number, id?: string) =>
          id ? [] : refs,
        read: async (ref: any) => {
          if (ref.identifier !== catalogId) throw Error("not downloaded");
          return raw;
        },
      },
    );
    expect(result.status).toBe("unavailable");
    expect(result.candidates).toHaveLength(1);
    const search = vi.fn(async () => {
      throw Error("Node unavailable");
    });
    expect(
      (await discoverSiteContent({ name, identifier: "default" }, { search }))
        .status,
    ).toBe("unavailable");
  });
  it("paginates the owner resource index rather than missing a catalog after 100 documents", async () => {
    const raw = seedImport();
    const search = vi.fn(async (_name: string, offset: number, id?: string) =>
      id
        ? []
        : offset === 0
          ? Array.from({ length: 100 }, (_, i) => ({
              name,
              service: "DOCUMENT",
              identifier: "post-" + i,
            }))
          : [{ name, service: "DOCUMENT", identifier: catalogId }],
    );
    const found = await discoverSiteContent(
      { name, identifier: "default" },
      { search, read: async () => raw },
    );
    expect(found.status).toBe("connected");
    expect(search).toHaveBeenCalledWith(name, 100);
  });
  it("rejects a saved connection to a different publisher or mismatched site ID", async () => {
    seedImport();
    put("qms-cms-connection", {
      schema: "qms-cms-connection@1",
      version: 1,
      name,
      deploymentIdentifier: "default",
      siteId: "site-fixture",
      manifest: {
        service: "DOCUMENT",
        name: "OtherSite",
        identifier: catalogId,
      },
    });
    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.discovery.status).toBe("unavailable");
    expect(loaded.config.content.manifestIdentifier).toBe("");
  });
  it("rebinds a configured APP presentation to WEBSITE without changing its imported content", async () => {
    seedImport();
    host("WEBSITE");
    const runtime = {
      ...cmsConfig,
      deployment: { name, service: "APP", identifier: "default" },
      site: { ...cmsConfig.site, id: "site-fixture", ownerName: name },
      admin: { ...cmsConfig.admin, qdnName: name },
      content: { ...cmsConfig.content, manifestIdentifier: catalogId },
    };
    const normal = fetch as any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, options: any) =>
        String(url) === "./qms-cms-config.json"
          ? response(200, runtime)
          : normal(url, options),
      ),
    );
    const loaded = await loadRuntimeCmsConfig();
    expect(loaded.notice).toBe("");
    expect(loaded.config.deployment?.service).toBe("WEBSITE");
    expect(loaded.config.content.manifestIdentifier).toBe(catalogId);
  });
  it("keeps CMS-first posts, later imported posts, new CMS posts and imported text/image edits together after reinstall", async () => {
    let config = (await loadRuntimeCmsConfig()).config;
    const identity = await resolveViewerIdentity({ qdnName: name });
    expect(identity.owner).toBe(true);
    let result = await publishNativePostDraft({
      identity,
      name,
      siteId: config.site.id,
      author: name,
      timestamp: Date.now(),
      draft: {
        id: "cms-before",
        type: "post",
        title: "Before migration",
        slug: "before-migration",
        status: "published",
        html: "<p>First CMS post</p>",
      },
      baseRevision: 0,
      storage: localStorage,
    });
    expect(result.ok).toBe(true);
    const imported = seedImport();
    config = (await loadRuntimeCmsConfig()).config;
    let repo = createCmsRepository(config);
    let data = await repo.loadDataset();
    expect(data.posts).toHaveLength(4);
    expect(data.posts.some((p: any) => p.title === "Before migration")).toBe(
      true,
    );
    result = await publishNativePostDraft({
      identity,
      name,
      siteId: config.site.id,
      author: name,
      timestamp: Date.now(),
      draft: {
        id: "cms-after",
        type: "post",
        title: "After migration",
        slug: "after-migration",
        status: "published",
        html: "<p>Second CMS post</p>",
      },
      baseRevision: 1,
      storage: localStorage,
    });
    expect(result.ok).toBe(true);
    repo = createCmsRepository(config);
    data = await repo.loadDataset();
    expect(data.posts).toHaveLength(5);
    const item = data.posts.find((p: any) => !p.native);
    const original = store.get(item.contentRef.identifier);
    result = await publishOverlayDraft({
      identity,
      name,
      siteId: config.site.id,
      baseRevision: 0,
      storage: localStorage,
      item,
      content: await repo.loadContent(item),
      draft: {
        id: item.id,
        type: "post",
        sourceKind: "wordpress-overlay",
        sourceItemId: item.id,
        sourceId: item.legacy?.sourceId,
        sourceSlug: item.slug,
        sourceRef: item.contentRef,
        sourceModifiedAt: item.updatedAt,
        baseSourceHash: item.contentHash,
        sourceContentHash: item.contentHash,
        title: "Owner changed the text and cover",
        slug: item.slug,
        html: "<p>Edited imported article</p>",
        status: "published",
        featuredImage: {
          mode: "explicit",
          ref: { service: "IMAGE", name, identifier: "new-cover" },
        },
        featuredImageResolved: {
          mode: "explicit",
          source: "explicit",
          ref: { service: "IMAGE", name, identifier: "new-cover" },
          url: "",
          alt: "New cover",
        },
        categoryIds: [],
        tagIds: [],
        categories: [],
        tags: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(store.get(item.contentRef.identifier)).toBe(original);
    expect(JSON.parse(store.get(catalogId)!)).toEqual(imported);
    // Replacing the CMS ZIP and switching services must not lose either supplement.
    localStorage.clear();
    host("WEBSITE");
    config = (await loadRuntimeCmsConfig()).config;
    repo = createCmsRepository(config);
    data = await repo.loadDataset();
    expect(data.posts).toHaveLength(5);
    const edited = data.posts.find((p: any) => p.id === item.id);
    expect(edited.title).toBe("Owner changed the text and cover");
    expect(edited.featuredImageRef?.identifier).toBe("new-cover");
    expect((await repo.loadContent(edited)).html).toContain(
      "Edited imported article",
    );
  });
});
it("preserves custom template branding and theme while discovering the imported catalog", async () => {
  seedImport();
  const originalTitle = cmsConfig.site.title;
  const originalAccent = cmsConfig.theme.colors.accent;
  cmsConfig.site.title = "Custom Web2 Clone";
  cmsConfig.theme.colors.accent = "#123abc";
  try {
    const result = await loadRuntimeCmsConfig();
    expect(result.config.site.title).toBe("Custom Web2 Clone");
    expect(result.config.theme.colors.accent).toBe("#123abc");
    expect(result.config.content.manifestIdentifier).toBe(catalogId);
  } finally {
    cmsConfig.site.title = originalTitle;
    cmsConfig.theme.colors.accent = originalAccent;
  }
});
