# Qortal Migration Studio user manual

This operating manual follows the Qortal Migration Studio desktop UI in its real order. It covers use, not installation. QMS prepares local material; Qortal Hub performs wallet signing and approval.

## 1. Dashboard: create or resume a site

Choose **New site/project — new identity and catalog** for a new migration. Enter **Project Name** as a recognizable local label, such as `My magazine 2026`; it is not the WordPress URL or Qortal name. A new project creates an independent site identity and catalog even if another project uses the same Qortal name.

Use **Continue this site** only to resume that local project. Its controls open **History & diagnostics**, **Sync**, **Recovery**, and **Publishing**. **Open workspace folder** reveals the local workspace; choose a different workspace before creating a project if it lacks disk space.

## 2. Project setup wizard

The numbered step bar is the operating order. **Back** returns to a saved prior step; **Continue** saves this screen. **Back to dashboard** exits setup. Resolve any **Check this step** message before moving forward.

### Step 1 — Choose the source CMS

Choose the card for the source CMS, normally WordPress. The card exposes the adapter's version, contract, supported **Content**, **Auth**, terms, states, assets, and reported unsupported features. This is capability information; select the adapter that actually matches the source, then click **Continue**.

### Step 2 — Connect to WordPress

1. Enter the base address in **WordPress site URL**, for example `https://example.org`. Do not add `/wp-json/wp/v2`: QMS discovers the REST root.
2. Select **Authentication mode**:
   - **Public REST API (no login)** reads public published content.
   - **Application password (recommended)** uses a revocable WordPress application password for protected media, drafts, or private content.
   - **Login session (legacy)** uses the normal WordPress login password and may be blocked by a host.
3. With a signed-in mode, enter **Username**. Application-password mode shows **Application password**; session mode shows **WordPress login password**.
4. Tick **Remember credentials in the Linux keyring** only when a keyring is available and you want the local-machine convenience. Otherwise credentials remain in memory for this session. They are never put in project files or logs.
5. Click **Test connection**. Check the returned site name, address, authentication state, content-type counts, warnings, and unsupported features. It performs no publication. Click **Continue** for the intended source.

### Step 3 — Qortal destination

| Exact UI control | What to enter/select and effect |
| --- | --- |
| **Target Qortal name** | Exact registered name, 3–40 UTF-8 bytes. It is the planned target; remote ownership is checked later. |
| **Website title** | Visitor-facing CMS title. |
| **Tagline** | Optional subtitle shown under the site title. |
| **Website description** | Optional site description. |
| **Website template** | **Generic CMS (recommended)** includes a website bundle. **Content only (no website bundle)** intentionally omits it. |
| **Website hosting service** | Choose **APP — application bundle** or **WEBSITE — classic QDN website**. They are separate deployments. |
| **Accent colour** | Theme color such as `#4da3ff`. |

**Generated site identity** and namespace are automatic, immutable values; do not try to type them. **Advanced details** explains that the public CMS uses identifier `default`. Read the service warning: switching APP/WEBSITE creates another deployment; it does not overwrite the existing service. Click **Continue**.

### Step 4 — Import preferences and source scan

Set **Items prepared per batch** to the number for this run (default 15; use 1 for a one-item run). It is not a total-site limit. Tick each required **Content types** option. **Published after** and **Published before** are optional UTC-inclusive dates; blank means no bound. **Applied published-date filter** shows the effective interval.

Open **Advanced storage, media and recovery settings** only when needed:

| Control | Meaning |
| --- | --- |
| **Minimum free disk (GiB)** | Space QMS must retain in the workspace. |
| **Maximum download per run (GiB)** | Download ceiling; 0 is unlimited. |
| **Maximum file size (MiB)** / **Maximum files per run** | Per-run media safety limits. |
| **Unknown-size policy** | **Reject the plan**, **Account at the per-file cap**, or **Account at the per-file cap as an estimate**. Unknown is never zero. |
| **Media concurrency** | Parallel download count, 1–32. |
| **Download external media (default is link-only)** | Fetch outside-host media only when deliberately selected. |
| **Re-include reserved items for preparation** | Recovery setting; it never marks material published. |
| **Also download media-library attachments the post never references** | Normally leave off; it can add many files. |

Under **Source scan**, choose **Quick scan — selected batch (recommended)** for a bounded scan. Set **Index up to (newest matching items)** from 1–100, click **Run quick scan**, then **Confirm quick scan and continue** when prompted. This prevents Continue from silently starting an unbounded scan.

Use **Full site inventory (explicitly chosen; can be very long)** only when every selected content type, taxonomy, and media item is necessary. Tick **I understand this can crawl the entire site before any content is prepared**, then click **Run full inventory** or **Confirm full inventory and continue**. During a scan, **Pause** preserves its checkpoint; **Cancel scan** ends the attempt while keeping verified files; **Resume interrupted scan from checkpoint** resumes an offered checkpoint.

Read discovered/scanned/selected counts, scope, API pages, dependencies, terms, and warnings. **Check disk** reports free space, reserve, and fit. Continue only after an explicit completed scan.

### Step 5 — Plan review and local approval

Click **Refresh preview** to create the local `qms-plan@1` preview. Inspect **Selected**, **Scanned**, **New**, **Modified**, **Route-only**, **Unchanged (verified)**, **Reserved pending**, and **Conflicts**; use **Technical details** only for a displayed planning failure. An empty selection cannot be approved.

Click **Approve local preparation** to reserve identity mappings and write the ready plan. It does not sign, spend QORT, or publish.

## 3. Publishing: handoff, receipt, and exact verification

Open **Publishing** for the ready plan. In **Completed plan**, choose the plan. Tick **USE** for each resource; inspect its type, title, QDN identifier, status, and media count. Click **Generate handoff package**. This creates local, hashed bytes only.

At **Handoff ready**, click **Export Publisher package (.zip)**, then open it in Migration Publisher in Qortal Hub. **Open handoff folder** only reveals the local handoff directory.

After Publisher returns a result, use **Import Publisher receipt and verify QDN** in this order:

1. Choose the saved **Handoff package**.
2. Optionally enter a local/forwarded URL in **Qortal node for read-only verification** (for example `http://127.0.0.1:24991`); use **Test connection** and **Save as preferred node**.
3. In **Publisher receipt JSON**, choose the JSON saved by Publisher, then click **Import receipt**. Receipt results are Publisher-reported evidence, not remote proof.
4. Set **Verification attempts** if needed and click **Run independent QDN verification**. QMS reads every resource and compares length and SHA-256.

**Package existing handoff (.zip)** packages the selected handoff without recreating resources. **Open selected handoff folder** reveals it; **Open published website** opens the configured site where available. Only **remote verified** means exact read-back matched. **submitted**, **pending confirmation**, and **ambiguous** are not success and are never auto-resubmitted. **failed**, **declined**, and **blocked** require explicit later action.

