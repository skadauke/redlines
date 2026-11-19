// Compiles the app's configuration, capabilities and icons into it (tauri-build), and the build tag
// that About Redlines shows (src/build_tag.rs). Stops if the `redlines` program isn't built yet.
//
// The app's own commands are listed in the app manifest below, which makes each a permission
// (`allow-set-appearance` for `set_appearance`) that a window's capability file must grant
// (`capabilities/`); a command no capability grants is refused. Without the manifest, every window
// may call every command. The list is the commands `generate_handler!` registers in `src/lib.rs`,
// all of them, and `src/command-permissions.node.test.ts` fails when the two differ.

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// The app's own commands (`generate_handler!` in `src/lib.rs`), including those that exist only on
/// Unix, which a build for another system lists without registering.
const COMMANDS: &[&str] = &[
    "about",
    "acp_agent_add",
    "acp_agent_remove",
    "acp_agents",
    "acp_send",
    "acp_start",
    "add_images",
    "add_pasted_image",
    "agent_exec",
    "agent_home_access",
    "agent_home_reach",
    "agent_latest_version",
    "agent_logs_open",
    "agent_setup_stop",
    "agent_sign_in",
    "agent_start",
    "agent_stop",
    "agent_terminal_sign_in",
    "agent_update",
    "agent_which",
    "allow_document",
    "answer_install",
    "app_icon_mark",
    "beep",
    "choose_folder",
    "correct_word",
    "crash_environment",
    "crash_heartbeat",
    "crash_log_page",
    "crash_log_reveal",
    "crash_pending",
    "crash_simulate",
    "dev_log_enabled",
    "dev_log_reveal",
    "dev_log_write",
    "crash_slow",
    "default_app",
    "document_windows",
    "export_pdf",
    "folder_exists",
    "forget_documents",
    "identity",
    "image_sizes",
    "image_for_agent",
    "image_for_crop",
    "image_stamps",
    "fetch_remote_image",
    "install_command_line",
    "install_command_line_at_home",
    "keep_running",
    "list_folder",
    "make_default_app",
    "open_about",
    "open_default",
    "open_files_and_folders_settings",
    "open_link",
    "open_openclaw_setup",
    "open_preferences",
    "open_quick_look_settings",
    "open_window",
    "opened_files",
    "paste_in_field",
    "pick_images",
    "print_window",
    "project_root",
    "quick_look_available",
    "quit_all",
    "read_office_picture",
    "real_path",
    "relaunch",
    "relay_answer",
    "relay_close",
    "relay_open",
    "recovery_delete",
    "recovery_read",
    "recovery_write",
    "rename_file",
    "reveal_in_finder",
    "session_join",
    "session_leave",
    "session_members",
    "session_wal_append",
    "session_wal_read",
    "session_wal_start",
    "set_appearance",
    "set_zoom",
    "show_app_icon_mark",
    "show_images",
    "skill_install",
    "skill_status",
    "gateway_probe",
    "openclaw_connection_add",
    "openclaw_connection_change",
    "openclaw_connection_remove",
    "openclaw_connections",
    "openclaw_node_connect",
    "openclaw_node_status",
    "openclaw_node_stop",
    "openclaw_this_mac",
    "openclaw_use_token",
    "tailscale_install",
    "tailscale_install_state",
    "tailscale_open_app",
    "tailscale_open_https_settings",
    "tailscale_open_app_store",
    "tailscale_restart_app",
    "tailscale_sign_in",
    "tailscale_status",
    "spelling_learn",
    "spelling_suggestions",
    "start_file_drag",
    "undo_in_field",
    "unwatch_document",
    "update_check",
    "update_dismiss",
    "update_install",
    "update_set_automatic",
    "update_state",
    "watch_document",
    "window_document",
    "window_start",
    "zoom_level",
];

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
        let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
            .expect("failed to run tauri-build");
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
