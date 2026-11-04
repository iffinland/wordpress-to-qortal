# First-run guide

This guide assumes Qortal Migration Studio 0.6.0 alpha is installed from the
Debian package. You do not need Node.js, npm, Git or a terminal after install.

## 1. Start the application

Open **Qortal Migration Studio** from the application menu, or run:

~~~bash
qortal-migration-studio
~~~

The dashboard lists migration projects. On first launch it is empty.

## 2. Create a project

Select **Create project** and enter a name. A project is an isolated workspace:
its own site identity, local storage, plans, handoffs and history. You can keep
several independent projects and archive one without touching another.

After creation, choose **Open** to start the wizard.

## 3. Wizard step 1 — Source CMS

Select **WordPress REST API**. This alpha supports WordPress posts and pages,
plus categories and tags.

## 4. Wizard step 2 — WordPress connection

Enter the site URL, for example `https://example.org`. QMS discovers the REST
API root automatically.

- **None** works for public sites that expose the REST API.
- **Application password** is for sites that require authentication. The
  password is used for the session and is never written to project state.
- **Password** uses the WordPress login endpoint as a fallback.

Select **Test connection**. Confirm the site name and the reported counts for
posts, pages, categories and tags. Unsupported content types are listed; they
are reported, not migrated.

## 5. Wizard step 3 — Qortal destination

Enter the Qortal name that will own the published resources. The name must be
3–40 letters, digits, underscores or hyphens. QMS does not ask for a seed,
private key or wallet password. Signing stays in Qortal Hub.

A site identity (`siteId`) is generated automatically and remains stable for
the project.

## 6. Wizard step 4 — Import preferences

Choose the batch size (default 15), content types, optional date filters, and
disk/media limits.

- **Minimum free disk** is a hard reserve. QMS refuses work that would cross it.
- **Maximum download per run** and **maximum files per run** bound each media
  download.
- **Unknown-size policy** decides whether unknown media is rejected or
  estimated. Unknown is never treated as zero.

Select **Check disk** before a large first import.

## 7. Wizard step 5 — Plan and review

Select **Refresh preview**. Review:

- how many items are new, modified, unchanged, reserved, conflicting or
  unsupported;
- the estimated media bytes and resource count;
- warnings for unsupported plugin functionality.

Nothing is published here. **Approve local preparation** creates a local plan
and the first batch. You can stop after this step and still keep a complete
project.

## 8. What to do next

- [MIGRATION-WALKTHROUGH.md](MIGRATION-WALKTHROUGH.md) continues from the plan
  to media download, Hub handoff, receipt import and verification.
- [SYNC-AND-RECOVERY.md](SYNC-AND-RECOVERY.md) covers later updates, conflicts,
  interrupted runs, cleanup and diagnostics.

## Where data lives

| Data | Location |
| --- | --- |
| Projects, media, handoffs, history | `$XDG_DATA_HOME/qortal-migration-studio` (default `~/.local/share/qortal-migration-studio`) |
| Window/config state | `$XDG_CONFIG_HOME/Qortal Migration Studio` |
| Program files | `/opt/qortal-migration-studio` |

Removing or upgrading the package does not delete project data.
