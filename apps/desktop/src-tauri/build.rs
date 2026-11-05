// Compiles the app's configuration, capabilities and icons into it (tauri-build), and the build tag
// that About Redlines shows (src/build_tag.rs). Stops if the `redlines` program isn't built yet.

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "src/build_tag.rs"]
mod build_tag;

fn main() {
    for name in ["REDLINES_RELEASE", "REDLINES_COMMIT", "SOURCE_DATE_EPOCH"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let release = build_tag::is_release(std::env::var("REDLINES_RELEASE").ok().as_deref());
    let commit = std::env::var("REDLINES_COMMIT").ok().or_else(git_head);
    let built_at = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|seconds| seconds.trim().parse().ok())
        .unwrap_or_else(now);
    let tag = build_tag::BuildTag::new(
        env!("CARGO_PKG_VERSION"),
        &build_tag::short_commit(commit.as_deref()),
        built_at,
        release,
    );
    println!("cargo:rustc-env=REDLINES_VERSION={}", tag.version);
    println!("cargo:rustc-env=REDLINES_BUILD={}", tag.build);
    // A release build may update itself; any other build never replaces itself (src/updates.rs).
    println!("cargo::rustc-check-cfg=cfg(redlines_release)");
    if release {
        println!("cargo:rustc-cfg=redlines_release");
    }
    if nested_program_is_there() {
        tauri_build::build();
    }
}

/// tauri-build copies the `redlines` program of this target into the app's build (`externalBin` in
/// `tauri.conf.json`), and without it says only that the path doesn't exist. The file isn't in git,
/// so this says what to run.
fn nested_program_is_there() -> bool {
    let target = std::env::var("TARGET").unwrap_or_default();
    let program = format!("binaries/redlines-{target}");
    let there = Path::new(&program).exists();
    if !there {
        println!(
            "cargo::error=apps/desktop/src-tauri/{program} doesn't exist. Build it once in this worktree: in apps/desktop, run scripts/build-redlines {target}"
        );
    }
    there
}

/// The commit checked out, from git. Cargo runs this script again when another one is.
fn git_head() -> Option<String> {
    let git = |args: &[&str]| {
        let output = Command::new("git").args(args).output().ok()?;
        let printed = String::from_utf8(output.stdout).ok()?;
        (output.status.success() && !printed.trim().is_empty()).then(|| printed.trim().to_owned())
    };
    let branch = git(&["symbolic-ref", "--quiet", "HEAD"]);
    for name in ["HEAD", "packed-refs"].into_iter().chain(branch.as_deref()) {
        // Only files that are there: Cargo runs the script every time for one that isn't.
        if let Some(path) = git(&["rev-parse", "--git-path", name])
            && Path::new(&path).exists()
        {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    git(&["rev-parse", "HEAD"])
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}
