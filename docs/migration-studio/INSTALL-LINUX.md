# Install Qortal Migration Studio on Linux

This guide installs the self-contained Debian package. The target machine does
not need Node.js, npm, Git or development tools.

This is the **0.8.0 alpha.5** release. It is unsigned and amd64 only. Read
[alpha/RELEASE-NOTES.md](alpha/RELEASE-NOTES.md) and
[alpha/KNOWN-ISSUES.md](alpha/KNOWN-ISSUES.md) before installing.

The beginner path needs **no Node.js, npm, Git, compiler or terminal build step**.
Download the .deb from the release, verify it, and install it with apt. Source
building is documented separately in
[DEVELOPER-BUILD.md](DEVELOPER-BUILD.md).

## Supported systems

- Debian 12 (bookworm)
- Debian 13 (trixie)
- Debian-based distributions with equivalent packages, including MX Linux 23
  (Debian 12 base). MX Linux is a compatibility target; the install and engine
  tests are run on Debian 12/13 and on an extracted .deb without system Node.

The package is amd64 only in this release.

## Verify the download

~~~bash
sha256sum qortal-migration-studio_0.8.0-alpha.5_amd64.deb
cat SHA256SUMS
~~~

The artifact is **unsigned** in this alpha release. Compare the SHA-256 with the
published value and inspect sbom.cdx.json and provenance.intoto.json before
installing. Do not install an artifact whose hash does not match.

## Install

~~~bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.5_amd64.deb
~~~

apt resolves the GTK, NSS, libsecret and audio dependencies. Launch **Qortal
Migration Studio** from the desktop application menu, or run:

~~~bash
qortal-migration-studio
~~~

Verify the installed version:

~~~bash
dpkg-query -W -f='${Version}\n' qortal-migration-studio
# expected: 0.8.0~alpha.5
~~~

Downloading the .deb installs the migration tool. It does **not** publish
anything to QDN. Publishing is a separate, explicit action in a later step; a
downloaded Q-App ZIP is likewise not deployed until an owner publishes it.

## Upgrading from 0.8.0-alpha.3 (startup failure fix)

0.8.0-alpha.3 could install but abort with
`QMS_STARTUP_FAILED: Engine host connection closed.` because its engine bundle
referenced `fflate` without shipping it. 0.8.0-alpha.5 ships and verifies the
complete engine runtime. Replace the package in place:

~~~bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.5_amd64.deb
qortal-migration-studio
~~~

If the app is already running, quit it first. The package replaces only
`/opt/qortal-migration-studio`. Projects, media, handoffs and history under
`~/.local/share/qortal-migration-studio` are preserved.

Do **not** run `npm install` or install Node.js to work around the old error.
The .deb is self-contained; a package that needs host npm is a packaging bug.

## Where your data lives

| Data | Location |
| --- | --- |
| Projects, media, handoffs, history | $XDG_DATA_HOME/qortal-migration-studio (default ~/.local/share/qortal-migration-studio) |
| Desktop window/config state | $XDG_CONFIG_HOME/Qortal Migration Studio |
| Program files | /opt/qortal-migration-studio |
| Launcher | /usr/bin/qortal-migration-studio and the desktop menu |

Project data is outside /opt. Upgrading or uninstalling the package never
deletes projects, media, handoffs or history. Remove the data directory manually
only when you intentionally want to erase a project.

## Uninstall

~~~bash
sudo apt remove qortal-migration-studio
~~~

This removes program files, the launcher and the desktop entry. It does **not**
remove ~/.local/share/qortal-migration-studio.

To remove everything, including projects and history:

~~~bash
rm -rf ~/.local/share/qortal-migration-studio
~~~

This second command is destructive and is never run by the package.

## Keyring

WordPress credentials are memory-only unless you choose to remember them. When
secret-tool (libsecret) and a session keyring are available, remembered
credentials are stored through the system keyring. The package recommends
gnome-keyring and libsecret-tools; a graphical login session is required for
the normal unlock prompt.

## Troubleshooting

- **The window does not open**: run qortal-migration-studio in a terminal and
  check the error. On a headless machine, use a real graphical session; the app
  needs an X11/Wayland display.
- **Engine host connection closed**: this was the alpha.3 packaging defect.
  Install 0.8.0-alpha.5 or newer. Do not install npm packages on the host.
- **Missing libraries**: sudo apt install -f completes dependency resolution.
- **Credentials are not remembered**: confirm secret-tool --version works in
  your session and that a keyring is unlocked.
- **Rollback**: install the previous .deb; project data is forward-migrated by
  the engine, so keep a backup before downgrading across schema versions.

## Verification status

See docs/migration-studio/PHASE-9-PRODUCTION-RELEASE.md for the tested
distributions, exact commands, SHA-256, SBOM, provenance and the remaining
signing/live-network blockers. See
docs/migration-studio/DEVELOPER-BUILD.md for the engine dependency rule and the
clean-install handshake gate.
