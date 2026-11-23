import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { webcrypto, createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { zipSync } from "fflate";
const root = path.resolve(import.meta.dirname, "../..");
let javascript, workerCode, css;
before(async () => {
  execFileSync("npm", ["run", "publisher:build"], { cwd: root, stdio: "pipe" });
  const html = await readFile(
    path.join(root, "viewer/dist-publisher/index.html"),
    "utf8",
  );
  const jsPath = html.match(/src="\.\/(assets\/[^\"]+\.js)"/)[1];
  javascript = await readFile(
    path.join(root, "viewer/dist-publisher", jsPath),
    "utf8",
  );
  const workerFile = (await import("node:fs/promises")).readdir;
  const files = await workerFile(
    path.join(root, "viewer/dist-publisher/assets"),
  );
  workerCode = await readFile(
    path.join(
      root,
      "viewer/dist-publisher/assets",
      files.find((f) => f.startsWith("import.worker-")),
    ),
    "utf8",
  );
  css = await readFile(
    path.join(
      root,
      "viewer/dist-publisher",
      html.match(/href="\.\/(assets\/[^\"]+\.css)"/)[1],
    ),
    "utf8",
  );
});
const hash = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, stable(v[k])]),
    );
  return v;
}
function fixture(count = 3) {
  const entries = {};
  const resources = Array.from({ length: count }, (_, i) => {
    const bytes = Buffer.from("Publisher payload " + i);
    const relativePath = "payload/file" + i + ".txt";
    entries[relativePath] = bytes;
    return {
      id: "res_" + String(i).padStart(10, "0"),
      kind: i === 0 ? "media" : "content",
      service: "DOCUMENT",
      name: "AuditSite",
      identifier: "item" + i,
      relativePath,
      contentType: "text/plain",
      bytes: bytes.length,
      sha256: hash(bytes),
      order: i,
      dependsOn:
        count === 3 && i > 0 ? ["res_" + String(i - 1).padStart(10, "0")] : [],
      metadata: { title: "Article " + i },
    };
  });
  const manifest = {
    schema: "qms-publication-handoff@1",
    version: 1,
    handoffId: "hof_audit000001",
    publicationBatchId: "pub_audit000001",
    planId: "plan_audit000001",
    projectId: "prj_audit",
    siteId: "site_" + "a".repeat(16),
    siteNamespace: "ns" + "a".repeat(8),
    createdAt: "2026-11-23T00:00:00Z",
    target: { qdnName: "AuditSite", resourcePrefix: "audit" },
    estimate: {
      resourceCount: count,
      feePerResource: 0.01,
      estimatedFee: count * 0.01,
      currency: "QORT",
      label: "Estimate",
      batches: count,
    },
    resources,
  };
  manifest.integrity = {
    algorithm: "sha256",
    value: hash(JSON.stringify(stable(manifest))),
  };
  entries["handoff.json"] = Buffer.from(JSON.stringify(manifest));
  return {
    manifest,
    file: new File([zipSync(entries)], "publisher.zip", {
      type: "application/zip",
    }),
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f) {
  for (let i = 0; i < 400; i++) {
    if (f()) return;
    await delay(10);
  }
  throw Error("UI assertion timed out");
}
async function setup(t, { session, wrongAccount = false } = {}) {
  const errors = [];
  const calls = [];
  const uploaded = new Set();
  let uploadGate = null;
  const dom = new JSDOM(
    "<!doctype html><html><head><style>" +
      css +
      '</style></head><body><div id="root"></div></body></html>',
    {
      url: "http://localhost/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window;
  t.after(() => dom.window.close());
  w.addEventListener("error", (e) => errors.push(e.message));
  Object.defineProperty(w.crypto, "subtle", { value: webcrypto.subtle });
  Object.assign(w, {
    File,
    Blob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    fetch: async () => {
      throw Error("No network in test");
    },
  });
  w.qortalRequest = async (p) => {
    calls.push(p);
    if (p.action === "GET_USER_ACCOUNT")
      return { address: "Q" + "A".repeat(33) };
    if (p.action === "GET_ACCOUNT_NAMES")
      return [
        {
          name: "AuditSite",
          owner: "Q" + (wrongAccount ? "B" : "A").repeat(33),
        },
      ];
    if (p.action === "GET_QDN_RESOURCE_STATUS")
      return { status: uploaded.has(p.identifier) ? "READY" : "NOT_PUBLISHED" };
    if (p.action === "FETCH_QDN_RESOURCE") {
      if (!uploaded.has(p.identifier)) throw Error("not published");
      return btoa("Publisher payload " + p.identifier.replace("item", ""));
    }
    if (p.action === "PUBLISH_MULTIPLE_QDN_RESOURCES") {
      if (uploadGate) await uploadGate;
      p.resources.forEach((r) => uploaded.add(r.identifier));
      return p.resources.map(() => ({ signature: "signature" }));
    }
    if (p.action === "SAVE_FILE") return true;
    throw Error("Unsupported test action");
  };
  w.Worker = class {
    constructor() {
      const owner = this;
      const self = {
        postMessage(data) {
          queueMicrotask(() => {
            if (!owner.stopped)
              owner.onmessage?.({ data: structuredClone(data) });
          });
        },
      };
      vm.runInNewContext(workerCode, {
        self,
        File,
        Blob,
        TextEncoder,
        TextDecoder,
        Uint8Array,
        ArrayBuffer,
        DataView,
        Map,
        Set,
        crypto: webcrypto,
        console,
      });
      this.self = self;
    }
    postMessage(data) {
      void this.self.onmessage({ data });
    }
    terminate() {
      this.stopped = true;
    }
  };
  if (session)
    w.localStorage.setItem(
      "qms-migration-publisher-v2:" + session.handoffId,
      JSON.stringify(session),
    );
  // JSDOM executes scripts in a classic-script VM; supply the module URL only.
  w.eval(
    javascript.replaceAll(
      "import.meta.url",
      JSON.stringify("http://localhost/assets/publisher.js"),
    ),
  );
  await until(() =>
    w.document.querySelector(".mp-account")?.textContent.includes("connected"),
  );
  await delay(20);
  const d = w.document;
  const find = (text) =>
    [...d.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
  async function load(f = fixture()) {
    const input = d.querySelector("input[accept]");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [f.file],
    });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await until(
      () =>
        d.querySelectorAll(".mp-resource-row").length ===
        Math.min(f.manifest.resources.length, 50),
    );
    await delay(20);
    return f;
  }
  return {
    w,
    d,
    errors,
    calls,
    uploaded,
    load,
    find,
    pauseUploads: () => {
      let release;
      uploadGate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        uploadGate = null;
        release();
      };
    },
  };
}
test("production bundle detects account automatically and imports through the emitted worker", async (t) => {
  const h = await setup(t);
  assert.equal(
    h.calls.filter((c) => c.action === "GET_USER_ACCOUNT").length,
    1,
  );
  await h.load();
  assert.match(h.d.querySelector(".mp-account").textContent, /Owner verified/);
  assert.equal(h.d.querySelectorAll(".mp-resource-row").length, 3);
  assert.equal(
    h.w.getComputedStyle(h.d.querySelector(".mp-scroll-list")).overflowY,
    "auto",
  );
  assert.equal(
    h.d.querySelectorAll('input[type=text][value="AuditSite"]').length,
    0,
  );
  assert.deepEqual(h.errors, []);
});
test("first approved click uploads, verifies and saves an accurate receipt", async (t) => {
  const h = await setup(t);
  await h.load();
  h.d.querySelectorAll(".mp-consent input")[1].click();
  await delay(20);
  h.find("Approve & publish").click();
  await until(() => h.d.querySelector(".mp-result"));
  assert.equal(
    h.calls.filter((c) => c.action === "PUBLISH_MULTIPLE_QDN_RESOURCES").length,
    3,
  );
  assert.match(
    h.d.querySelector(".mp-alert.info").textContent,
    /3 items sent to Hub/,
  );
  assert.match(
    h.d.querySelector(".mp-result").textContent,
    /All selected items verified/,
  );
  h.find("Save receipt").click();
  await until(() => h.calls.some((c) => c.action === "SAVE_FILE"));
  const receipt = JSON.parse(
    await h.calls.find((c) => c.action === "SAVE_FILE").blob.text(),
  );
  assert.equal(receipt.counts.remote_verified, 3);
  assert.ok(receipt.results.every((r) => r.submittedAt && r.confirmedAt));
  assert.deepEqual(h.errors, []);
});
test("dependency selection is transitive; consent resets and active jobs lock the selection", async (t) => {
  const h = await setup(t);
  await h.load();
  const check = h.d.querySelectorAll(".mp-consent input")[1];
  check.click();
  await delay(20);
  h.d.querySelector(".mp-resource-main input").click();
  await delay(20);
  assert.equal(
    [...h.d.querySelectorAll(".mp-resource-main input")].filter(
      (e) => e.checked,
    ).length,
    0,
  );
  assert.equal(check.checked, false);
  h.find("Select all").click();
  await delay(20);
  check.click();
  await delay(20);
  const release = h.pauseUploads();
  t.after(release);
  h.find("Approve & publish").click();
  await until(() => h.find("Working…"));
  assert.equal(h.find("Select all").disabled, true);
  assert.equal(h.find("Clear").disabled, true);
  assert.equal(h.d.querySelector(".mp-consent input").disabled, true);
  release();
  await until(() => h.d.querySelector(".mp-result"));
});
test("100 imported resources use bounded rendering; filters preserve selection and reset pagination", async (t) => {
  const h = await setup(t);
  await h.load(fixture(100));
  assert.equal(h.d.querySelectorAll(".mp-resource-row").length, 50);
  assert.match(h.d.querySelector(".mp-pagination").textContent, /1–50 of 100/);
  h.d.querySelector('[aria-label="Next items"]').click();
  await delay(20);
  assert.match(h.d.querySelector(".mp-pagination").textContent, /51–100/);
  const input = h.d.querySelector(".mp-search input");
  Object.getOwnPropertyDescriptor(
    h.w.HTMLInputElement.prototype,
    "value",
  ).set.call(input, "Article 99");
  input.dispatchEvent(new h.w.Event("input", { bubbles: true }));
  await delay(30);
  assert.equal(h.d.querySelectorAll(".mp-resource-row").length, 1);
  assert.match(
    h.d.querySelector(".mp-list-toolbar").textContent,
    /100 selected/,
  );
  assert.match(h.d.querySelector(".mp-pagination").textContent, /1–1 of 1/);
});
test("legacy pending state stays protected and read-only check never uploads", async (t) => {
  const f = fixture();
  const session = {
    handoffId: f.manifest.handoffId,
    selected: f.manifest.resources.map((r) => r.id),
    states: Object.fromEntries(
      f.manifest.resources.map((r) => [
        r.id,
        {
          status: "blocked",
          reason:
            "An earlier attempt has no confirmed outcome. Reconcile it before retry.",
          txSignature: null,
          updatedAt: "2026-11-23T00:00:00Z",
        },
      ]),
    ),
    accountName: "AuditSite",
    accountAddress: "Q" + "A".repeat(33),
    receipt: null,
    updatedAt: "2026-11-23T00:00:00Z",
  };
  const h = await setup(t, { session });
  await h.load(f);
  assert.equal(h.find("Approve & publish").disabled, true);
  h.find("Recheck pending").click();
  await until(() => h.d.querySelector(".mp-result"));
  assert.equal(
    h.calls.filter((c) => c.action === "PUBLISH_MULTIPLE_QDN_RESOURCES").length,
    0,
  );
  assert.match(
    h.d.querySelector(".mp-alert.info").textContent,
    /No uploads were requested/,
  );
  assert.equal(h.find("Approve & publish").disabled, true);
});
test("a different owner is shown clearly and publishing remains disabled", async (t) => {
  const h = await setup(t, { wrongAccount: true });
  await h.load();
  assert.match(
    h.d.querySelector(".mp-account").textContent,
    /different address/,
  );
  assert.equal(h.find("Approve & publish").disabled, true);
  assert.deepEqual(h.errors, []);
});
