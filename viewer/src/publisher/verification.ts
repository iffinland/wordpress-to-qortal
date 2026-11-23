import { fetchQdnBase64, getResourceStatus, requestQortal } from "./bridge";
import { sha256Bytes, type HandoffResource } from "./handoff";
import type { Probe } from "./workflow";

function decode(value: unknown): Uint8Array {
  if (typeof value !== "string")
    throw new Error("The node did not return exact file bytes.");
  const text = value.replace(/\s+/g, "");
  if (text && (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4))
    throw new Error("The node returned an invalid file response.");
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}
async function memberBytes(r: HandoffResource, filepath: string) {
  try {
    return decode(
      await requestQortal({
        action: "FETCH_QDN_RESOURCE",
        service: r.service,
        name: r.name,
        identifier: r.identifier,
        filepath,
        encoding: "base64",
      }),
    );
  } catch {
    const params = new URLSearchParams({ filepath, encoding: "base64" });
    const response = await fetch(
      "/arbitrary/" +
        [r.service, r.name, r.identifier].map(encodeURIComponent).join("/") +
        "?" +
        params,
      { cache: "no-store", signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok)
      throw new Error("File read is not ready (HTTP " + response.status + ").");
    return decode(await response.text());
  }
}
async function inspect(r: HandoffResource): Promise<Probe> {
  try {
    const raw = await getResourceStatus(r.service, r.name, r.identifier);
    const status =
      raw && typeof raw === "object"
        ? (raw as { status?: string | number }).status
        : "";
    const name =
      typeof status === "number"
        ? (
            {
              1: "PUBLISHED",
              2: "NOT_PUBLISHED",
              3: "DOWNLOADING",
              4: "DOWNLOADED",
              5: "BUILDING",
              6: "READY",
              7: "MISSING_DATA",
              8: "BUILD_FAILED",
              9: "UNSUPPORTED",
              10: "BLOCKED",
            } as Record<number, string>
          )[status]
        : status;
    if (name === "NOT_PUBLISHED")
      return { presence: "new", reason: "New item. Ready to upload." };
    if (!name)
      return {
        presence: "unknown",
        reason:
          "QDN did not return a usable status. Recheck before publishing.",
      };
    if (["UNSUPPORTED", "BLOCKED", "BUILD_FAILED"].includes(name))
      return {
        presence: "unknown",
        reason:
          "The node reports " +
          name.toLowerCase().replace(/_/g, " ") +
          ". Check the node and try Recheck pending.",
      };
    if (name !== "READY") {
      // Trigger the local build; MISSING_DATA is existing-but-unavailable, never new.
      await requestQortal({
        action: "GET_QDN_RESOURCE_STATUS",
        service: r.service,
        name: r.name,
        identifier: r.identifier,
        build: true,
      });
      return {
        presence: "waiting",
        reason:
          "QDN is preparing this item (" +
          name.toLowerCase().replace(/_/g, " ") +
          "). Recheck pending; no new upload is needed yet.",
      };
    }
    if (r.service === "APP" || r.service === "WEBSITE") {
      const members = r.metadata?.bundle?.files;
      if (!members?.length)
        return {
          presence: "unknown",
          reason: "The site has no file manifest for verification.",
        };
      const verified = [];
      for (const member of members) {
        const bytes = await memberBytes(r, member.path);
        const hash = await sha256Bytes(bytes);
        if (bytes.length !== member.bytes || hash !== member.sha256)
          return {
            presence: "different",
            reason: "Existing site content differs: " + member.path,
            verification: {
              path: member.path,
              expectedHash: member.sha256,
              remoteHash: hash,
            },
          };
        verified.push({ path: member.path, bytes: bytes.length, sha256: hash });
      }
      return {
        presence: "matching",
        reason: "Every site file matches the package.",
        verification: { transport: "filepath:base64", members: verified },
      };
    }
    const bytes = await fetchQdnBase64(r.service, r.name, r.identifier);
    const hash = await sha256Bytes(bytes);
    const verification = {
      transport: "qortalRequest:FETCH_QDN_RESOURCE:base64",
      expectedHash: r.sha256,
      remoteHash: hash,
      expectedBytes: r.bytes,
      remoteBytes: bytes.length,
    };
    return bytes.length === r.bytes && hash === r.sha256
      ? {
          presence: "matching",
          reason: "Exact content verified on QDN.",
          verification,
        }
      : {
          presence: "different",
          reason: "Different content already exists on QDN.",
          verification,
        };
  } catch (error) {
    return {
      presence: "unknown",
      reason: "Could not verify QDN: " + (error as Error).message,
    };
  }
}
export async function probeResource(r: HandoffResource): Promise<Probe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      inspect(r),
      new Promise<Probe>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              presence: "unknown",
              reason:
                "QDN check timed out. Use Recheck pending; no upload was started by this check.",
            }),
          45_000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
