# Releasing Redlines

A release is a GitHub release tagged `v<version>`. Publishing it starts
[`release.yml`](../.github/workflows/release.yml), which builds the Mac app, signs, notarizes and
staples it, attaches it to the release, and then deploys the website, whose Download section then
shows the new version. Installed copies of Redlines find the release on their own and offer to
restart into it.

The website also redeploys on its own on every push to `main` that touches the site, the embed or
the packages the embed bundles, so a merged change to the site or to the editor goes live within
minutes. A release only refreshes its Download section. When the embed fails to build, or a check
fails, the deploy stops and the site stays as it was.

Each release carries:

| File                            | What it is                                                                 |
| ------------------------------- | -------------------------------------------------------------------------- |
| `Redlines-macOS.dmg`            | The disk image: one universal app, for Apple silicon and Intel             |
| `Redlines-macOS.app.tar.gz`     | The update that installed copies download                                  |
| `Redlines-macOS.app.tar.gz.sig` | Its signature, made with the updater's key                                 |
| `latest.json`                   | The update manifest that installed copies read                             |
| `SHA256SUMS.txt`                | The SHA-256 of each file above                                             |

The website's download button links to `releases/latest/download/Redlines-macOS.dmg`, so it always
serves the newest release.

## The setup is done

The nine secrets that the workflow reads are secrets of the repository's `release` environment,
which only `main` and tags `v*` may use, so that the signing keys never sign another branch's code.
`apps/desktop/src-tauri/tauri.conf.json` has the public key of the updater's signing key
(`plugins.updater.pubkey`). The one thing left is on the website's side: add the tag rule `v*` to
the `github-pages` environment (step 5 below), or the website job of a release is refused.

For a new maintainer, or a new key, the steps are below.

## Cut a release

1. Set the version in `apps/desktop/src-tauri/Cargo.toml`, the only place it is written
   (`tauri.conf.json` has none, so it takes Cargo's). Run `cargo check` in `apps/desktop/src-tauri`
   so that `Cargo.lock` follows, and merge the change to `main`.
2. Publish the release, tagged with that version:

   ```sh
   gh release create v0.1.0 --target main --title "Redlines 0.1.0" --generate-notes
   ```

   Or on GitHub: Releases › Draft a new release, a new tag `v0.1.0` on `main`, Publish release.
3. Watch Actions › Release. It takes about half an hour, most of it waiting for Apple's notary
   service. The files appear on the release when the macOS job is done, and the website follows.

If the tag and the version differ, or a secret is missing, the job stops at once and nothing is
attached: a release is never published unsigned, not notarized or without its update. For a wrong
tag, delete the release and its tag (`gh release delete v0.1.0 --cleanup-tag --yes`), then fix one
or the other and publish again. A failed job can be run again from its page; it replaces the files
it attaches.

A pre-release (`--prerelease`) gets its files too, but it never becomes the latest release, so
neither the website nor installed copies take any notice of it.

## Test builds

Actions › Release › Run workflow, on `main`, or:

```sh
gh workflow run release.yml --ref main
```

This builds, signs and notarizes exactly as a release does, and attaches the files to the workflow
run (for 14 days) instead of a release. Nothing is published and the website stays as it is. A test
build never updates itself, so that a copy handed to a tester stays the build they were given; to
move to a release, they install the release.

Only `main` may use the `release` environment, so a test build of another branch is refused before
it starts. Merge the branch first, or add it to the environment's deployment branches, knowing that
its code can then be signed. A test build that lacks a secret is built anyway, and says so in its
warnings, its summary and its file names (`Redlines-macOS-UNSIGNED.dmg`).

## The build tag

Redlines › About Redlines says which build a copy is, and nothing else in the window does:

- a release: `Version 0.1.0 (1a2b3c4)`, its version and commit;
- any other build, from a test build to `pnpm tauri dev`: `Version 0.1.0-dev
  (1a2b3c4-20261101.1430)`, with the time it was built in UTC.

`src-tauri/build.rs` makes the tag as the app compiles (`src-tauri/src/build_tag.rs`). The release
workflow sets `REDLINES_RELEASE=1` for a release, `REDLINES_COMMIT` for the commit, and
`SOURCE_DATE_EPOCH` once for the run, so that both halves of the universal app carry the same tag;
otherwise the commit comes from git and the time from the clock.

## Updates

An installed release checks `releases/latest/download/latest.json` soon after it starts and every
four hours, downloads a newer version in the background and verifies its signature with the public
key in `tauri.conf.json`. The signature also names the version it was made for, and an update whose
signature names another version is refused (`requireSignedVersion`). Nothing is shown while it
checks or downloads, or when it is offline or something fails: it tries again an hour later. Once
the update is ready, a card in the lower-right corner of each window offers **Restart to update** or
**Later**; Later in one window puts the card away in all of them. Restarting asks about unsaved
edits first, replaces the app where it is installed, and opens the new version with the same
documents.

However many windows are open, the app checks and downloads once. The app does it, not a window
(`src-tauri/src/updates.rs`, `src-tauri/src/updates/checks.rs`): closing any window loses nothing,
a download under way or ready included, and a window that opens later shows the ready update at
once. The windows only show what the app says and ask it (`src/updates.ts`), and hold none of the
updater's permissions.

Redlines › Check for Updates…, in any window, checks at once, or waits for the check under way, and
answers in that window in the same kind of card ("Redlines is up to date."), whichever windows close
meanwhile. Restart to update, in any window, installs what the app downloaded. Redlines › Settings ›
Check for Updates Automatically turns the automatic checks off.

A copy updates itself only when it can do so without asking anyone: a release build, in
`~/Applications` or `/Applications` or another folder it may write. The copy on the disk image
leaves updating to the copy it installs; a copy that only an administrator could replace, and a
test or development build, don't update. Check for Updates… says which.

## One-time setup

These need the Apple Developer account, and admin rights on the repository. The secrets are the
`release` environment's, not the repository's: `gh secret set --env release` sets one, and asks
for the value when it isn't piped in.

1. **The release environment.** Settings › Environments › New environment, `release`. Under
   Deployment branches and tags, choose Selected branches and tags, and add the branch `main` and
   the tag rule `v*`. The release workflow's macOS job runs in this environment, so only those can
   read its secrets. If the same secrets are also set for the whole repository, delete those
   (`gh secret delete <name>`), so that they live in one place.
2. **The signing certificate.** In Keychain Access, find the "Developer ID Application" identity
   (`security find-identity -v -p codesigning` lists it), and export the certificate with its
   private key as a `.p12`, with a password. Then:

   ```sh
   base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE --env release
   gh secret set APPLE_CERTIFICATE_PASSWORD --env release
   gh secret set APPLE_SIGNING_IDENTITY --env release \
     --body "Developer ID Application: <name> (<team ID>)"
   openssl rand -base64 24 | gh secret set KEYCHAIN_PASSWORD --env release
   ```

   Delete the `.p12` afterwards. `KEYCHAIN_PASSWORD` only locks the keychain that the workflow makes
   for the certificate; any password does.
3. **The notary key.** In App Store Connect › Users and Access › Integrations › App Store Connect
   API › Team Keys, generate a key with the Developer role, and download `AuthKey_<key ID>.p8`
   (Apple lets you download it once). The page shows the key ID and the issuer ID. Then:

   ```sh
   base64 -i AuthKey_<key ID>.p8 | gh secret set APPLE_API_KEY --env release
   gh secret set APPLE_API_KEY_ID --env release --body "<key ID>"
   gh secret set APPLE_API_ISSUER --env release --body "<issuer ID>"
   ```

   For notarizing on your own Mac, keep the key in the keychain as a profile:
   `xcrun notarytool store-credentials redlines-notary --key AuthKey_<key ID>.p8 --key-id "<key ID>"
   --issuer "<issuer ID>"`.
4. **The updater's signing key.** In `apps/desktop`:

   ```sh
   pnpm tauri signer generate -w ~/.tauri/redlines.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/redlines.key
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release
   ```

   Put the contents of `~/.tauri/redlines.key.pub` in `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json`, and commit it; a test checks that it is a public key. Keep the
   private key and its password somewhere safe, such as a password manager. Installed copies trust
   this key alone: without it, they can't be updated, and a new key reaches them only in a release
   signed with the old one. The workflow checks every update's signature against the public key
   before it attaches it, so a secret that doesn't match fails the release instead of the updates.
5. **The website.** Settings › Pages › Source: GitHub Actions. Settings › Environments ›
   `github-pages` › Deployment branches and tags: add the tag rule `v*`, because a release's
   website job runs on the release's tag. More in
   [`deploy-website.yml`](../.github/workflows/deploy-website.yml).

In this repository a release fails if any secret is missing but `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
(empty for a key without one). A test build, or a fork's release, is built with what there is:
unsigned without the certificate, signed but not notarized without the notary key, without an
update without the updater key; its warnings, summary, file names and (for a release) notes say so.

The job installs the dependencies, fetches the crates, sets up `make-dmg`'s Python packages
(pinned to exact versions) and compiles the app before it unpacks any credential. The keychain
with the certificate, and the notary key's file, exist only for the steps that bundle, sign and
notarize, and the step after them, which runs even when one fails, deletes them. The third-party
actions are pinned to commits.

## The `redlines` program

The app carries the command line, `Redlines.app/Contents/MacOS/redlines`, so that agents can run it
with no Node on the machine: a small Rust program (`apps/desktop/redlines`) with QuickJS and the
bundled TypeScript of `packages/cli` in it. `scripts/build-redlines` builds it, and `pnpm build`
runs that script, so `tauri build` makes it as part of compiling the app. It writes to
`src-tauri/binaries/` (`bundle.externalBin` in `tauri.conf.json`): `redlines-<target>`, and for the
universal app one for each architecture and one that holds both, which is the one the app gets.

Tauri signs it with the app, with the hardened runtime, and it needs no entitlement: QuickJS doesn't
compile to machine code. After signing, the workflow checks that it holds both architectures, is
signed, and edits and shows a file with an empty environment. It comes to about 1.2 MB per
architecture, and 2.5 MB in the universal app.

## The Quick Look extension

The app carries a Quick Look preview of Markdown, R Markdown and Quarto files, an app extension at
`Redlines.app/Contents/PlugIns/RedlinesPreview.appex` (`apps/desktop/quicklook`; what it shows and
why is design §10). Tauri builds no app extensions, so the build does it:

- `scripts/build-quicklook` bundles the renderer (TypeScript that runs in JavaScriptCore),
  compiles the Swift extension with `swiftc` for Apple silicon and Intel, joins them with `lipo`,
  and writes `apps/desktop/quicklook/build/RedlinesPreview.appex`. `pnpm build` runs it, so `tauri
  build` makes the extension as part of compiling the app, as it makes the `redlines` program. It
  needs the Xcode command line tools, and on any other system it does nothing. The extension's
  version is the app's, from `Cargo.toml`.
- `bundle.macOS.files` in `tauri.conf.json` copies the whole folder to `Contents/PlugIns`.
- **Signing.** Tauri signs the app and the programs it copies, `codesign --force` for each, in the
  app's own identity, and never anything in `PlugIns`. So the extension must be signed when `tauri
  bundle` runs, with the same identity, the hardened runtime and a secure timestamp (notarization
  asks for both), and with the sandbox entitlement that every app extension needs, which signing it
  again without `--entitlements` would take away. `scripts/build-quicklook` signs it itself,
  ad hoc, or with `APPLE_SIGNING_IDENTITY` when that is set (which is how a build on your own Mac
  below signs it). The workflow compiles the app before any credential is unpacked, so the
  extension is built ad hoc there, and the step **Sign the Quick Look extension**, after the
  keychain and before **Bundle, sign and notarize the app**, signs it again with the identity
  (`scripts/build-quicklook --sign-only`). Tauri then seals the app around it, and notarization
  reads it with the app.
- **Entitlements** (`apps/desktop/quicklook/swift/RedlinesPreview.entitlements`): the app sandbox,
  which every app extension must have, and which already lets it read the file that Quick Look
  hands it; and JavaScriptCore's compiler (`com.apple.security.cs.allow-jit`). It has no network:
  a preview never tells a server that a file was opened. Without the compiler the renderer is
  several times slower (5 to 8 times measured: 100 KB takes 1.3 seconds instead of 0.2, and a 1.6 MB
  file 4 seconds instead of 0.5, more when the Mac is busy), which a long document turns from a
  moment into a wait.
- **Checks.** `scripts/build-quicklook --check` (CI's `quicklook` job on a Mac) builds it, runs the
  renderer in the system's JavaScriptCore on the fixtures of `apps/desktop/quicklook/fixtures`
  (a plain file, one with tracked changes and comments, front matter, tables, R Markdown and Quarto
  chunks, a large file) and reads the extension's layout, Info.plist, entitlements and signature.
  The release workflow runs the checks of what it built (`--check-only`, before any credential) and
  then of the extension inside the app (`--check-app "$APP" --signed`): that it is at the place, holds both
  architectures, is signed with a Developer ID, a timestamp and the hardened runtime, by the team
  that signed the app, with the sandbox and the compiler and no other entitlement, and that the
  app's seal holds with it inside.
- **Types.** The extension lists `net.daringfireball.markdown` and `public.markdown`, and the
  dynamic types of `.qmd` and `.rmd`, which macOS makes for a file whose extension no app declares
  (`dyn.` and the extension's bytes in base 32; `build-quicklook` computes them, and `--check` asks
  the Mac for the type of an extension nobody declares to see that it agrees). Quick Look matches
  these exactly, and the types of a subtype aren't matched: where another app declares `.qmd` or
  `.Rmd` as its own type, Quick Look chooses by that type, and Redlines' extension isn't asked.
- It needs macOS 13.3: the format library's patterns use regular-expression lookbehind, which the
  JavaScriptCore before it (Safari 16.3 and earlier) can't read, so that it couldn't load the
  renderer at all and every preview would be the file's text. Array methods such as `toSorted`
  came with 13.0.

### Try a preview on your Mac

Build the app (`pnpm tauri build --bundles app`, or `tauri bundle`), then in `apps/desktop`:

```sh
app=src-tauri/target/release/bundle/macos/Redlines.app
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$lsregister" -f -R -trusted "$app"
pluginkit -a "$app/Contents/PlugIns/RedlinesPreview.appex"
pluginkit -m -v -p com.apple.quicklook.preview | grep -i redlines
qlmanage -p quicklook/fixtures/redlines.md
```

An app in `/Applications` is registered by macOS itself, and the extension with it; the commands
above are for a build somewhere else. `qlmanage -p -c <type> file` forces a type, to see a `.qmd`
that another app owns on your Mac (`dyn.ah62d4rv4ge81c5pe` is `.qmd`, `dyn.ah62d4rv4ge81e5pe` is
`.rmd`). The preview's window is blank while it is behind other windows, since the web view
stops drawing: bring it to the front. What the extension did is in the log (`/usr/bin/log`, since
`log` in zsh is something else):

```sh
/usr/bin/log show --last 5m --predicate 'subsystem == "md.redlines.editor.preview"'
```

When you are done, `pluginkit -r <the .appex>` and `"$lsregister" -u "$app"` take the build out of
macOS's lists, so that it doesn't stand in for the installed app. On a Mac that has never had
Redlines, check after a release that Space previews a Markdown file once the app has run from
Applications, that System Settings › General › Login Items & Extensions › Quick Look lists
Redlines with its switch on (`open "x-apple.systempreferences:com.apple.LoginItems-Settings.extension?extensionPointIdentifier=com.apple.quicklook.preview"`
opens that sheet, as does Preferences › General › Quick Look previews of Markdown files › Open
System Settings), and that an update through the app's updater keeps it.

## A signed build on your own Mac

With the Developer ID identity in your login keychain and the `redlines-notary` profile from step
2, in `apps/desktop`:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<team ID>)"
pnpm tauri build --bundles app
app=src-tauri/target/release/bundle/macos/Redlines.app
ditto -c -k --keepParent "$app" Redlines.zip
xcrun notarytool submit Redlines.zip --keychain-profile redlines-notary --wait && rm Redlines.zip
xcrun stapler staple "$app"
scripts/make-dmg
dmg=$(ls src-tauri/target/release/bundle/dmg/Redlines_*.dmg)
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg"
xcrun notarytool submit "$dmg" --keychain-profile redlines-notary --wait
xcrun stapler staple "$dmg"
```

The identity in `APPLE_SIGNING_IDENTITY` signs the Quick Look extension too, when `pnpm build`
makes it, before Tauri seals the app, so the notarization above covers it.

This builds for your Mac's processor only; the workflow builds the universal app
(`--target universal-apple-darwin`, after `rustup target add x86_64-apple-darwin`), and makes the
update too.
