# Security policy

## Supported versions

jata is a single-user desktop application. Only the latest release receives
fixes. Older versions are not patched, so upgrade before reporting an issue.

## Reporting a vulnerability

Please report privately through GitHub's
[private vulnerability reporting](https://github.com/HeyTariq/jata/security/advisories/new)
rather than opening a public issue.

Include the version, your platform, and the steps to reproduce. Expect an
acknowledgement within a week. If a fix is warranted it ships in the next
release, credited to you unless you prefer otherwise.

## Scope

jata stores everything in one local SQLite file in the platform data directory
and makes no network requests. There is no server, no account, and no
telemetry. The interesting attack surface is therefore small:

- The Tauri command surface in `src-tauri/src/commands.rs`, which is the only
  bridge between the web frontend and the database.
- SQL handling in `src-tauri/src/store.rs`.
- The webview content security policy in `src-tauri/tauri.conf.json`.

Findings that require an attacker who already has write access to your user
account, your home directory, or the database file are out of scope, since at
that point the data is already theirs.

## Release integrity

Release bundles are built by GitHub Actions from a tagged commit, and the
workflow is in `.github/workflows/release.yml`. macOS and Windows bundles are
unsigned, so both systems will warn on first launch. Verify you downloaded
from the [releases page](https://github.com/HeyTariq/jata/releases) of this
repository.
