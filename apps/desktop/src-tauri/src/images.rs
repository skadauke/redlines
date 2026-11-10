//! The images the preview loads (design, Rendering): those in the folders the sidebars show
//! (`project::Projects`), and nothing else. The page loads them through `asset:` URLs, which it
//! makes with `convertFileSrc` (`src/host.ts`), and asks only for the files of its own project
//! (`src/images.ts`); what those URLs reach is the app's to decide, here.
//!
//! The app answers those URLs itself (`serve`), from a scope of its own that only a sidebar widens.
//! Tauri's own asset protocol is left out (no `protocol-asset` feature, and no `assetProtocol` in
//! `tauri.conf.json`): Tauri adds whatever is dropped on a window to that protocol's scope, a
//! folder with all it holds, and without the protocol it has no such scope to add it to (#147).

use std::path::{Path, PathBuf};

use tauri::http::header::{
    CONTENT_LENGTH, CONTENT_SECURITY_POLICY, CONTENT_TYPE, HeaderValue, X_CONTENT_TYPE_OPTIONS,
};
use tauri::http::{Request, Response, StatusCode, Uri};
use tauri::utils::config::FsScope;
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
            None => answer(Err(StatusCode::FORBIDDEN)),
        });
    });
}

/// The policy every answer goes with, should a window ever open one as a page, which Tauri would
/// let use all the app's commands (it counts every scheme the app registers as the app's own): no
/// script, nothing loaded but the images inside it, and a document of its own (`sandbox`). An
/// `<img>` shows an image whatever the policy; SVG's own styles and images stay, for a browser
/// that applies it there too.
const POLICY: &str = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/// How much of a file is looked at to tell what it is: more than any image's signature, and the
/// start of an SVG up to its root element.
const HEAD: usize = 8192;

/// The raster images the preview shows, by the extensions of their names, lowercase.
const RASTER_NAMES: [&str; 14] = [
    "png", "apng", "jpg", "jpeg", "gif", "webp", "avif", "jxl", "heic", "heif", "bmp", "ico",
    "tif", "tiff",
];

/// A test of the bytes a file starts with.
type Signature = fn(&[u8]) -> bool;

/// The same images by the signatures their bytes start with, and the type each is served as.
const RASTER_TYPES: [(Signature, &str); 10] = [
    (infer::image::is_png, "image/png"),
    (infer::image::is_jpeg, "image/jpeg"),
    (infer::image::is_gif, "image/gif"),
    (infer::image::is_webp, "image/webp"),
    (infer::image::is_avif, "image/avif"),
    (infer::image::is_heif, "image/heif"),
    (infer::image::is_jxl, "image/jxl"),
    (infer::image::is_bmp, "image/bmp"),
    (infer::image::is_ico, "image/vnd.microsoft.icon"),
    (infer::image::is_tiff, "image/tiff"),
];

/// The answer to the page's request for `asset://localhost/<path>`: the image at `path`, if the
/// page may load it (`image`), and otherwise nothing, with the status Tauri's own asset protocol
/// gives: 403 for a file the page may not load, 404 for one that isn't there.
fn response(images: &Images, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    answer(image(images, request))
}

/// The image a request is for, with the type to serve it as: a file the page may load
/// (`Images::may_load`), and an image the preview shows (`image_type`). Otherwise the status to
/// refuse it with. Always the whole file, which is how the preview loads an image.
fn image(
    images: &Images,
    request: &Request<Vec<u8>>,
) -> Result<(&'static str, Vec<u8>), StatusCode> {
    let path = requested(request.uri()).ok_or(StatusCode::FORBIDDEN)?;
    if !images.may_load(&path) {
        return Err(StatusCode::FORBIDDEN);
    }
    let bytes = std::fs::read(&path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => StatusCode::NOT_FOUND,
        _ => StatusCode::FORBIDDEN,
    })?;
    let kind = image_type(&path, &bytes[..bytes.len().min(HEAD)]).ok_or(StatusCode::FORBIDDEN)?;
    Ok((kind, bytes))
}

/// An image, or the status it is refused with, as an answer that goes with the policy (`POLICY`),
/// and that no browser may take for another type than it says (`nosniff`).
fn answer(image: Result<(&'static str, Vec<u8>), StatusCode>) -> Response<Vec<u8>> {
    let mut response = match image {
        Ok((kind, bytes)) => {
            let length = bytes.len();
            let mut response = Response::new(bytes);
            let headers = response.headers_mut();
            headers.insert(CONTENT_TYPE, HeaderValue::from_static(kind));
            headers.insert(CONTENT_LENGTH, HeaderValue::from(length));
            response
        }
        Err(status) => {
            let mut response = Response::new(Vec::new());
            *response.status_mut() = status;
            response
        }
    };
    let headers = response.headers_mut();
    headers.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(POLICY));
    headers.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    response
}

/// What to serve the file at `path` as, by its name and the bytes it starts with together: a
/// raster image the preview shows, named as one and holding one, as the type its bytes are; or an
/// SVG, named as one and holding its markup. None for anything else, which the app doesn't serve:
/// a web page, a script, or any other file of a project's, whatever its name or its bytes.
fn image_type(path: &Path, head: &[u8]) -> Option<&'static str> {
    let name = path.extension()?.to_str()?.to_ascii_lowercase();
    if name == "svg" {
        svg_markup(head).then_some("image/svg+xml")
    } else if RASTER_NAMES.contains(&name.as_str()) {
        RASTER_TYPES
            .iter()
            .find(|(holds, _)| holds(head))
            .map(|(_, kind)| *kind)
    } else {
        None
    }
}

/// Whether the bytes a file starts with are an SVG document's: past a byte order mark, and an
/// XML declaration, comments or a document type, its root element is `<svg>`.
fn svg_markup(head: &[u8]) -> bool {
    let mut rest = head.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(head);
    loop {
        rest = rest.trim_ascii_start();
        let skipped = if let Some(after) = rest.strip_prefix(b"<?") {
            past(after, b"?>")
        } else if let Some(after) = rest.strip_prefix(b"<!--") {
            past(after, b"-->")
        } else if let Some(after) = rest.strip_prefix(b"<!DOCTYPE") {
            // An internal subset, in brackets, holds `>` of its own.
            let subset = after.iter().position(|&byte| byte == b'[');
            let end = after.iter().position(|&byte| byte == b'>');
            match (subset, end) {
                (Some(subset), Some(end)) if subset < end => {
                    past(&after[subset..], b"]").and_then(|after| past(after, b">"))
                }
                _ => past(after, b">"),
            }
        } else {
            let after = rest.strip_prefix(b"<svg");
            return after
                .and_then(|after| after.first())
                .is_some_and(|byte| b" \t\r\n/>".contains(byte));
        };
        match skipped {
            Some(after) => rest = after,
            None => return false,
        }
    }
}

/// What follows the first `end` in `bytes`, if there is one.
fn past<'a>(bytes: &'a [u8], end: &[u8]) -> Option<&'a [u8]> {
    bytes
        .windows(end.len())
        .position(|window| window == end)
        .map(|at| &bytes[at + end.len()..])
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
    /// a file by itself, and anything else as a folder with all it holds. Built without its asset
    /// protocol, as the app is, Tauri has no such scope, and the paths go nowhere.
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

    #[test]
    fn tauri_builds_no_asset_protocol_of_its_own_for_a_drop_to_widen() {
        // Tauri adds what is dropped on a window to its asset protocol's scope, which it builds
        // only when `tauri.conf.json` turns the protocol on: tauri-build then wants Tauri's
        // `protocol-asset` feature, and refuses the feature without it.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let asset_protocol = &config["app"]["security"]["assetProtocol"];
        assert_ne!(asset_protocol["enable"], true, "{asset_protocol}");
    }

    /// The page's request for the file at `path`, as `convertFileSrc` writes its URL.
    fn request_for(path: &Path) -> Request<Vec<u8>> {
        let path = path.to_string_lossy();
        let encoded =
            percent_encoding::utf8_percent_encode(&path, percent_encoding::NON_ALPHANUMERIC);
        Request::builder()
            .uri(format!("asset://localhost/{encoded}"))
            .body(Vec::new())
            .unwrap()
    }

    /// The first bytes of an image of each kind the preview shows: its signature, as a file of
    /// that kind starts.
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const JPEG: &[u8] = b"\xFF\xD8\xFF\xE0\0\x10JFIF\0";
    const GIF: &[u8] = b"GIF89a\x01\0\x01\0";
    const WEBP: &[u8] = b"RIFF\x1a\0\0\0WEBPVP8 ";
    const AVIF: &[u8] = b"\0\0\0\x1cftypavif\0\0\0\0avifmif1miaf";
    const HEIC: &[u8] = b"\0\0\0\x18ftypheic\0\0\0\0mif1heic";
    const JXL: &[u8] = b"\xFF\x0A\xFA\x7F\x01\x90";
    const BMP: &[u8] = b"BM\x1e\0\0\0\0\0\0\0";
    const ICO: &[u8] = b"\0\0\x01\0\x01\0\x10\x10";
    const TIFF: &[u8] = b"II*\0\x08\0\0\0\0\0";
    const SVG: &[u8] = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"4\"/></svg>";
    /// As drawing programs write an SVG: a declaration, a comment and a document type, with an
    /// internal subset, before the root element.
    const DRAWN_SVG: &[u8] = b"\xEF\xBB\xBF<?xml version=\"1.0\" encoding=\"utf-8\"?>\n\
        <!-- Generator: Adobe Illustrator 28.0 -->\n\
        <!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"svg11.dtd\" [\n\
        <!ENTITY ns_svg \"http://www.w3.org/2000/svg\">\n]>\n\
        <svg\n  version=\"1.1\" xmlns=\"&ns_svg;\"></svg>\n";
    /// A web page that would run script, if it were ever opened as one.
    const PAGE: &[u8] = b"<html><body><script>alert(1)</script></body></html>";

    /// A project folder the page may load from, holding `files` by name and bytes, and the
    /// page's `Images`.
    fn project(name: &str, files: &[(&str, &[u8])]) -> (PathBuf, Images) {
        let folder = folder(name);
        fs::create_dir_all(folder.join("repo")).unwrap();
        for (file, bytes) in files {
            fs::write(folder.join("repo").join(file), bytes).unwrap();
        }
        let images = Images::new(&tauri::test::mock_app()).unwrap();
        images.allow_folder(&folder.join("repo"), true);
        (folder, images)
    }

    #[test]
    fn the_page_gets_each_image_the_preview_shows_by_its_name_and_its_bytes_together() {
        let served = [
            ("cat.png", PNG, "image/png"),
            ("loop.apng", PNG, "image/png"),
            ("photo.jpg", JPEG, "image/jpeg"),
            ("PHOTO.JPEG", JPEG, "image/jpeg"),
            ("wave.gif", GIF, "image/gif"),
            ("pic.webp", WEBP, "image/webp"),
            ("pic.avif", AVIF, "image/avif"),
            ("pic.heic", HEIC, "image/heif"),
            ("pic.jxl", JXL, "image/jxl"),
            ("old.bmp", BMP, "image/bmp"),
            ("favicon.ico", ICO, "image/vnd.microsoft.icon"),
            ("scan.tiff", TIFF, "image/tiff"),
            ("logo.svg", SVG, "image/svg+xml"),
            ("drawing.SVG", DRAWN_SVG, "image/svg+xml"),
            // An image named as another kind of image is served as what it is.
            ("really-a-png.jpg", PNG, "image/png"),
        ];
        let (folder, images) = project("each", &served.map(|(name, bytes, _)| (name, bytes)));
        for (name, bytes, kind) in served {
            let answer = response(&images, &request_for(&folder.join("repo").join(name)));
            assert_eq!(answer.status(), StatusCode::OK, "{name}");
            assert_eq!(answer.headers()[CONTENT_TYPE], kind, "{name}");
            assert_eq!(answer.body(), bytes, "{name}");
        }
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn the_page_gets_no_file_that_isnt_an_image_the_preview_shows_whatever_its_name() {
        let refused: [(&str, &[u8]); 14] = [
            // Files a project holds, some of which start as web pages do.
            ("README.md", b"<!-- badges -->\n# Plan\n"),
            ("intro.md", b"<p align=\"center\">Plan</p>\n"),
            ("notes.txt", b"Plan\n"),
            ("page.html", PAGE),
            ("app.js", b"alert(1)\n"),
            ("data.xml", b"<?xml version=\"1.0\"?><data/>"),
            ("config.json", b"{\"key\": 1}"),
            ("plan.pdf", b"%PDF-1.7\n"),
            // A web page, or anything else, under an image's name.
            ("cat.png", PAGE),
            ("logo.svg", PAGE),
            ("not-svg.svg", b"<?xml version=\"1.0\"?><html/>"),
            ("raster.svg", PNG),
            ("markup.png", SVG),
            ("empty.png", b""),
        ];
        let (folder, images) = project("refused", &refused);
        for (name, _) in refused {
            let answer = response(&images, &request_for(&folder.join("repo").join(name)));
            assert_eq!(answer.status(), StatusCode::FORBIDDEN, "{name}");
            assert!(answer.body().is_empty(), "{name}");
        }
        fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn the_page_gets_no_image_from_outside_the_folders_it_may_load_from() {
        let (folder, images) = project("outside", &[("cat.png", PNG), (".hidden.png", PNG)]);
        make(&folder, &["other/"]);
        fs::write(folder.join("other/dog.png"), PNG).unwrap();
        let get = |path: &Path| response(&images, &request_for(path));
        // What it may not load, a hidden file, or a path that climbs out of a folder, even back
        // into the project.
        for path in [
            folder.join("other/dog.png"),
            folder.join("repo/.hidden.png"),
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
    fn every_answer_goes_with_a_policy_that_keeps_it_inert() {
        let (folder, images) = project("policy", &[("cat.png", PNG), ("page.html", PAGE)]);
        let requests = [
            request_for(&folder.join("repo/cat.png")),
            request_for(&folder.join("repo/page.html")),
            request_for(&folder.join("repo/gone.png")),
            request_for(Path::new("repo/cat.png")),
            Request::builder()
                .uri("asset:foo")
                .body(Vec::new())
                .unwrap(),
        ];
        let statuses = requests.map(|request| {
            let answer = response(&images, &request);
            let headers = answer.headers();
            assert_eq!(
                headers[CONTENT_SECURITY_POLICY],
                "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
                "{}",
                request.uri()
            );
            assert_eq!(
                headers[X_CONTENT_TYPE_OPTIONS],
                "nosniff",
                "{}",
                request.uri()
            );
            answer.status()
        });
        // An image, and each way of refusing one.
        assert_eq!(
            statuses,
            [
                StatusCode::OK,
                StatusCode::FORBIDDEN,
                StatusCode::NOT_FOUND,
                StatusCode::FORBIDDEN,
                StatusCode::FORBIDDEN
            ]
        );
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
