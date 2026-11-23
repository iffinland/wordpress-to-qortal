import test from "node:test";
import assert from "node:assert/strict";
import {
  runPublication,
  selectWithDependencies,
  submissionResults,
  needsReconciliation,
} from "../../viewer/src/publisher/workflow.ts";
import {
  unpackZip,
  buildFolderMap,
} from "../../viewer/src/publisher/handoff.ts";
import { zipSync } from "fflate";
const resource = (id, dependsOn = []) => ({
  id,
  kind: "content",
  service: "DOCUMENT",
  name: "TestName",
  identifier: id,
  relativePath: "payload/" + id,
  bytes: 10,
  contentType: "text/plain",
  sha256: "sha256:" + "a".repeat(64),
  order: 0,
  dependsOn,
});
const chain = [resource("A"), resource("B", ["A"]), resource("C", ["B"])];
const state = (status, extra = {}) => ({
  status,
  reason: "",
  txSignature: null,
  updatedAt: "2026-11-23T00:00:00.000Z",
  ...extra,
});
function harness(overrides = {}) {
  const writes = [];
  const saved = [];
  const uploaded = new Set();
  return {
    writes,
    saved,
    uploaded,
    options: {
      resources: chain,
      selected: new Set(["A", "B", "C"]),
      states: {},
      allowUpdates: false,
      verificationBudgetMs: 0,
      verifyAccount: async () => {},
      progress: () => {},
      save: (s) => saved.push(structuredClone(s)),
      probe: async (r) => ({
        presence: uploaded.has(r.id) ? "matching" : "new",
        reason: "test",
      }),
      submit: async (batch) => {
        writes.push(batch.map((r) => r.id));
        batch.forEach((r) => uploaded.add(r.id));
        return batch.map(() => ({ signature: "test-signature" }));
      },
      ...overrides,
    },
  };
}
test("selection removes all descendants and re-adds every dependency", () => {
  const selected = selectWithDependencies(
    chain,
    new Set(["A", "B", "C"]),
    "A",
    false,
  );
  assert.deepEqual([...selected], []);
  assert.deepEqual(
    [...selectWithDependencies(chain, new Set(), "C", true)],
    ["A", "B", "C"],
  );
});
test("missing dependencies block before any upload", async () => {
  const h = harness({ selected: new Set(["C"]) });
  await assert.rejects(() => runPublication(h.options), /required resource/i);
  assert.equal(h.writes.length, 0);
});
test("the first click uploads new content and verifies dependencies in order", async () => {
  const h = harness();
  const result = await runPublication(h.options);
  assert.deepEqual(h.writes, [["A"], ["B"], ["C"]]);
  assert.equal(result.submitted, 3);
  assert.equal(result.verified, 3);
  assert.equal(result.remaining, 0);
  assert.ok(
    h.saved.some((s) => s.A?.writeAttempted && s.A.status === "submitted"),
  );
});
test("independent items share a single approval up to the bounded batch size", async () => {
  const items = Array.from({ length: 21 }, (_, i) => resource("item" + i));
  const h = harness({
    resources: items,
    selected: new Set(items.map((r) => r.id)),
  });
  await runPublication(h.options);
  assert.deepEqual(
    h.writes.map((r) => r.length),
    [20, 1],
  );
});
test("pending recovery remains protected over repeated publish clicks, including legacy blocked sessions", async () => {
  for (const prior of [
    state("pending_confirmation"),
    state("blocked", {
      reason:
        "An earlier attempt has no confirmed outcome. Reconcile it before any retry;",
    }),
  ]) {
    const h = harness({
      resources: [chain[0]],
      selected: new Set(["A"]),
      states: { A: prior },
      probe: async () => ({ presence: "new", reason: "not yet visible" }),
    });
    for (let i = 0; i < 3; i++) {
      const result = await runPublication(h.options);
      h.options.states = result.states;
      assert.equal(result.states.A.status, "pending_confirmation");
    }
    assert.equal(h.writes.length, 0);
  }
});
test("read-only reconciliation verifies uploaded content without resubmitting", async () => {
  const h = harness({
    readOnly: true,
    states: { A: state("pending_confirmation", { writeAttempted: true }) },
  });
  h.uploaded.add("A");
  const result = await runPublication(h.options);
  assert.equal(result.verified, 1);
  assert.equal(h.writes.length, 0);
});
test("saved remote_verified is rechecked and never treated as fresh proof", async () => {
  const h = harness({
    states: { A: state("remote_verified") },
    probe: async () => ({ presence: "different", reason: "Changed content" }),
  });
  const result = await runPublication(h.options);
  assert.equal(result.verified, 0);
  assert.equal(result.submitted, 0);
  assert.equal(result.states.A.status, "blocked");
});
test("slow confirmation pauses with an honest result and no dependent uploads", async () => {
  const h = harness({
    probe: async () => ({ presence: "new", reason: "Not visible yet" }),
  });
  const result = await runPublication(h.options);
  assert.deepEqual(h.writes, [["A"]]);
  assert.equal(result.verified, 0);
  assert.equal(result.remaining, 3);
  assert.match(result.message, /Paused/);
  assert.equal(needsReconciliation(result.states.A), true);
});
test("unknown QDN state and account switch fail before writing", async () => {
  const h = harness({
    probe: async () => ({ presence: "unknown", reason: "Node unreachable" }),
  });
  const result = await runPublication(h.options);
  assert.equal(result.submitted, 0);
  assert.match(result.message, /No uploads started/);
  const switched = harness({
    verifyAccount: async () => {
      throw Error("Account changed");
    },
  });
  await assert.rejects(
    () => runPublication(switched.options),
    /Account changed/,
  );
  assert.equal(switched.writes.length, 0);
});
test("update permission is required for differing bytes", async () => {
  const h = harness({
    probe: async (r) => ({
      presence: h.uploaded.has(r.id) ? "matching" : "different",
      reason: "different",
    }),
  });
  await runPublication(h.options);
  assert.equal(h.writes.length, 0);
  h.options.allowUpdates = true;
  const result = await runPublication(h.options);
  assert.equal(result.verified, 3);
});
test("partial responses retain identity-specific errors and incomplete arrays do not imply success", () => {
  const resources = [
    resource("same"),
    { ...resource("same"), service: "IMAGE" },
  ];
  const result = submissionResults(resources, {
    error: {
      unsuccessfulPublishes: [
        { identifier: "same", service: "IMAGE", reason: "Storage unavailable" },
      ],
    },
  });
  assert.equal(result[1].reason, "Storage unavailable");
  assert.notEqual(result[0].reason, "Storage unavailable");
  assert.equal(result[1].writeAttempted, true);
  const incomplete = submissionResults(resources, [{ signature: "sig" }]);
  assert.equal(
    incomplete.every((r) => r.status === "pending_confirmation"),
    true,
  );
  const denied = submissionResults(
    resources,
    null,
    new Error("User declined request"),
  );
  assert.equal(
    denied.every((r) => r.status === "declined" && !r.writeAttempted),
    true,
  );
});
test("ZIP extraction limits real expansion and rejects unsafe and normalized duplicate paths", () => {
  const payload = zipSync({ "payload/a": new Uint8Array(4096) });
  assert.throws(() => unpackZip(payload, 1024), /safety limit/);
  assert.throws(
    () => unpackZip(zipSync({ "../escape": new Uint8Array([1]) })),
    /unsafe/i,
  );
  assert.throws(
    () => unpackZip(zipSync({ "/payload/file": new Uint8Array([1]) })),
    /unsafe/i,
  );
  assert.throws(
    () =>
      unpackZip(
        zipSync({ a: new Uint8Array([1]), b: new Uint8Array([2]) }),
        1024,
        1,
      ),
    /too many/,
  );
  assert.equal(unpackZip(payload)["payload/a"].length, 4096);
});
test("folder import checks the aggregate size before reading file contents", async () => {
  await assert.rejects(
    () =>
      buildFolderMap([
        {
          name: "huge",
          size: 513 * 1024 * 1024,
          arrayBuffer: () => {
            throw Error("must not read");
          },
        },
      ]),
    /512 MB/,
  );
});

test("a preparing QDN item is rechecked within the first approved run instead of requiring a second click", async () => {
  let probes = 0;
  const h = harness({
    resources: [chain[0]],
    selected: new Set(["A"]),
    verificationBudgetMs: 1000,
    waitMs: 1,
    probe: async (r) => ({
      presence: h.uploaded.has(r.id)
        ? "matching"
        : ++probes < 3
          ? "waiting"
          : "new",
      reason: "test",
    }),
  });
  const result = await runPublication(h.options);
  assert.equal(h.writes.length, 1);
  assert.equal(result.verified, 1);
});
