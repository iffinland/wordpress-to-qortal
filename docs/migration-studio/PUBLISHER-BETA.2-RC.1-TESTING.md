# Publisher 0.8.0-beta.2 — accepted RC.1 runtime evidence

Status: **Runtime test passed**, reported by the owner on 2026-11-23. The owner authorized main integration and an independent Publisher ZIP release. The accepted RC.1 bytes are retained as Publisher 0.8.0-beta.2; Desktop and CMS are unchanged.

## Runtime acceptance

1. Publish the supplied Q-App ZIP as the test Publisher and open it in Qortal Hub. Confirm automatic account detection, including correct ownership for the name recorded by your QMS handoff.
2. Load a real QMS Publisher ZIP. Check the scrolling list, item details, search, filters and mobile view. Selecting dependencies and changing the selection must reset approval.
3. With new content, approve once. Observe checking, grouped Hub requests, uploads and exact verification in the same run. A no-upload result must give its reason explicitly.
4. Confirm each group in Hub. A group contains up to 20 independent resources. Dependencies need separate verified stages; Hub owns session permissions and the number of permission dialogs.
5. If confirmation is delayed, use Recheck pending. It must not create a new upload or fee request. Restore the same handoff and confirm the same protection survives reopening.
6. Save the receipt, import it into QMS and run independent read-back verification. Also check an intentional existing-content update with Replace existing content enabled.

## Automated checks

`node --test test/publisher/*.test.js test/phase5/*.test.js`: 67 passing tests. The UI suite builds and executes the production bundle and emitted import worker in JSDOM with a simulated Hub bridge. This verifies behavior, not actual Hub transactions or browser pixels.

`npm run publisher:validate`, `npm run publisher:package`, `npm run version:check` and `git diff --check` passed.

The original candidate was deliberately uncommitted and unpublished. Its missing full-bundle release artifacts were not an authorization to rebuild the DEB or CMS. The accepted component is now delivered through the Publisher-only workflow, which verifies the accepted ZIP hash, clean committed source, unchanged Desktop/CMS inputs and public artifact hashes, strict documentation and post-publication links. Existing full-bundle gates remain unchanged.

Original audit/runtime base: `b40213233ec03061f072cad119f9e1f999a34076`. The independent release manifest records the final committed source. Worktree completion is recorded after remote main verification.
