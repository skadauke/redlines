//! The updater plugin for real (`Plugin` and `PluginUpdate` in `updates.rs`), in a mock app,
//! against a release served from 127.0.0.1 by a server in the test, as an installed copy reads
//! GitHub's: the manifest in the form `scripts/update-manifest.ts` writes, the update's archive,
//! and its signature. Nothing goes beyond the loopback, and nothing touches the app's own bundle.
//!
//! `test-release/` holds the release, signed with a key made for these tests alone:
//! `Redlines.app.tar.gz`, an app bundle whose program is a line of text; its signatures as
//! `tauri signer sign --app-version` writes them, for 0.3.0, for 0.4.0, and for 0.3.0 with another
//! key; and `test-only-public-key.pub`, the public key, as `plugins.updater.pubkey` holds one. The
//! private keys were made with `tauri signer generate` for these files, and thrown away: to change
//! the archive, make a new key pair, sign it again and replace the public key.

use std::future::Future;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use serde_json::json;
use tauri::test::MockRuntime;

use super::Plugin;
use super::checks::{Found, Source};

const PUBLIC_KEY: &str = include_str!("test-release/test-only-public-key.pub");
const ARCHIVE: &[u8] = include_bytes!("test-release/Redlines.app.tar.gz");
const SIGNED: &str = include_str!("test-release/signed-for-0.3.0.sig");
const SIGNED_FOR_0_4_0: &str = include_str!("test-release/signed-for-0.4.0.sig");
const SIGNED_BY_ANOTHER_KEY: &str = include_str!("test-release/signed-by-another-key.sig");

/// The version the mock app runs as. The release is 0.3.0.
const RUNNING: &str = "0.2.0";

/// How long a check or a download may take in the tests of a server that stops answering, where
/// the app waits a minute for a check and a quarter of an hour for a download.
const SHORT: Duration = Duration::from_millis(500);

/// How long a test waits for anything before it calls it a hang.
const HANG: Duration = Duration::from_secs(20);

/// A release server on 127.0.0.1. Each path it knows answers with its bytes; any other holds the
/// connection open and never answers, as a server that has stopped answering.
struct Server {
    listener: TcpListener,
}

impl Server {
    fn new() -> Self {
        Self {
            listener: TcpListener::bind("127.0.0.1:0").unwrap(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.listener.local_addr().unwrap())
    }

    /// Serves `paths` in a thread of its own, for as long as the tests run.
    fn serve(self, paths: Vec<(&'static str, Vec<u8>)>) {
        std::thread::spawn(move || {
            let mut unanswered = Vec::new();
            for stream in self.listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let Some(path) = requested_path(&stream) else {
                    continue;
                };
                match paths.iter().find(|(known, _)| *known == path) {
                    Some((_, body)) => {
                        let head = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = stream
                            .write_all(head.as_bytes())
                            .and_then(|()| stream.write_all(body));
                    }
                    None => unanswered.push(stream),
                }
            }
        });
    }
}

/// The path a request asks for, once its head has been read.
fn requested_path(stream: &TcpStream) -> Option<String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let path = line.split_whitespace().nth(1)?.to_owned();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 || header == "\r\n" {
            return Some(path);
        }
    }
}

/// The manifest of a release, as `updateManifest` in `scripts/update-manifest.ts` writes it: one
/// universal app, for Apple silicon and Intel Macs, with the `.sig` file's contents, trimmed.
fn manifest(version: &str, url: &str, signature: &str) -> Vec<u8> {
    let platform = json!({ "signature": signature.trim(), "url": url });
    let manifest = json!({
        "version": version,
        "notes": format!("https://github.com/skadauke/redlines/releases/tag/v{version}"),
        "pub_date": "2026-11-06T12:00:00Z",
        "platforms": { "darwin-aarch64": platform, "darwin-x86_64": platform },
    });
    serde_json::to_vec_pretty(&manifest).unwrap()
}

/// Serves the release `version`: its manifest, with `signature`, and `archive`. Returns the
/// manifest's URL, the endpoint.
fn release(version: &str, signature: &str, archive: &[u8]) -> String {
    let server = Server::new();
    let endpoint = server.url("/latest.json");
    let manifest = manifest(version, &server.url("/Redlines.app.tar.gz"), signature);
    server.serve(vec![
        ("/latest.json", manifest),
        ("/Redlines.app.tar.gz", archive.to_vec()),
    ]);
    endpoint
}

/// The app as the updater sees it, running as `RUNNING`, with the updater's settings in
/// `tauri.conf.json` but for three: the public key, the endpoint, and plain HTTP, which
/// 127.0.0.1 is served over. `requireSignedVersion` is the app's own.
fn app(endpoint: &str) -> tauri::App<MockRuntime> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    let mut updater = config["plugins"]["updater"].clone();
    updater["pubkey"] = PUBLIC_KEY.trim().into();
    updater["endpoints"] = json!([endpoint]);
    updater["dangerousInsecureTransportProtocol"] = true.into();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".to_owned(), updater);
    context.package_info_mut().version = RUNNING.parse().unwrap();
    // The release is for Macs, and a Mac finds its entry in the manifest by itself. Elsewhere, as
    // on the Linux CI, the updater is told to look for the Mac's.
    let plugin = if cfg!(target_os = "macos") {
        tauri_plugin_updater::Builder::new()
    } else {
        tauri_plugin_updater::Builder::new().target(format!("darwin-{}", std::env::consts::ARCH))
    };
    tauri::test::mock_builder()
        .plugin(plugin.build())
        .build(context)
        .unwrap()
}

/// The app's glue to the updater, with the app's own timeouts.
fn plugin(app: &tauri::App<MockRuntime>) -> Plugin<MockRuntime> {
    Plugin::new(app.handle().clone())
}

/// Runs `work` to its end, and fails the test if it hangs.
fn finish<T>(work: impl Future<Output = T>) -> T {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            tokio::time::timeout(HANG, work)
                .await
                .expect("it should end, not hang")
        })
}

/// What the check found, which must be the update to 0.3.0.
fn found(plugin: &Plugin<MockRuntime>) -> std::sync::Arc<dyn Found> {
    let found = finish(plugin.check())
        .unwrap()
        .expect("the update to 0.3.0");
    assert_eq!(found.version(), "0.3.0");
    found
}

#[test]
fn a_newer_release_is_found_and_its_update_downloads_and_verifies() {
    let app = app(&release("0.3.0", SIGNED, ARCHIVE));
    let found = found(&plugin(&app));
    assert_eq!(finish(found.download()).unwrap(), ARCHIVE);
}

#[test]
fn the_release_the_app_runs_already_is_no_update() {
    let app = app(&release(RUNNING, SIGNED, ARCHIVE));
    assert!(finish(plugin(&app).check()).unwrap().is_none());
}

#[test]
fn an_update_whose_signature_does_not_hold_is_refused() {
    for (what, signature, archive) in [
        ("other bytes", SIGNED, &b"not the update"[..]),
        ("another key", SIGNED_BY_ANOTHER_KEY, ARCHIVE),
        // The manifest says 0.3.0, the signature 0.4.0 (requireSignedVersion).
        ("another version", SIGNED_FOR_0_4_0, ARCHIVE),
        ("no signature at all", "bm90IGEgc2lnbmF0dXJl", ARCHIVE),
    ] {
        let app = app(&release("0.3.0", signature, archive));
        let downloaded = finish(found(&plugin(&app)).download());
        assert!(downloaded.is_err(), "{what}: {downloaded:?}");
    }
}

#[test]
fn a_server_that_does_not_answer_fails_the_check_in_time() {
    let server = Server::new();
    let app = app(&server.url("/latest.json"));
    server.serve(Vec::new());
    let plugin = Plugin {
        check_timeout: SHORT,
        ..plugin(&app)
    };
    assert!(finish(plugin.check()).is_err());
}

#[test]
fn a_server_that_stops_answering_fails_the_download_in_time() {
    let server = Server::new();
    let app = app(&server.url("/latest.json"));
    let manifest = manifest("0.3.0", &server.url("/Redlines.app.tar.gz"), SIGNED);
    // The manifest, and then nothing.
    server.serve(vec![("/latest.json", manifest)]);
    let plugin = Plugin {
        download_timeout: SHORT,
        ..plugin(&app)
    };
    let downloaded = finish(found(&plugin).download());
    assert!(downloaded.is_err(), "{downloaded:?}");
}

/// Set for the copy of the tests that installs (`installs_into_its_own_bundle`): the endpoint.
#[cfg(target_os = "macos")]
const INSTALL_FROM: &str = "REDLINES_TEST_INSTALL_FROM";

/// The program of the throwaway bundle the install test makes.
#[cfg(target_os = "macos")]
const THROWAWAY_PROGRAM: &str = "Redlines.app/Contents/MacOS/redlines-desktop";

/// The install, over a throwaway app bundle in a folder of its own, never the app's bundle nor the
/// tests' folder. The updater replaces the bundle that the running program is in, so these tests
/// run a copy of themselves from inside the throwaway bundle, and that copy installs.
#[cfg(target_os = "macos")]
#[test]
fn the_update_installs_over_a_throwaway_bundle() {
    // Under the temporary folder as it really is: the updater refuses to run from a path through a
    // link, as /var is on a Mac.
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    let folder = Throwaway(temporary.join(format!(
        "redlines-install-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )));
    let program = folder.0.join(THROWAWAY_PROGRAM);
    std::fs::create_dir_all(program.parent().unwrap()).unwrap();
    std::fs::copy(std::env::current_exe().unwrap(), &program).unwrap();
    let endpoint = release("0.3.0", SIGNED, ARCHIVE);
    let output = std::process::Command::new(&program)
        .args([
            "updates::plugin_tests::installs_into_its_own_bundle",
            "--exact",
            "--ignored",
            "--test-threads=1",
        ])
        .env(INSTALL_FROM, &endpoint)
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&output.stdout);
    // It ran, the one test, and it passed.
    assert!(
        output.status.success() && said.contains("1 passed"),
        "{said}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    // The bundle is the update's now.
    assert_eq!(
        std::fs::read_to_string(&program).unwrap(),
        "the new version\n"
    );
}

/// A folder of the test's own, removed when the test ends, whether it passes or fails.
#[cfg(target_os = "macos")]
struct Throwaway(std::path::PathBuf);

#[cfg(target_os = "macos")]
impl Drop for Throwaway {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The copy's half of `the_update_installs_over_a_throwaway_bundle`, which runs it. Run any other
/// way, it does nothing; nor does it install unless it runs from a throwaway bundle in the
/// temporary folder.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "the_update_installs_over_a_throwaway_bundle runs it, from a copy in a throwaway bundle"]
fn installs_into_its_own_bundle() {
    let Ok(endpoint) = std::env::var(INSTALL_FROM) else {
        return;
    };
    let program = std::env::current_exe().unwrap().canonicalize().unwrap();
    let temporary = std::env::temp_dir().canonicalize().unwrap();
    assert!(
        program.starts_with(&temporary) && program.ends_with(THROWAWAY_PROGRAM),
        "{} isn't a throwaway bundle's program",
        program.display()
    );
    let app = app(&endpoint);
    let found = found(&plugin(&app));
    let bytes = finish(found.download()).unwrap();
    finish(found.install(std::sync::Arc::new(bytes))).unwrap();
}
