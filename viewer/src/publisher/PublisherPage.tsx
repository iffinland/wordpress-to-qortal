import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FileCheck2,
  FolderOpen,
  HelpCircle,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import {
  MAX_BATCH_RESOURCES,
  planBatches,
  type HandoffResource,
  type ValidatedHandoff,
} from "./handoff";
import {
  bridgeDiagnostics,
  getActiveAccount,
  getOwnedNames,
  getQortalRequest,
  requestQortal,
} from "./bridge";
import { evaluateNameOwnership, type OwnedName } from "./ownership";
import {
  createReceipt,
  downloadReceipt,
  type ReceiptDocument,
} from "./receipt";
import {
  displayName,
  formatSize,
  needsReconciliation,
  runPublication,
  selectWithDependencies,
  type Progress,
  type ResourceState,
} from "./workflow";
import { probeResource } from "./verification";
import { APP_VERSION } from "../version";
import { PublisherUpdate } from "./PublisherUpdate";
import "./publisher.css";

type Account = { address: string; publicKey?: string };
interface Session {
  handoffId: string;
  packageIntegrity?: string;
  selected: string[];
  states: Record<string, ResourceState>;
  accountAddress: string | null;
  accountName: string | null;
  receipt: ReceiptDocument | null;
  updatedAt: string;
}
const STORAGE_PREFIX = "qms-migration-publisher-v2:";
const PAGE_SIZE = 50;
function readSession(id: string): Session | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_PREFIX + id) || "null",
    );
    return value &&
      value.handoffId === id &&
      value.states &&
      typeof value.states === "object"
      ? value
      : null;
  } catch {
    return null;
  }
}
function history(): Session[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .map((k) => readSession(k.slice(STORAGE_PREFIX.length)))
      .filter((s): s is Session => Boolean(s))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
  } catch {
    return [];
  }
}
const statusLabels: Record<string, string> = {
  handoff_ready: "Ready",
  reserved: "Ready",
  remote_verified: "Verified",
  pending_confirmation: "Awaiting confirmation",
  submitted: "Sent to Hub",
  ambiguous: "Needs recheck",
  blocked: "Needs attention",
  failed: "Needs attention",
  declined: "Declined",
  partial: "Partly complete",
};
function statusLabel(state?: ResourceState) {
  return statusLabels[state?.status || "handoff_ready"] || "Ready";
}

export function PublisherPage({
  initialName = "",
  onBack,
}: {
  initialName?: string;
  onBack?: () => void;
}) {
  const [validated, setValidated] = useState<ValidatedHandoff | null>(null);
  const [filename, setFilename] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, ResourceState>>({});
  const [account, setAccount] = useState<Account | null>(null);
  const [ownedNames, setOwnedNames] = useState<OwnedName[]>([]);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [bridgeReady, setBridgeReady] = useState(Boolean(getQortalRequest()));
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDocument | null>(null);
  const [sessions, setSessions] = useState<Session[]>(history);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [fee, setFee] = useState<number | null>(null);
  const [feeBusy, setFeeBusy] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const running = useRef(false);
  const accountRef = useRef<Account | null>(null);
  const accountRequest = useRef<Promise<{
    active: Account;
    names: OwnedName[];
  }> | null>(null);
  const manifest = validated?.manifest;
  const targetName = manifest?.target.qdnName || initialName;
  const ownership = evaluateNameOwnership({
    targetName,
    accountAddress: account?.address,
    ownedNames,
  });
  const resources = manifest?.resources || [];
  const selectedResources = resources.filter((r) => selected.has(r.id));
  const plannedGroups = useMemo(
    () =>
      planBatches(
        resources,
        new Set(
          selectedResources
            .filter((r) => states[r.id]?.status !== "remote_verified")
            .map((r) => r.id),
        ),
      ).length,
    [manifest, selected, states],
  );
  const selectedBytes = selectedResources.reduce((sum, r) => sum + r.bytes, 0);
  const verifiedCount = selectedResources.filter(
    (r) => states[r.id]?.status === "remote_verified",
  ).length;
  const pendingCount = selectedResources.filter(
    (r) =>
      needsReconciliation(states[r.id]) &&
      states[r.id]?.status !== "remote_verified",
  ).length;
  const filtered = resources.filter(
    (r) =>
      (kind === "all" || r.kind === kind) &&
      (statusFilter === "all" ||
        (statusFilter === "attention"
          ? ["blocked", "failed", "ambiguous", "declined"].includes(
              states[r.id]?.status,
            )
          : states[r.id]?.status === statusFilter)) &&
      [displayName(r), r.identifier, r.service]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  async function identify() {
    if (accountRequest.current) return accountRequest.current;
    setAccountBusy(true);
    setAccountError("");
    const request = (async () => {
      try {
        const active = await getActiveAccount();
        const names = await getOwnedNames(active.address);
        if (accountRef.current && active.address !== accountRef.current.address)
          setApproved(false);
        accountRef.current = active;
        setAccount(active);
        setOwnedNames(names);
        return { active, names };
      } catch (err) {
        accountRef.current = null;
        setAccount(null);
        setOwnedNames([]);
        setApproved(false);
        setAccountError((err as Error).message);
        throw err;
      } finally {
        setAccountBusy(false);
        accountRequest.current = null;
      }
    })();
    accountRequest.current = request;
    return request;
  }
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const start = () => {
      if (cancelled) return;
      if (getQortalRequest()) {
        setBridgeReady(true);
        void identify().catch(() => {});
        return;
      }
      if (++attempts < 40) timer = setTimeout(start, 500);
    };
    start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    setPage(0);
  }, [query, kind, statusFilter]);
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: 0 });
  }, [currentPage]);

  function save(
    next: Record<string, ResourceState>,
    resultReceipt: ReceiptDocument | null = receipt,
  ) {
    setStates(next);
    if (!manifest) return;
    const value: Session = {
      handoffId: manifest.handoffId,
      packageIntegrity: manifest.integrity.value,
      selected: [...selected],
      states: next,
      accountAddress: accountRef.current?.address || null,
      accountName: targetName,
      receipt: resultReceipt,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(
        STORAGE_PREFIX + manifest.handoffId,
        JSON.stringify(value),
      );
      setSessions(history());
    } catch {
      setStorageWarning(
        "This Hub profile cannot save recovery data. Keep this page open and save the receipt before leaving.",
      );
    }
  }
  function resetConsent() {
    setApproved(false);
    setReceipt(null);
    setNotice("");
  }
  async function loadFiles(files: File[]) {
    if (!files.length || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setReceipt(null);
    setApproved(false);
    setAllowUpdates(false);
    setFee(null);
    setValidated(null);
    setStates({});
    setSelected(new Set());
    setQuery("");
    setKind("all");
    setStatusFilter("all");
    setPage(0);
    setProgress({
      phase: "Reading package",
      done: 0,
      total: 0,
      detail: "Preparing your files…",
    });
    try {
      const zip = files.length === 1 && /\.zip$/i.test(files[0].name);
      const result = await new Promise<ValidatedHandoff>((resolve, reject) => {
        const worker = new Worker(
          new URL("./import.worker.ts", import.meta.url),
          { type: "module" },
        );
        workerRef.current = worker;
        worker.onmessage = (event) => {
          if (event.data.error) {
            worker.terminate();
            reject(new Error(event.data.error));
          } else if (event.data.result) {
            worker.terminate();
            resolve(event.data.result);
          } else
            setProgress({
              phase: event.data.phase,
              detail: event.data.detail,
              done: 0,
              total: 0,
            });
        };
        worker.onerror = () => {
          worker.terminate();
          reject(
            new Error(
              "Package processing could not start. Reopen this app in Qortal Hub and try again.",
            ),
          );
        };
        worker.postMessage({ files, zip });
      });
      const remembered = readSession(result.manifest.handoffId);
      if (
        remembered?.packageIntegrity &&
        remembered.packageIntegrity !== result.manifest.integrity.value
      )
        throw new Error(
          "This package reuses a previous handoff ID with different content. Export a new Publisher package from Migration Studio.",
        );
      const ids = new Set(result.manifest.resources.map((r) => r.id));
      let restored = new Set<string>(
        (remembered?.selected || [...ids]).filter((id) => ids.has(id)),
      );
      // Repair old partial dependency selections on recovery.
      for (const id of [...restored])
        restored = selectWithDependencies(
          result.manifest.resources,
          new Set([...restored].filter((key) => key !== id)),
          id,
          true,
        );
      const next: Record<string, ResourceState> = Object.fromEntries(
        result.manifest.resources.map((r) => [
          r.id,
          remembered?.states[r.id] || {
            status: "handoff_ready" as const,
            reason: "Package validated. Ready for QDN checks.",
            txSignature: null,
            updatedAt: new Date().toISOString(),
          },
        ]),
      );
      setValidated(result);
      setSelected(restored);
      setStates(next);
      setReceipt(remembered?.receipt || null);
      setFilename(
        zip
          ? files[0].name
          : (
              files[0] as File & { webkitRelativePath?: string }
            ).webkitRelativePath?.split("/")[0] || "Selected folder",
      );
      setNotice(
        remembered
          ? "Previous progress restored. QDN content will be checked again before publishing."
          : "Package checked successfully. Review the selected items, then publish.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      workerRef.current = null;
      running.current = false;
      setBusy(false);
      setProgress(null);
    }
  }
  function select(r: HandoffResource, checked: boolean) {
    if (busy) return;
    resetConsent();
    setSelected((current) =>
      selectWithDependencies(resources, current, r.id, checked),
    );
  }
  function selectAll(all: boolean) {
    if (busy) return;
    resetConsent();
    setSelected(new Set(all ? resources.map((r) => r.id) : []));
  }

  async function quoteFee() {
    if (feeBusy || busy) return;
    setFeeBusy(true);
    try {
      const response = await fetch(
        "/transactions/unitfee?txType=ARBITRARY&timestamp=" + Date.now(),
        { cache: "no-store", signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw Error("No fee response");
      const atomic = Number((await response.text()).trim());
      if (!Number.isFinite(atomic) || atomic < 0) throw Error("Invalid fee");
      setFee(atomic / 1e8);
    } catch {
      setNotice(
        "A live fee estimate is unavailable. Hub shows the actual fee before you approve each group.",
      );
    } finally {
      setFeeBusy(false);
    }
  }
  function payloadFor(r: HandoffResource): Record<string, unknown> {
    const source = validated?.files.get(r.relativePath);
    if (!source) throw Error("Missing file: " + r.relativePath);
    const fileName =
      r.service === "APP" || r.service === "WEBSITE"
        ? r.identifier + ".zip"
        : r.relativePath.split("/").pop() || r.identifier;
    return {
      name: r.name,
      service: r.service,
      identifier: r.identifier,
      file: new File([source.file], fileName, { type: r.contentType }),
      filename: fileName,
      title: displayName(r),
      description: "Qortal Migration Studio handoff " + manifest?.handoffId,
      ...(r.service === "APP" || r.service === "WEBSITE"
        ? { isMultiFileZip: true }
        : {}),
    };
  }
  async function run(readOnly = false) {
    if (
      running.current ||
      !manifest ||
      !validated ||
      !selected.size ||
      (!readOnly && !approved)
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setReceipt(null);
    const startedAt = new Date().toISOString();
    let lastStates = { ...states };
    let actualAccount: Account | null = null;
    const expectedAddress = accountRef.current?.address;
    try {
      const result = await runPublication({
        resources,
        selected: new Set(selected),
        states,
        allowUpdates,
        readOnly,
        probe: probeResource,
        verifyAccount: async () => {
          const { active, names } = await identify();
          if (expectedAddress && active.address !== expectedAddress)
            throw Error(
              "The active account changed. Review the account shown above and approve the selection again.",
            );
          const owned = evaluateNameOwnership({
            targetName,
            accountAddress: active.address,
            ownedNames: names,
          });
          if (owned.state !== "verified") throw Error(owned.message);
          actualAccount = active;
        },
        submit: (batch) =>
          requestQortal({
            action: "PUBLISH_MULTIPLE_QDN_RESOURCES",
            resources: batch.map(payloadFor),
          }),
        save: (next) => {
          lastStates = next;
          save(next, null);
        },
        progress: setProgress,
      });
      lastStates = result.states;
      setNotice(
        result.message +
          " " +
          result.submitted +
          " items sent to Hub in this run · " +
          result.reused +
          " already present · " +
          result.remaining +
          " remaining.",
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      try {
        if (
          actualAccount &&
          selectedResources.some(
            (r) => lastStates[r.id]?.status !== "handoff_ready",
          )
        ) {
          const generated = await createReceipt({
            handoff: manifest,
            accountAddress: (actualAccount as Account).address,
            accountName: targetName,
            appVersion: APP_VERSION,
            createdAt: startedAt,
            results: selectedResources.map((r) => ({
              resourceId: r.id,
              service: r.service,
              name: r.name,
              identifier: r.identifier,
              status: lastStates[r.id]?.status || "handoff_ready",
              reason: lastStates[r.id]?.reason,
              txSignature: lastStates[r.id]?.txSignature,
              submittedAt: lastStates[r.id]?.submittedAt || null,
              confirmedAt: lastStates[r.id]?.confirmedAt || null,
              verification: lastStates[r.id]?.verification || null,
            })),
          });
          setReceipt(generated);
          save(lastStates, generated);
        }
      } catch (err) {
        setError(
          "Progress was saved, but the receipt could not be generated: " +
            (err as Error).message,
        );
      }
      running.current = false;
      setBusy(false);
      setApproved(false);
      setProgress(null);
    }
  }
  async function saveReceipt() {
    if (!receipt) return;
    try {
      await downloadReceipt(receipt);
      setNotice(
        "Receipt save requested. Import it into Qortal Migration Studio.",
      );
    } catch (err) {
      setError("Could not save the receipt: " + (err as Error).message);
    }
  }
  const matching = ownership.state === "verified";
  return (
    <main className="publisher-shell">
      <div className="mp-container">
        <header className="mp-header">
          <div>
            <div className="mp-brand">
              <span className="mp-brand-icon">
                <UploadCloud size={23} />
              </span>
              <span>QORTAL MIGRATION STUDIO</span>
            </div>
            <h1>Migration Publisher</h1>
            <p>
              Bring your prepared website to Qortal. Review once, publish with
              confidence.
            </p>
          </div>
          <div className="mp-header-meta">
            <span className="mp-version">Publisher {APP_VERSION}</span>
            <PublisherUpdate />
            {onBack && (
              <button className="mp-button" onClick={onBack} disabled={busy}>
                Back to preview
              </button>
            )}
          </div>
        </header>
        <ol className="mp-steps" aria-label="Publishing steps">
          <li className={!manifest ? "active" : "complete"}>
            <span>1</span>Choose package
          </li>
          <li className={manifest && !busy ? "active" : ""}>
            <span>2</span>Review items
          </li>
          <li className={busy && manifest ? "active" : ""}>
            <span>3</span>Publish & verify
          </li>
        </ol>
        <section
          className={"mp-account " + (matching && manifest ? "is-ready" : "")}
          aria-label="Publishing account"
        >
          <ShieldCheck size={23} />
          <div>
            <strong>
              {accountBusy
                ? "Checking your Qortal account…"
                : account
                  ? manifest
                    ? matching
                      ? "Publishing as " + targetName
                      : "Check the publishing account"
                    : "Qortal account connected"
                  : "Connect through Qortal Hub"}
            </strong>
            <p>
              {account
                ? account.address
                : bridgeReady
                  ? "Your active account is detected automatically. Hub may ask for permission."
                  : "Open this app in Qortal Hub to connect your account and publish."}
            </p>
            {manifest && (
              <p>
                Package owner: <b>{targetName}</b>
                {!accountBusy && !matching && account
                  ? " · " + ownership.message
                  : ""}
              </p>
            )}
            {accountError && <p className="mp-error-text">{accountError}</p>}
          </div>
          <span
            className={
              "mp-badge " + (matching && manifest ? "good" : "neutral")
            }
          >
            {accountBusy
              ? "Connecting"
              : matching && manifest
                ? "Owner verified"
                : account
                  ? "Connected"
                  : "Not connected"}
          </span>
          {!busy && (!account || accountError) && (
            <button
              className="mp-button"
              disabled={accountBusy}
              onClick={() => {
                setBridgeReady(Boolean(getQortalRequest()));
                void identify().catch(() => {});
              }}
            >
              <RefreshCw size={16} />
              Retry connection
            </button>
          )}
        </section>
        <section className="mp-card mp-import" aria-labelledby="package-title">
          <div className="mp-section-heading">
            <div>
              <span className="mp-kicker">YOUR PUBLISHER PACKAGE</span>
              <h2 id="package-title">
                {manifest
                  ? "Package ready for review"
                  : "Choose your migration ZIP"}
              </h2>
              <p>
                Use the Publisher package exported from Qortal Migration Studio.
              </p>
            </div>
            {manifest && (
              <span className="mp-badge good">
                <FileCheck2 size={15} />
                Validated
              </span>
            )}
          </div>
          <div
            className={"mp-dropzone " + (busy ? "is-disabled" : "")}
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) void loadFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span className="mp-upload-icon">
              {manifest ? <FileArchive size={30} /> : <UploadCloud size={32} />}
            </span>
            <div>
              <strong>{filename || "Drop your Publisher ZIP here"}</strong>
              <p>
                {manifest
                  ? manifest.resources.length +
                    " items · " +
                    formatSize(validated!.summary.bytes) +
                    " · " +
                    (manifest.cms?.selection === "content-only"
                      ? "Content only"
                      : "Prepared for publication")
                  : "Or choose a file below. ZIP and folder imports are limited to 512 MB."}
              </p>
            </div>
            <button
              type="button"
              className="mp-button primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <FolderOpen size={17} />
              {manifest ? "Change package" : "Choose ZIP"}
            </button>
            <input
              ref={inputRef}
              className="mp-file-input"
              aria-label="Publisher ZIP package"
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(event) => {
                void loadFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
          </div>
          <details className="mp-alternative">
            <summary>Use an exported folder instead</summary>
            <label>
              Choose the complete folder containing handoff.json
              <input
                type="file"
                aria-label="Publisher handoff folder"
                multiple
                {...{ webkitdirectory: "", directory: "" }}
                disabled={busy}
                onChange={(event) => {
                  void loadFiles(Array.from(event.target.files || []));
                  event.target.value = "";
                }}
              />
            </label>
          </details>
        </section>
        {storageWarning && (
          <div className="mp-alert danger" role="alert">
            <p>{storageWarning}</p>
          </div>
        )}
        {error && (
          <div className="mp-alert danger" role="alert">
            <strong>Action needed</strong>
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <div className="mp-alert info" role="status">
            <p>{notice}</p>
          </div>
        )}
        {progress && (
          <section className="mp-progress" role="status" aria-live="polite">
            <LoaderCircle className="mp-spin" size={22} />
            <div>
              <strong>{progress.phase}</strong>
              <p>{progress.detail}</p>
              {progress.total > 0 && (
                <>
                  <progress max={progress.total} value={progress.done} />
                  <span>
                    {progress.done} / {progress.total} checked or verified for
                    this stage
                  </span>
                </>
              )}
            </div>
          </section>
        )}
        {manifest && (
          <div className="mp-workspace">
            <section
              className="mp-card mp-resources"
              aria-labelledby="resources-title"
            >
              <div className="mp-section-heading">
                <div>
                  <span className="mp-kicker">PACKAGE CONTENTS</span>
                  <h2 id="resources-title">
                    Review your items{" "}
                    <span className="mp-count">{resources.length}</span>
                  </h2>
                  <p>
                    Select an item to include its required resources
                    automatically.
                  </p>
                </div>
              </div>
              <div className="mp-filters">
                <label className="mp-search">
                  <Search size={17} />
                  <span className="mp-sr-only">Search items</span>
                  <input
                    placeholder="Search titles or files…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <label>
                  <span className="mp-sr-only">Filter by type</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="media">Media</option>
                    <option value="content">Content</option>
                    <option value="index">Indexes</option>
                    <option value="manifest">Manifest</option>
                    <option value="site">Website</option>
                  </select>
                </label>
                <label>
                  <span className="mp-sr-only">Filter by status</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="handoff_ready">Ready</option>
                    <option value="remote_verified">Verified</option>
                    <option value="pending_confirmation">
                      Awaiting confirmation
                    </option>
                    <option value="attention">Needs attention</option>
                  </select>
                </label>
              </div>
              <div className="mp-list-toolbar">
                <span>
                  <b>{selected.size}</b> selected · {verifiedCount} verified
                </span>
                <div>
                  <button
                    className="mp-text-button"
                    disabled={busy}
                    onClick={() => selectAll(true)}
                  >
                    Select all
                  </button>
                  <button
                    className="mp-text-button"
                    disabled={busy}
                    onClick={() => selectAll(false)}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div
                ref={listRef}
                className="mp-scroll-list"
                tabIndex={0}
                aria-label="Package items, scroll to review"
              >
                {visible.length === 0 && (
                  <p className="mp-empty">No items match your filters.</p>
                )}
                {visible.map((r) => {
                  const state = states[r.id];
                  return (
                    <article key={r.id} className="mp-resource-row">
                      <div className="mp-resource-main">
                        <input
                          type="checkbox"
                          aria-label={"Select " + displayName(r)}
                          checked={selected.has(r.id)}
                          disabled={busy}
                          onChange={(e) => select(r, e.target.checked)}
                        />
                        <span className={"mp-kind-icon " + r.kind}>
                          <FileCheck2 size={18} />
                        </span>
                        <div className="mp-resource-title">
                          <strong title={displayName(r)}>
                            {displayName(r)}
                          </strong>
                          <span>
                            {r.kind === "site"
                              ? "Website"
                              : r.kind === "index"
                                ? "Index"
                                : r.kind === "media"
                                  ? "Media"
                                  : r.kind === "manifest"
                                    ? "Manifest"
                                    : "Content"}{" "}
                            · {formatSize(r.bytes)}
                          </span>
                        </div>
                        <span
                          className={
                            "mp-badge " +
                            (state?.status === "remote_verified"
                              ? "good"
                              : ["blocked", "failed", "declined"].includes(
                                    state?.status,
                                  )
                                ? "bad"
                                : [
                                      "submitted",
                                      "pending_confirmation",
                                      "ambiguous",
                                    ].includes(state?.status)
                                  ? "warn"
                                  : "neutral")
                          }
                        >
                          {statusLabel(state)}
                        </span>
                      </div>
                      <details className="mp-item-details">
                        <summary>
                          Details
                          {state &&
                          [
                            "blocked",
                            "pending_confirmation",
                            "ambiguous",
                            "failed",
                            "declined",
                          ].includes(state.status)
                            ? " · " + state.reason
                            : ""}
                        </summary>
                        <p>{state?.reason}</p>
                        <dl>
                          <dt>QDN resource</dt>
                          <dd>
                            {r.service} / {r.name} / {r.identifier}
                          </dd>
                          <dt>File</dt>
                          <dd>{r.relativePath}</dd>
                          <dt>Required items</dt>
                          <dd>{r.dependsOn.length}</dd>
                          <dt>SHA-256</dt>
                          <dd>
                            <code>{r.sha256}</code>
                          </dd>
                          {state?.txSignature && (
                            <>
                              <dt>Transaction</dt>
                              <dd>
                                <code>{state.txSignature}</code>
                              </dd>
                            </>
                          )}
                        </dl>
                      </details>
                    </article>
                  );
                })}
              </div>
              <div className="mp-pagination">
                <span>
                  {filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–
                  {Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of{" "}
                  {filtered.length} items
                </span>
                <div>
                  <button
                    className="mp-icon-button"
                    aria-label="Previous items"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    {currentPage + 1} / {pages}
                  </span>
                  <button
                    className="mp-icon-button"
                    aria-label="Next items"
                    disabled={currentPage >= pages - 1}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </section>
            <aside
              className="mp-card mp-publish"
              aria-labelledby="publish-title"
            >
              <span className="mp-kicker">READY WHEN YOU ARE</span>
              <h2 id="publish-title">Publish to Qortal</h2>
              <p>Hub handles your wallet, signing and network fee approval.</p>
              <dl className="mp-totals">
                <dt>Selected items</dt>
                <dd>{selected.size}</dd>
                <dt>Total size</dt>
                <dd>{formatSize(selectedBytes)}</dd>
                <dt>Approval groups</dt>
                <dd>{plannedGroups || "None needed"}</dd>
                <dt>Fee estimate</dt>
                <dd>
                  {fee === null
                    ? "Shown by Hub"
                    : (
                        fee *
                        selectedResources.filter(
                          (r) => states[r.id]?.status !== "remote_verified",
                        ).length
                      ).toFixed(8) + " QORT"}
                </dd>
              </dl>
              <button
                className="mp-text-button"
                disabled={busy || feeBusy}
                onClick={() => void quoteFee()}
              >
                {feeBusy ? "Getting estimate…" : "Refresh fee estimate"}
              </button>
              <p className="mp-caption">
                Up to {MAX_BATCH_RESOURCES} items per group. Required items are
                verified before the next group. Groups may decrease after QDN
                checks. If Hub offers session permission, you can use it to
                reduce repeated prompts.
              </p>
              <label className="mp-consent">
                <input
                  type="checkbox"
                  checked={allowUpdates}
                  disabled={busy}
                  onChange={(e) => {
                    resetConsent();
                    setAllowUpdates(e.target.checked);
                  }}
                />
                <span>
                  <strong>Replace existing content</strong>
                  <small>
                    Allow updates when QDN content differs from this package.
                  </small>
                </span>
              </label>
              <label className="mp-consent">
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy || !matching || !selected.size}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                <span>
                  <strong>I approve this selection</strong>
                  <small>
                    Publish these {selected.size} items and approve the network
                    fees in Hub.
                  </small>
                </span>
              </label>
              <button
                className="mp-button primary mp-publish-button"
                disabled={
                  busy ||
                  !bridgeReady ||
                  !matching ||
                  !approved ||
                  !selected.size ||
                  pendingCount > 0
                }
                onClick={() => void run()}
              >
                {busy ? (
                  <LoaderCircle className="mp-spin" size={18} />
                ) : (
                  <Send size={18} />
                )}{" "}
                {busy ? "Working…" : "Approve & publish"}
                {!busy && <ArrowRight size={17} />}
              </button>
              <button
                className="mp-button mp-recheck"
                disabled={busy || !bridgeReady || !selected.size || accountBusy}
                onClick={() => void run(true)}
              >
                <RefreshCw size={16} />
                {pendingCount ? "Recheck pending" : "Check QDN content"}
              </button>
              <p className="mp-caption">
                Recheck only reads QDN. It never uploads files or asks you to
                pay again.
              </p>
            </aside>
          </div>
        )}
        {receipt && (
          <section className="mp-card mp-result">
            <span className="mp-result-icon">
              <CheckCircle2 size={25} />
            </span>
            <div>
              <span className="mp-kicker">PUBLICATION RECEIPT</span>
              <h2>
                {verifiedCount === selected.size
                  ? "All selected items verified"
                  : "Your progress is recorded"}
              </h2>
              <p>
                {verifiedCount} verified ·{" "}
                {Math.max(0, selected.size - verifiedCount)} remaining. Save
                this receipt and import it into Qortal Migration Studio.
              </p>
            </div>
            <button
              className="mp-button primary"
              disabled={busy}
              onClick={() => void saveReceipt()}
            >
              <FileCheck2 size={17} />
              Save receipt
            </button>
          </section>
        )}
        <section className="mp-bottom">
          <details className="mp-card mp-help">
            <summary>
              <HelpCircle size={18} />
              How publishing works
            </summary>
            <ol>
              <li>
                Export a Publisher ZIP from Qortal Migration Studio and load it
                here.
              </li>
              <li>
                Your active Qortal account must own the exact name in the
                package.
              </li>
              <li>
                Review your selection, approve it and confirm the grouped
                requests in Hub.
              </li>
              <li>
                Keep this page open during upload and verification. A pending
                result needs a recheck, not another upload.
              </li>
              <li>
                Save the receipt, import it into Migration Studio and run its
                independent verification.
              </li>
            </ol>
            <details>
              <summary>Technical connection details</summary>
              <pre>{JSON.stringify(bridgeDiagnostics(), null, 2)}</pre>
            </details>
          </details>
          {sessions.length > 0 && (
            <details className="mp-card mp-help">
              <summary>
                <RefreshCw size={18} />
                Recent sessions
              </summary>
              <p>
                Load the same ZIP to restore progress. Nothing is uploaded
                automatically.
              </p>
              <ul>
                {sessions.map((s) => (
                  <li key={s.handoffId}>
                    <strong>{s.accountName || s.handoffId}</strong>
                    <span>
                      {
                        Object.values(s.states).filter(
                          (r) => r.status === "remote_verified",
                        ).length
                      }{" "}
                      / {Object.keys(s.states).length} verified ·{" "}
                      {new Date(s.updatedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
        <footer className="mp-footer">
          <ShieldCheck size={15} />
          Your keys stay in Qortal Hub. Migration Publisher never asks for your
          wallet password or seed.
        </footer>
      </div>
    </main>
  );
}
