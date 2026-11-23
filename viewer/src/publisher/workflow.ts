import {
  planBatches,
  type HandoffResource,
  type PublicationState,
} from "./handoff.ts";

export interface ResourceState {
  status: PublicationState;
  reason: string;
  txSignature: string | null;
  updatedAt: string;
  submittedAt?: string | null;
  confirmedAt?: string | null;
  writeAttempted?: boolean;
  verification?: Record<string, unknown> | null;
}
export interface Probe {
  presence: "new" | "matching" | "different" | "waiting" | "unknown";
  reason: string;
  verification?: Record<string, unknown> | null;
}
export interface Progress {
  phase: string;
  done: number;
  total: number;
  detail: string;
}

export function selectWithDependencies(
  resources: HandoffResource[],
  selected: Set<string>,
  id: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  if (checked) {
    const byId = new Map(resources.map((r) => [r.id, r]));
    const add = (key: string) => {
      if (next.has(key)) return;
      const r = byId.get(key);
      if (!r) throw new Error("Missing dependency: " + key);
      r.dependsOn.forEach(add);
      next.add(key);
    };
    add(id);
  } else {
    next.delete(id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of resources)
        if (next.has(r.id) && r.dependsOn.some((dep) => !next.has(dep))) {
          next.delete(r.id);
          changed = true;
        }
    }
  }
  return next;
}

export function needsReconciliation(state?: ResourceState): boolean {
  if (!state || state.status === "declined") return false;
  return (
    state.writeAttempted === true ||
    Boolean(state.txSignature) ||
    ["submitted", "pending_confirmation", "ambiguous"].includes(state.status) ||
    (state.status === "blocked" &&
      /earlier attempt|reconcile|ambiguous writes/i.test(state.reason))
  );
}

export function validateSelection(
  resources: HandoffResource[],
  selected: Set<string>,
) {
  const byId = new Map(resources.map((r) => [r.id, r]));
  for (const id of selected) {
    const r = byId.get(id);
    if (!r)
      throw new Error(
        "The saved selection does not match this package. Select the resources again.",
      );
    if (r.dependsOn.some((dep) => !selected.has(dep)))
      throw new Error(
        "A required resource is not selected. Select its dependencies or use Select all.",
      );
  }
}

// Partial results must retain per-resource errors; response order is usable
// only for a complete success array. A truncated array is never success proof.
export function submissionResults(
  resources: HandoffResource[],
  response: unknown,
  error?: unknown,
): ResourceState[] {
  const at = new Date().toISOString();
  const record =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)
      : {};
  const details =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : {};
  const failures = Array.isArray(details.unsuccessfulPublishes)
    ? (details.unsuccessfulPublishes as Array<Record<string, unknown>>)
    : [];
  const full = Array.isArray(response) && response.length === resources.length;
  return resources.map((r, index) => {
    const failure = failures.find(
      (f) =>
        f.identifier === r.identifier &&
        f.service === r.service &&
        (!f.name || f.name === r.name),
    );
    const entry = full
      ? (response[index] as Record<string, unknown> | undefined)
      : undefined;
    const reason =
      error instanceof Error
        ? error.message
        : failure
          ? String(failure.reason ?? "Hub could not confirm this item.")
          : "";
    const declined =
      Boolean(error) && /declin|denied|reject|cancel/i.test(reason);
    return {
      status: declined
        ? "declined"
        : entry && typeof entry.signature === "string"
          ? "submitted"
          : "pending_confirmation",
      reason: declined
        ? "You declined the Hub request. No automatic retry will occur."
        : reason || "Request returned. Checking the exact published content…",
      txSignature:
        typeof entry?.signature === "string" ? entry.signature : null,
      updatedAt: at,
      submittedAt: declined ? null : at,
      writeAttempted: !declined,
    };
  });
}

export interface RunOptions {
  resources: HandoffResource[];
  selected: Set<string>;
  states: Record<string, ResourceState>;
  allowUpdates: boolean;
  probe: (r: HandoffResource) => Promise<Probe>;
  submit: (batch: HandoffResource[]) => Promise<unknown>;
  verifyAccount: () => Promise<void>;
  save: (states: Record<string, ResourceState>) => void;
  progress: (p: Progress) => void;
  readOnly?: boolean;
  waitMs?: number;
  verificationBudgetMs?: number;
  wait?: (ms: number) => Promise<void>;
}

export async function runPublication(o: RunOptions) {
  validateSelection(o.resources, o.selected);
  const states = { ...o.states };
  const selected = o.resources.filter((r) => o.selected.has(r.id));
  const verified = new Set<string>();
  let submitted = 0;
  let reused = 0;
  const set = (r: HandoffResource, patch: Partial<ResourceState>) => {
    const previous = states[r.id] || {
      status: "handoff_ready" as const,
      reason: "",
      txSignature: null,
      updatedAt: "",
    };
    states[r.id] = {
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    o.save({ ...states });
  };
  const matched = (r: HandoffResource, p: Probe) => {
    verified.add(r.id);
    set(r, {
      status: "remote_verified",
      reason: p.reason,
      verification: p.verification,
      confirmedAt: new Date().toISOString(),
    });
  };
  await o.verifyAccount();
  let unresolved = false;
  let collisions = false;
  const preflightDeadline = Date.now() + (o.verificationBudgetMs ?? 60_000);
  for (let i = 0; i < selected.length; i++) {
    const r = selected[i];
    o.progress({
      phase: "Checking QDN",
      done: i,
      total: selected.length,
      detail: "Checking " + displayName(r),
    });
    let p = await o.probe(r);
    while (
      !o.readOnly &&
      p.presence === "waiting" &&
      Date.now() < preflightDeadline
    ) {
      o.progress({
        phase: "Preparing QDN checks",
        done: i,
        total: selected.length,
        detail:
          "QDN is preparing " +
          displayName(r) +
          ". This run will continue when it is ready.",
      });
      await (
        o.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )(o.waitMs ?? 4000);
      p = await o.probe(r);
    }
    if (p.presence === "matching") {
      matched(r, p);
      reused++;
      continue;
    }
    if (needsReconciliation(states[r.id])) {
      unresolved = true;
      set(r, {
        status: "pending_confirmation",
        writeAttempted: true,
        reason:
          "An earlier upload is still unconfirmed. Use Recheck pending; this item will not be uploaded again.",
        verification: p.verification,
      });
    } else if (p.presence === "waiting" || p.presence === "unknown") {
      unresolved = true;
      set(r, { status: "blocked", reason: p.reason });
    } else if (p.presence === "different" && !o.allowUpdates) {
      collisions = true;
      set(r, {
        status: "blocked",
        reason:
          "Different content already exists. Review this item and enable Replace existing content to update it.",
        verification: p.verification,
      });
    } else
      set(r, {
        status: "handoff_ready",
        reason: p.reason,
        verification: p.verification,
      });
  }
  const finish = (message: string) => ({
    states,
    submitted,
    reused,
    verified: verified.size,
    remaining: selected.length - verified.size,
    message,
  });
  if (o.readOnly || unresolved || collisions)
    return finish(
      o.readOnly
        ? "Read-only check finished. No uploads were requested."
        : unresolved
          ? "No uploads started: some items need a QDN recheck. Review the list, then use Recheck pending."
          : "No uploads started: existing content needs your permission to replace it.",
    );

  const pending = new Set(
    selected.filter((r) => !verified.has(r.id)).map((r) => r.id),
  );
  const batches = planBatches(o.resources, pending);
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    if (batch.some((r) => r.dependsOn.some((dep) => !verified.has(dep))))
      return finish(
        "Paused: a required resource has not been verified. Use Recheck pending.",
      );
    await o.verifyAccount();
    o.progress({
      phase: "Uploading",
      done: verified.size,
      total: selected.length,
      detail:
        "Hub approval group " +
        (index + 1) +
        " of " +
        batches.length +
        " · " +
        batch.length +
        " items. Keep this page open while Hub uploads.",
    });
    // Persist uncertainty BEFORE entering the external signing/upload call.
    for (const r of batch)
      set(r, {
        status: "submitted",
        writeAttempted: true,
        submittedAt: new Date().toISOString(),
        reason: "Sent to Hub. Waiting for upload and confirmation.",
      });
    let response: unknown;
    let failure: unknown;
    try {
      response = await o.submit(batch);
    } catch (error) {
      failure = error;
    }
    submissionResults(batch, response, failure).forEach((result, i) =>
      set(batch[i], result),
    );
    const attempted = batch.filter((r) => states[r.id].status !== "declined");
    submitted += attempted.length;
    const confirmationBudget = Math.min(
      600_000,
      Math.max(
        120_000,
        (batch.reduce((sum, r) => sum + r.bytes, 0) / (1024 * 1024)) * 3000,
      ),
    );
    const deadline =
      Date.now() + (o.verificationBudgetMs ?? confirmationBudget);
    let first = true;
    while (
      attempted.some((r) => !verified.has(r.id)) &&
      (first || Date.now() < deadline)
    ) {
      first = false;
      for (const r of attempted.filter((r) => !verified.has(r.id))) {
        o.progress({
          phase: "Waiting for confirmation",
          done: verified.size,
          total: selected.length,
          detail:
            "Upload requested. Checking " +
            displayName(r) +
            " · do not publish again.",
        });
        const p = await o.probe(r);
        if (p.presence === "matching") matched(r, p);
        else
          set(r, {
            status: "pending_confirmation",
            reason:
              "Uploaded or submitted; exact QDN confirmation is not available yet. Recheck pending never re-uploads.",
            verification: p.verification,
          });
      }
      if (attempted.every((r) => verified.has(r.id)) || Date.now() >= deadline)
        break;
      await (
        o.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
      )(o.waitMs ?? 4000);
    }
    if (batch.some((r) => !verified.has(r.id)))
      return finish(
        "Paused after Hub request: " +
          verified.size +
          " verified; " +
          (selected.length - verified.size) +
          " remaining. Use Recheck pending to continue checking without another upload.",
      );
  }
  return finish(
    submitted === 0
      ? "All selected items already match QDN. No uploads were needed."
      : "Publishing complete. All selected items match QDN. Save the receipt for Migration Studio.",
  );
}

export function displayName(r: HandoffResource): string {
  return typeof r.metadata?.title === "string" && r.metadata.title.trim()
    ? r.metadata.title
    : r.relativePath.split("/").pop() || r.identifier;
}
export function formatSize(bytes: number): string {
  return bytes < 1024
    ? bytes + " B"
    : bytes < 1024 ** 2
      ? (bytes / 1024).toFixed(1) + " KB"
      : (bytes / 1024 ** 2).toFixed(1) + " MB";
}
