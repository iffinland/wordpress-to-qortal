import { useState } from "react";
import {
  buildContentConnection,
  connectionIdentifier,
} from "../lib/contentDiscovery.js";
import { discoverHostedQdnResource, fetchQdnResource } from "../lib/qortal.js";
import { createScopedStorage, storageScope } from "../lib/storageScope.js";
import { publishJsonResource } from "../lib/publish.js";
import type { CmsTemplateConfig, ViewerIdentity } from "../types";

export function ContentConnectionPanel(props: {
  config: CmsTemplateConfig;
  discovery?: any;
  identity: ViewerIdentity | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [choice, setChoice] = useState("");
  const owner = Boolean(
    props.identity?.owner &&
      props.identity.role === "owner" &&
      props.identity.nameRecordStatus === "verified",
  );
  if (!owner) return null;
  const candidates = props.discovery?.candidates || [];
  const selected = candidates.find(
    (item: any) => item.ref.identifier === choice,
  );
  async function connect() {
    if (!selected || busy) return;
    setBusy(true);
    setMessage("Checking the selected catalog…");
    try {
      const hosting = discoverHostedQdnResource(props.config.deployment || {});
      const document = buildContentConnection(hosting, selected);
      // Re-read the manifest before asking the owner to sign a permanent pointer.
      const raw = await fetchQdnResource(document.manifest);
      const { validateDiscoveredManifest } = await import(
        "../lib/contentDiscovery.js"
      );
      if (
        validateDiscoveredManifest(raw, document.manifest, hosting.name)
          .siteId !== selected.siteId
      )
        throw Error(
          "The selected catalog changed. Refresh the connection and choose again.",
        );
      setMessage(
        "Confirm one content-connection resource in Qortal Hub. Network fees may apply.",
      );
      const result = await publishJsonResource({
        identity: props.identity,
        name: hosting.name,
        identifier: await connectionIdentifier(hosting),
        document,
        storage: createScopedStorage(
          localStorage,
          storageScope({
            deployment: hosting,
            identity: props.identity,
            siteId: "content-connection",
          }),
        ),
        title: "CMS content connection",
        description:
          "Owner-selected imported site catalog. APP and WEBSITE use the same content connection.",
      });
      setMessage(
        result.message ||
          (result.ok
            ? "Content connection verified."
            : "The connection is not confirmed yet."),
      );
      if (result.ok) props.onRefresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="admin-section"
      aria-labelledby="content-connection-title"
    >
      <h2 id="content-connection-title">Content connection</h2>
      <p className="muted">
        Imported content belongs to this Qortal name. It can be read by a
        separate CMS, custom template, APP or WEBSITE.
      </p>
      <p>
        {props.config.content.manifestIdentifier ? (
          <>
            <strong>Connected catalog:</strong>{" "}
            <code>{props.config.content.manifestIdentifier}</code>
          </>
        ) : (
          props.discovery?.message || "No imported catalog is connected yet."
        )}
      </p>
      {(candidates.length > 1 ||
        (candidates.length > 0 &&
          props.discovery?.status === "unavailable")) && (
        <>
          <label>
            Imported site
            <select
              aria-label="Imported site catalog"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={busy}
            >
              <option value="">Choose the imported site…</option>
              {candidates.map((item: any) => (
                <option key={item.ref.identifier} value={item.ref.identifier}>
                  {item.title} · {item.siteId} · {item.ref.identifier}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Confirming publishes one connection document. This choice survives
            CMS replacement and is shared by APP and WEBSITE with the same
            deployment identifier.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => void connect()}
            disabled={busy || !selected}
          >
            {busy ? "Connecting…" : "Confirm content connection"}
          </button>
        </>
      )}
      <button
        type="button"
        className="button button--ghost"
        onClick={props.onRefresh}
        disabled={busy}
      >
        Refresh connection
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
