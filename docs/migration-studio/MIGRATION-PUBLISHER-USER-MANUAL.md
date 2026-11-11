# Migration Publisher user manual

Migration Publisher is the Qortal Hub Q-App that publishes a QMS handoff. It never requests a wallet seed, private key, or wallet password: Qortal Hub handles signing and fee approval. This manual begins with the Q-App open in Hub; it does not cover installation or deployment of the Q-App itself.

## 1. Load and inspect the handoff

Choose one input at the top:

- **Handoff folder** opens the Hub folder picker. Select an extracted QMS handoff folder.
- **Publisher package (.zip)** opens a ZIP picker. Select the portable ZIP exported by QMS.

Wait for **Publisher package loaded**, which reports the handoff ID, resource count, and package-bound target. If loading/validation fails, stop and return to QMS; never edit the package to force it through. A valid package means every payload hash matches `handoff.json`, not that any resource is already published.

## 2. Connect the account and choose the target name

Click **Connect Qortal account**; after connection it is **Refresh active account**. The summary displays the active address. With a validated package and account, click **Check remote state** to check remote presence and collisions before approval.

**Target Qortal name** is the exact registered name. It is prefilled by the handoff. Do not shorten it, change case, or use a lookalike: matching is exact NFKC without case folding. When more than one name is owned, the **Owned Qortal names** picker appears; select the registered target. A loaded package remains bound to its recorded name, so this field cannot retarget the package.

If the page says **Qortal request API is not available**, open the Q-App in Qortal Hub instead of a normal browser. Read ownership warnings or confirmation before continuing.

## 3. Review resources, collisions, and CMS choice

After validation, each resource row exposes a square selection button, **kind · identifier**, service, byte count, content type, dependency count, SHA-256, publication status, and remote **presence**. Click its square to include/exclude it. **Select all** chooses every listed resource; **Clear** removes the selection. Keep dependency resources selected.

**Authorize updates to existing resources (N collisions)** is off by default. Turn it on only if the remote-state results identify exact existing resources you deliberately authorize for update. Leaving it off prevents a collision from being overwritten.

The CMS message identifies either a **Generic CMS** APP/WEBSITE bundle, which follows its dependencies, or **Content only**, which intentionally has no website bundle. This selection does not add content. **remote verified** means an exact read-back hash matched. **submitted** is not final. Pending/ambiguous results halt automatic continuation; they are not re-submitted.

## 4. Quote, approve, and publish

The footer displays the handoff **Estimate**, selected batch count, and label. It is not a live fee. Click **Get live network fee quote** to retrieve the current amount; read its per-resource QORT amount, selected-count total, and timestamp.

Before publishing, tick **I explicitly approve publishing these N resources and the Qortal Hub network fee**. Recheck the resource selection, target name, collision authorization, and live fee. Then click **Approve and publish selected set**. Hub presents the authoritative signing/fee approval; Publisher performs bounded batches and stops on ambiguous or pending outcomes. Do not reload it to force retries.

**Previous sessions** is local recovery state for this Hub profile. Load the same handoff folder to resume. Nothing is resubmitted automatically.

## 5. Export the receipt and complete verification

The **Receipt** panel shows receipt ID, outcome count, and each status count. Click **Save receipt** to write the JSON needed by QMS, or **Copy JSON** to copy it. Return to QMS Publishing, import the JSON, and run its independent QDN read-back verification. A Publisher receipt is evidence of Publisher's report, not proof that the intended remote bytes can be read.

