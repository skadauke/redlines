//! The images the preview loads (design, Rendering): the files of the folders the sidebars show
//! (`project::Projects`), and no others. The page loads them through `asset:` URLs, which it makes
//! with `convertFileSrc` (`src/host.ts`), and asks only for the files of its own project
//! (`src/images.ts`); what those URLs reach is the app's to decide, here.
//!
//! The app answers those URLs itself (`serve`), from a scope of its own that only a sidebar widens.
//! Tauri's own asset protocol, whose place the app's takes, serves from a scope of Tauri's, and
//! Tauri adds to that scope whatever is dropped on a window, a folder with all it holds (#147).

use std::path::{Path, PathBuf};

use tauri::http::header::{CONTENT_LENGTH, CONTENT_TYPE};
use tauri::http::{Request, Response, StatusCode, Uri};
use tauri::utils::config::FsScope;
use tauri::utils::mime_type::MimeType;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::project::Projects;

/// What the page may load through `asset:` URLs: a scope of the app's own, which starts empty and
/// takes each folder a sidebar shows (`allow_shown`), and nothing else.
#[derive(Clone)]
pub struct Images(tauri::fs::Scope);

impl Images {
    /// An empty scope of the kind Tauri's asset protocol serves from, which matches paths the same
    /// way.
    fn new<R: Runtime>(app: &impl Manager<R>) -> tauri::Result<Self> {
        tauri::fs::Scope::new(app, &FsScope::AllowedPaths(Vec::new())).map(Self)
    }

    /// Lets the page load the files in `folder`, and those in its subfolders when `whole`: by the
    /// folder as named, and as it really is, which a link to it hides. Nothing hidden inside it,
    /// file or folder: the scope's patterns match no name below `folder` that starts with a dot.
    fn allow_folder(&self, folder: &Path, whole: bool) {
        let real = std::fs::canonicalize(folder).ok();
        for path in std::iter::once(folder).chain(real.as_deref()) {
            if let Err(error) = self.0.allow_directory(path, whole) {
                eprintln!("Redlines can't show images in {}: {error}", path.display());
            }
        }
    }

    /// Whether the page may load the file at `path`: by the file it really is, links followed.
    fn may_load(&self, path: &Path) -> bool {
        self.0.is_allowed(path)
    }
}

/// Lets the page load the files of each folder a sidebar shows, from the first time it is shown,
/// with its subfolders unless it is shown alone (`Projects::on_new_folder`).
fn allow_shown(images: &Images, projects: &Projects) {
    let images = images.clone();
    projects.on_new_folder(move |folder, whole| images.allow_folder(folder, whole));
}

/// The preview loads the images of the project folders the sidebars show, and no others, which
/// the app serves itself (`serve`).
pub fn set_up(app: &AppHandle) -> tauri::Result<()> {
    let images = Images::new(app)?;
    allow_shown(&images, &app.state::<Projects>());
    app.manage(images);
    Ok(())
}

/// Answers the page's request for an `asset:` URL (`response`), away from the main thread, which
/// reading a large image would hold up.
pub fn serve<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let images = context
        .app_handle()
        .try_state::<Images>()
        .map(|images| images.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(match images {
            Some(images) => response(&images, &request),
            None => empty(StatusCode::FORBIDDEN),
        });
    });
}

/// The answer to the page's request for `asset://localhost/<path>`: the file at `path`, with its
/// type, if the page may load it (`Images::may_load`), and otherwise nothing, with the status
/// Tauri's own asset protocol gives: 403 for a file the page may not load, 404 for one that isn't
/// there. Always the whole file, which is how the preview loads an image.
fn response(images: &Images, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(path) = requested(request.uri()).filter(|path| images.may_load(path)) else {
        return empty(StatusCode::FORBIDDEN);
    };
    match std::fs::read(&path) {
        Ok(bytes) => {
            // By what the file holds, or else by its name, as Tauri's asset protocol tells it; but
            // a file of no type it knows is only bytes, not a web page.
            let kind = MimeType::parse_with_fallback(
                &bytes,
                &path.to_string_lossy(),
                MimeType::OctetStream,
            );
            Response::builder()
                .header(CONTENT_TYPE, kind)
                .header(CONTENT_LENGTH, bytes.len())
                .body(bytes)
                .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => empty(StatusCode::NOT_FOUND),
        Err(_) => empty(StatusCode::FORBIDDEN),
    }
}

/// An answer with nothing in it.
fn empty(status: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = status;
    response
}

/// The file a request is for: the path after the host, which `convertFileSrc` writes
/// percent-encoded. Only a full path, and one that never climbs to a folder above (`..`), which
/// Tauri's asset protocol refuses too.
fn requested(uri: &Uri) -> Option<PathBuf> {
    let encoded = uri.path().strip_prefix('/')?;
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let path = PathBuf::from(decoded.as_ref());
    if !path.is_absolute() {
        return None;
    }
    tauri::path::SafePathBuf::new(path).ok().map(PathBuf::from)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    /// A new empty folder for one test.
    fn folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("redlines-images-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// Writes each file, making its folders; a name ending in `/` is an empty folder.
    fn make(at: &Path, files: &[&str]) {
        for file in files {
            let path = at.join(file);
            if file.ends_with('/') {
                fs::create_dir_all(&path).unwrap();
            } else {
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(&path, "").unwrap();
            }
        }
    }

    #[test]
    fn the_page_loads_the_files_of_a_project_a_sidebar_shows_and_no_others() {
        let folder = folder("shown");
        make(
            &folder,
            &[
                "repo/.git/",
                "repo/docs/plan.md",
                "repo/docs/img/cat.png",
                "repo/.env",
                "repo/.cache/dog.png",
                "other/owl.png",
            ],
        );
        let app = tauri::test::mock_app();
        let (images, projects) = (Images::new(&app).unwrap(), Projects::default());
        allow_shown(&images, &projects);
        let loads = |name: &str| images.may_load(&folder.join(name));
        // Nothing, until a sidebar shows the project.
        assert!(!loads("repo/docs/img/cat.png"));
        projects.show(&folder.join("repo/docs/plan.md"));
        // The repository, with its subfolders.
        assert!(loads("repo/docs/img/cat.png"));
        assert!(loads("repo/docs/plan.md"));
        // But never a hidden file, nor anything in a hidden folder.
        assert!(!loads("repo/.env"));
        assert!(!loads("repo/.cache/dog.png"));
        // Nor anything outside it.
        assert!(!loads("other/owl.png"));
        fs::remove_dir_all(&folder).unwrap();
    }

    /// What Tauri does with what is dropped on a window, before the drop reaches the window's page
    /// (tauri 2.12.4, `on_window_event` in `manager/window.rs`): it adds each path to its own scopes,
    /// a file by itself, and anything else as a folder with all it holds.
    fn dropped_as_tauri_does<R: Runtime>(app: &impl Manager<R>, paths: &[PathBuf]) {
        let scopes = app.state::<tauri::Scopes>();
        for path in paths {
            if path.is_file() {
                let _ = scopes.allow_file(path);
            } else {
                let _ = scopes.allow_directory(path, true);
            }
        }
    }

    #[test]
    fn a_drop_leaves_what_the_page_may_load_as_the_folders_the_sidebars_show_make_it() {
        let folder = folder("drop");
        make(
            &folder,
            &[
                // Shown before the drop, and after it.
                "repo/.git/",
                "repo/docs/plan.md",
                "repo/docs/cat.png",
                "later/notes.md",
                "later/fig.png",
                // Dropped: a folder, a file, and a link to a folder.
                "private/secret.png",
                "private/keys/id.png",
                "loose/logo.png",
                "elsewhere/owl.png",
            ],
        );
        symlink(folder.join("elsewhere"), folder.join("link")).unwrap();
        let app = tauri::test::mock_app();
        let (images, projects) = (Images::new(&app).unwrap(), Projects::default());
        allow_shown(&images, &projects);
        projects.show(&folder.join("repo/docs/plan.md"));

        let dropped = [
            "private",
            "loose/logo.png",
            "link",
            // A document, a folder inside a project, and the folder that holds them all.
            "repo/docs/plan.md",
            "repo/docs",
            "",
        ];
        dropped_as_tauri_does(&app, &dropped.map(|name| folder.join(name)));
        projects.show(&folder.join("later/notes.md"));

        let loads = |name: &&str| images.may_load(&folder.join(name));
        // The projects the sidebars show, before the drop and after it, as before.
        let shown = ["repo/docs/cat.png", "repo/docs/plan.md", "later/fig.png"];
        let refused: Vec<&str> = shown.into_iter().filter(|name| !loads(name)).collect();
        assert!(refused.is_empty(), "the page may not load {refused:?}");
        // Whatever was dropped, and all it holds, no more than before.
        let elsewhere = [
            "private/secret.png",
            "private/keys/id.png",
            "loose/logo.png",
            "link/owl.png",
            "elsewhere/owl.png",
        ];
        let reached: Vec<&str> = elsewhere.into_iter().filter(loads).collect();
        assert!(reached.is_empty(), "the page may load {reached:?}");
        fs::remove_dir_all(&folder).unwrap();
    }

    /// The page's request for the file at `path`, as `convertFileSrc` writes its URL.
    fn request_for(path: &str) -> Request<Vec<u8>> {
        let encoded =
            percent_encoding::utf8_percent_encode(path, percent_encoding::NON_ALPHANUMERIC);
        Request::builder()
            .uri(format!("asset://localhost/{encoded}"))
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn the_page_gets_the_files_it_may_load_and_nothing_else() {
        let folder = folder("serve");
        make(&folder, &["repo/.env", "repo/notes.md", "other/dog.png"]);
        // A PNG by what it holds, whatever its name; an SVG only by its name.
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
        fs::write(folder.join("repo/cat.png"), png).unwrap();
        fs::write(folder.join("repo/logo.svg"), "<svg/>").unwrap();
        let app = tauri::test::mock_app();
        let images = Images::new(&app).unwrap();
        images.allow_folder(&folder.join("repo"), true);
        let get = |path: &Path| response(&images, &request_for(&path.to_string_lossy()));

        let cat = get(&folder.join("repo/cat.png"));
        assert_eq!(cat.status(), StatusCode::OK);
        assert_eq!(cat.headers()[CONTENT_TYPE], "image/png");
        assert_eq!(cat.body(), png);
        let logo = get(&folder.join("repo/logo.svg"));
        assert_eq!(logo.headers()[CONTENT_TYPE], "image/svg+xml");
        assert_eq!(logo.body(), b"<svg/>");
        // A file of a type it doesn't know is only bytes, never a web page.
        let notes = get(&folder.join("repo/notes.md"));
        assert_eq!(notes.status(), StatusCode::OK);
        assert_eq!(notes.headers()[CONTENT_TYPE], "application/octet-stream");
        // Nothing else: what it may not load, a hidden file, or a path that climbs out of a folder,
        // even back into the project.
        for path in [
            folder.join("other/dog.png"),
            folder.join("repo/.env"),
            folder.join("repo/../other/dog.png"),
            folder.join("repo/../repo/cat.png"),
        ] {
            let refused = get(&path);
            assert_eq!(
                refused.status(),
                StatusCode::FORBIDDEN,
                "{}",
                path.display()
            );
            assert!(refused.body().is_empty());
        }
        // A file that isn't there, in a folder it may load from.
        assert_eq!(
            get(&folder.join("repo/gone.png")).status(),
            StatusCode::NOT_FOUND
        );
        // A path that isn't a full path names no file of a project's.
        assert_eq!(
            get(Path::new("repo/cat.png")).status(),
            StatusCode::FORBIDDEN
        );
        let empty = Request::builder()
            .uri("asset:foo")
            .body(Vec::new())
            .unwrap();
        assert_eq!(response(&images, &empty).status(), StatusCode::FORBIDDEN);
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_folder_shown_alone_lets_the_page_load_its_own_files_and_not_its_subfolders() {
        // As a document in the home folder shows it (`Projects::show`).
        let folder = folder("alone");
        make(&folder, &["note.md", "cat.png", "Pictures/dog.png"]);
        let app = tauri::test::mock_app();
        let images = Images::new(&app).unwrap();
        images.allow_folder(&folder, false);
        assert!(images.may_load(&folder.join("cat.png")));
        assert!(!images.may_load(&folder.join("Pictures/dog.png")));
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn a_folder_shown_through_a_link_lets_the_page_load_its_files_by_either_path() {
        let folder = folder("link");
        make(&folder, &["CloudStorage/Notes/cat.png"]);
        symlink(folder.join("CloudStorage/Notes"), folder.join("Notes")).unwrap();
        let app = tauri::test::mock_app();
        let images = Images::new(&app).unwrap();
        images.allow_folder(&folder.join("Notes"), true);
        assert!(images.may_load(&folder.join("Notes/cat.png")));
        assert!(images.may_load(&folder.join("CloudStorage/Notes/cat.png")));
        fs::remove_dir_all(&folder).unwrap();
    }
}
