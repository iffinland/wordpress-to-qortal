import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { App } from "../src/App";
import { readFixture, ownerIdentity } from "./support/fixtures";

const name = "jussi-olen";
const identifier = "qms-nsabcdefgh-man-site-manifest-0123456789";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const key of [
    "_qdnName",
    "_qdnService",
    "_qdnIdentifier",
    "qortalRequest",
  ])
    delete (window as any)[key];
});
it.each(["APP", "WEBSITE"])(
  "shows independently imported content on the real %s homepage and owner editor",
  async (service) => {
    Object.assign(window, {
      _qdnName: name,
      _qdnService: service,
      _qdnIdentifier: "default",
    });
    const raw = JSON.parse(
      JSON.stringify(readFixture("qms-cms-manifest.json"))
        .split("QortalDemo")
        .join(name),
    );
    raw.generated_at = new Date().toISOString();
    const resources = new Map<string, any>([[identifier, raw]]);
    for (const [id, ref] of Object.entries<any>(raw.resources.by_identifier))
      resources.set(
        id,
        JSON.parse(
          JSON.stringify(readFixture(ref.local_path))
            .split("QortalDemo")
            .join(name),
        ),
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.includes("/names/"))
          return {
            ok: true,
            json: async () => ({ name, owner: ownerIdentity.address }),
          };
        if (url.pathname === "/arbitrary/resources/search")
          return {
            ok: true,
            json: async () =>
              url.searchParams.get("mode") !== "ALL" || url.searchParams.has("identifier")
                ? []
                : [{ name, service: "DOCUMENT", identifier }],
          };
        const parts = url.pathname
          .split("/")
          .filter(Boolean)
          .map(decodeURIComponent);
        if (
          parts[0] === "arbitrary" &&
          parts[1] === "DOCUMENT" &&
          parts[2] === name &&
          resources.has(parts[3])
        )
          return { ok: true, json: async () => resources.get(parts[3]) };
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "",
        };
      }),
    );
    (window as any).qortalRequest = vi.fn(async (p: any) => {
      if (p.action === "GET_USER_ACCOUNT")
        return { address: ownerIdentity.address };
      if (p.action === "GET_ACCOUNT_NAMES") return [{ name }];
      if (p.action === "GET_PRIMARY_NAME") return name;
      if (p.action === "GET_NAME_DATA")
        return { name, owner: ownerIdentity.address };
      return null;
    });
    render(<App />);
    await screen.findByText("Hello Qortal");
    expect(screen.queryByText("The catalog could not be loaded")).toBeNull();
    window.history.replaceState(null, "", "/#/admin");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findByRole("heading", { name: /^Admin$/ });
    expect(
      screen.getByRole("heading", { name: "Content connection" }),
    ).toBeTruthy();
    expect(screen.getByText(identifier)).toBeTruthy();
    window.history.replaceState(null, "", "/#/admin/editor");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByText("Hello Qortal")).toBeTruthy());
    expect(screen.queryByText("Access denied")).toBeNull();
  },
);
