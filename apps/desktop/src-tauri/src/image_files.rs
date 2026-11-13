//! Images added to a document (#308): files the person drops on its window or chooses in a panel,
//! and the data of an image pasted, saved in a folder beside the document, which the preview loads
//! them from (`images`). The page links them once they are there.
//!
//! The page never names a file to copy. The app knows the files dropped on a window from the
//! system's drop (`dropped`) and those chosen from the panel it shows itself (`pick_images`), and
//! keeps them for that window until it takes them by their id (`add_images`); pasted data comes
//! with the request, as bytes (`add_pasted_image`). So what a window can have copied is what the
//! person gave it, and a drop still lets the window read nothing it couldn't before.
//!
//! What goes in is an image, by its name and by its first bytes (`images::image_type`), no larger
//! than the preview serves, and only inside the folder of the window's own document: that folder, or
//! one folder named in the settings inside it, where the preview loads from (`destination`). A name
//! that is taken gets a number, and nothing is ever replaced (`unique_file`). A dropped or chosen
//! file is copied, never moved.

use std::collections::{HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

use crate::file_scope;
use crate::files::check_own_file;
use crate::images::{HEAD, MAX_IMAGE_BYTES, has_image_name, image_extensions, image_type};
use crate::project;
use crate::windows::Windows;

/// The event that tells a window of images dropped on it (`dropped`).
const DROPPED_EVENT: &str = "images-dropped";

/// How many drops and choices a window may have waiting to be taken: the latest, and a few before.
const KEPT_PER_WINDOW: usize = 8;

/// What the page is told once the files are kept: the id to take them by, and how many there are.
/// The page reads the fields by name.
#[derive(Debug, PartialEq, Serialize)]
pub struct Given {
    id: u64,
    count: usize,
}

/// What adding images did: the paths the document links them by, relative to it, in order, and a
/// sentence to show the person for each that couldn't be added. The page reads the fields by name.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct AddedImages {
    paths: Vec<String>,
    refused: Vec<String>,
}

/// What a window is told of a drop of images: the id of the files, how many there are, and where
/// they landed, in points from the top left of the window's page. The page reads the fields by name.
#[derive(Clone, Debug, PartialEq, Serialize)]
struct Dropped {
    id: u64,
    count: usize,
    x: f64,
    y: f64,
}

/// The image files the app has been given for each window, by the id it gave them: those dropped on
/// the window and those chosen for it, until the window takes them.
#[derive(Default)]
pub struct ImageSources {
    last: AtomicU64,
    kept: Mutex<HashMap<String, Waiting>>,
}

/// What a window has waiting to be taken, oldest first: each drop or choice by its id.
type Waiting = VecDeque<(u64, Vec<PathBuf>)>;

impl ImageSources {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Waiting>> {
        self.kept
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Keeps `files` for the window `label`, and says the id to take them by. The oldest kept for
    /// the window goes when it has more than a few waiting.
    pub fn keep(&self, label: &str, files: Vec<PathBuf>) -> u64 {
        let id = self.last.fetch_add(1, Ordering::Relaxed) + 1;
        let mut kept = self.lock();
        let waiting = kept.entry(label.to_owned()).or_default();
        waiting.push_back((id, files));
        while waiting.len() > KEPT_PER_WINDOW {
            waiting.pop_front();
        }
        id
    }

    /// Takes the files kept for the window `label` under `id`, which are its own and given out once.
    pub fn take(&self, label: &str, id: u64) -> Option<Vec<PathBuf>> {
        let mut kept = self.lock();
        let waiting = kept.get_mut(label)?;
        let at = waiting.iter().position(|(kept, _)| *kept == id)?;
        waiting.remove(at).map(|(_, files)| files)
    }

    /// Lets go of what is kept for a window that has closed.
    pub fn forget_window(&self, label: &str) {
        self.lock().remove(label);
    }
}

/// Why images don't go in the folder a name says, in a project whose images the preview loads from
/// the document's own folder alone (`project::ProjectRoot::is_too_broad`).
const TOO_BROAD: &str = "Redlines shows images only from this document’s own folder here, so it can’t add them to a folder. In Preferences › Editor, choose “In the document’s folder” for Images.";

/// Why images aren't added to a folder that leads out of the document's folder.
const OUTSIDE: &str = "The folder for images leads outside the document’s folder, so Redlines doesn’t add images to it.";

fn not_an_image(name: &str) -> String {
    format!("“{name}” isn’t an image Redlines can show.")
}

fn too_large(name: &str) -> String {
    format!(
        "“{name}” is larger than {} MB, so Redlines doesn’t add it.",
        MAX_IMAGE_BYTES / (1024 * 1024)
    )
}

fn cannot_add(name: &str, error: &io::Error) -> String {
    format!("Couldn’t add “{name}”: {error}.")
}

/// The folder for images that the settings name, relative to the document: none for the document's
/// own folder, or one name with no slash that isn't hidden, whose images the preview wouldn't load
/// (`images::Images::allow_folder`).
fn relative_folder(folder: &str) -> Result<Option<&str>, String> {
    if folder.is_empty() {
        return Ok(None);
    }
    let plain = !folder.starts_with('.')
        && !folder.trim().is_empty()
        && !folder.contains(['/', '\\'])
        && !folder.chars().any(char::is_control);
    if plain {
        Ok(Some(folder))
    } else {
        Err(format!(
            "“{folder}” can’t be the folder for images: it is a name with no slash, and not a hidden one."
        ))
    }
}

/// The folder for the images of the document at `document`: its own folder when `folder` is empty,
/// and otherwise the one named `folder` in it. Where the project is too broad to load images from
/// but for the document's own folder, only that one.
fn destination(document: &Path, folder: &str, too_broad: bool) -> Result<PathBuf, String> {
    let own = document
        .parent()
        .filter(|own| !own.as_os_str().is_empty())
        .ok_or_else(|| "This document has no folder to add images to.".to_owned())?;
    match relative_folder(folder)? {
        None => Ok(own.to_path_buf()),
        Some(_) if too_broad => Err(TOO_BROAD.to_owned()),
        Some(name) => Ok(own.join(name)),
    }
}

/// Makes the folder `target`, in the folder `own` of its document or that folder itself, and gives
/// it as it really is, if it is inside `own`: a folder that is a link to somewhere else holds no
/// image the preview would load, and Redlines doesn't write there.
fn ensure_folder(own: &Path, target: &Path) -> Result<PathBuf, String> {
    let made = |error: io::Error| format!("Couldn’t make the folder for images: {error}.");
    std::fs::create_dir_all(target).map_err(made)?;
    let (own, real) = (
        std::fs::canonicalize(own).map_err(made)?,
        std::fs::canonicalize(target).map_err(made)?,
    );
    if real.starts_with(&own) {
        Ok(real)
    } else {
        Err(OUTSIDE.to_owned())
    }
}

/// Makes a new file in `folder` called `name`, or `name-2`, `name-3` and on before its extension
/// when that is taken, and gives it with the name it has. A file that is there is never opened, let
/// alone replaced: `create_new` sees to that even when another program makes the same name at the
/// same moment.
fn unique_file(folder: &Path, name: &str) -> io::Result<(File, String)> {
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    };
    for number in 1..=10_000u32 {
        let candidate = if number == 1 {
            name.to_owned()
        } else {
            format!("{stem}-{number}{extension}")
        };
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join(&candidate))
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "there are too many files of that name",
    ))
}

/// A file name as a folder of images may hold it: the last name of a path, with a character that
/// controls the terminal made a hyphen, and no dots to begin it, which would hide the image from the
/// preview. `image` for a name that nothing is left of.
fn clean_name(name: &str) -> String {
    let own = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let tidy: String = own
        .chars()
        .map(|char| if char.is_control() { '-' } else { char })
        .collect();
    let tidy = tidy.trim().trim_start_matches('.').trim();
    if tidy.is_empty() {
        "image".to_owned()
    } else {
        tidy.to_owned()
    }
}

/// Removes a file that was made and couldn't be finished, and says why with `error`.
fn spoiled(folder: &Path, made: &str, name: &str, error: &io::Error) -> String {
    let _ = std::fs::remove_file(folder.join(made));
    cannot_add(name, error)
}

/// Copies the image file `source` into `folder`, under its own name or a numbered one, and gives the
/// name it has there. The file stays where it is. An image that is in `folder` already is not
/// copied: the document links to it, and the name is its own. Refused with a sentence for a file
/// that isn't an image, by its name and by its bytes, or is larger than `max`.
fn copy_image(folder: &Path, source: &Path, max: u64) -> Result<String, String> {
    let name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cannot = |error: io::Error| cannot_add(&name, &error);
    let mut file = File::open(source).map_err(cannot)?;
    let metadata = file.metadata().map_err(cannot)?;
    if !metadata.is_file() {
        return Err(not_an_image(&name));
    }
    if metadata.len() > max {
        return Err(too_large(&name));
    }
    let mut head = Vec::new();
    (&mut file)
        .take(HEAD as u64)
        .read_to_end(&mut head)
        .map_err(cannot)?;
    if image_type(source, &head).is_none() {
        return Err(not_an_image(&name));
    }
    if let (Ok(here), Ok(there)) = (std::fs::canonicalize(source), std::fs::canonicalize(folder))
        && here.parent() == Some(there.as_path())
    {
        return Ok(name);
    }
    let (mut copy, made) = unique_file(folder, &clean_name(&name)).map_err(cannot)?;
    // The head is read already; the rest follows, and never more than an image may be, should the
    // file have grown since it was looked at.
    let rest = (max + 1).saturating_sub(head.len() as u64);
    match copy
        .write_all(&head)
        .and_then(|()| io::copy(&mut (&mut file).take(rest), &mut copy))
    {
        Ok(copied) if head.len() as u64 + copied <= max => Ok(made),
        Ok(_) => {
            let _ = std::fs::remove_file(folder.join(&made));
            Err(too_large(&name))
        }
        Err(error) => Err(spoiled(folder, &made, &name, &error)),
    }
}

/// Writes the pasted image data `bytes` into `folder` as a file called `wanted`, or a numbered name
/// if that is taken, and gives the name it has. Refused with a sentence for data that is not the
/// image its name says (`images::image_type`), or larger than `max`.
fn write_image(folder: &Path, wanted: &str, bytes: &[u8], max: u64) -> Result<String, String> {
    let name = clean_name(wanted);
    if bytes.len() as u64 > max {
        return Err(too_large(&name));
    }
    if image_type(Path::new(&name), &bytes[..bytes.len().min(HEAD)]).is_none() {
        return Err(not_an_image(&name));
    }
    let (mut file, made) = unique_file(folder, &name).map_err(|error| cannot_add(&name, &error))?;
    file.write_all(bytes)
        .map_err(|error| spoiled(folder, &made, &name, &error))?;
    Ok(made)
}

/// The path a document links an image in `folder` (as the settings name it) by.
fn link_path(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_owned()
    } else {
        format!("{folder}/{name}")
    }
}

/// Makes the folder for the images of `document`, runs `add` in it, and takes the folder away again
/// when it was made for this and nothing was added.
fn adding(
    document: &Path,
    folder: &str,
    too_broad: bool,
    add: impl FnOnce(&Path) -> AddedImages,
) -> Result<AddedImages, String> {
    let target = destination(document, folder, too_broad)?;
    let existed = target.is_dir();
    let own = document.parent().unwrap_or(&target);
    let real = ensure_folder(own, &target)?;
    let added = add(&real);
    if added.paths.is_empty() && !existed {
        let _ = std::fs::remove_dir(&real);
    }
    Ok(added)
}

/// Copies each of `files` into the folder for the images of `document` (`destination`, `copy_image`):
/// the paths to link, and a sentence for each file that couldn't be added.
fn add_files(
    document: &Path,
    folder: &str,
    too_broad: bool,
    files: &[PathBuf],
    max: u64,
) -> Result<AddedImages, String> {
    adding(document, folder, too_broad, |real| {
        let mut added = AddedImages::default();
        for file in files {
            match copy_image(real, file, max) {
                Ok(name) => added.paths.push(link_path(folder, &name)),
                Err(sentence) => added.refused.push(sentence),
            }
        }
        added
    })
}

/// Writes the pasted image `bytes` into the folder for the images of `document`.
fn add_data(
    document: &Path,
    folder: &str,
    too_broad: bool,
    name: &str,
    bytes: &[u8],
    max: u64,
) -> Result<AddedImages, String> {
    adding(document, folder, too_broad, |real| {
        let mut added = AddedImages::default();
        match write_image(real, name, bytes, max) {
            Ok(made) => added.paths.push(link_path(folder, &made)),
            Err(sentence) => added.refused.push(sentence),
        }
        added
    })
}

/// Whether `files`, what was dropped, are image files and nothing else, which is the only drop that
/// adds images: one that holds anything more is offered as files to open, as it always was.
fn images_only(files: &[PathBuf]) -> bool {
    !files.is_empty()
        && files
            .iter()
            .all(|file| file.is_file() && has_image_name(file))
}

/// Where a drop landed, in points from the top left of the window's page. On the Mac the position
/// Tauri calls physical is the pasteboard's dragging location as wry has it, already in points
/// (wry, `wkwebview/drag_drop.rs`), so `in_points` is true there and the position is taken as it
/// is; elsewhere it is physical pixels, which the window's scale factor turns into points.
fn drop_points(position: PhysicalPosition<f64>, scale: f64, in_points: bool) -> (f64, f64) {
    if in_points || scale <= 0.0 {
        (position.x, position.y)
    } else {
        (position.x / scale, position.y / scale)
    }
}

/// `files`, dropped at `position` on the window `label`, if they are all images: they are kept for
/// the window, which is told where they landed (`DROPPED_EVENT`, in points of its page), and the app
/// does nothing else with them. Says whether it took them; any other drop is for the app to offer
/// as files to open.
pub fn dropped(
    app: &AppHandle,
    label: &str,
    files: &[PathBuf],
    position: PhysicalPosition<f64>,
) -> bool {
    if !images_only(files) {
        return false;
    }
    let scale = app
        .get_webview_window(label)
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let id = app.state::<ImageSources>().keep(label, files.to_vec());
    let (x, y) = drop_points(position, scale, cfg!(target_os = "macos"));
    let event = Dropped {
        id,
        count: files.len(),
        x,
        y,
    };
    if let Err(error) = app.emit_to(label, DROPPED_EVENT, event) {
        eprintln!("Redlines can’t tell {label} of the images dropped on it: {error}");
    }
    true
}

/// A window has closed: what it was given and hasn't taken goes.
pub fn window_closed(app: &AppHandle, label: &str) {
    app.state::<ImageSources>().forget_window(label);
}

/// The window's own document at `document`, which the window may use (`files::check_own_file`), and
/// whether its project is too broad to load images from but for the document's own folder.
fn own_document(
    app: &AppHandle,
    window: &WebviewWindow,
    document: &str,
) -> Result<(PathBuf, bool), String> {
    let scope = app.fs_scope();
    let path = Path::new(document);
    check_own_file(
        &app.state::<Windows>(),
        window.label(),
        path,
        false,
        |path| file_scope::allowed(&scope, path),
    )?;
    let root = project::root_of(path, std::env::home_dir().as_deref());
    Ok((path.to_path_buf(), root.is_too_broad()))
}

/// Shows the system's panel for image files, a sheet of the window that asks, and keeps what is
/// chosen for that window: the id to take it by and how many files, or nothing when the person
/// cancels. The app shows the panel, not the page through the dialog plugin, whose own command would
/// let the window read what it picks: this only gives the window files to add as images.
#[tauri::command(async)]
pub fn pick_images(app: AppHandle, window: WebviewWindow) -> Result<Option<Given>, String> {
    let chosen = app
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Images", &image_extensions())
        .blocking_pick_files();
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let files: Vec<PathBuf> = chosen
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .filter_map(|file| std::fs::canonicalize(file).ok())
        .filter(|file| has_image_name(file))
        .collect();
    if files.is_empty() {
        return Ok(None);
    }
    let count = files.len();
    let id = app.state::<ImageSources>().keep(window.label(), files);
    Ok(Some(Given { id, count }))
}

/// Copies the image files the window was given under `id` (`dropped`, `pick_images`) into the
/// folder for the images of its document, which is `folder` inside the document's folder (or the
/// document's folder itself for ''): the paths to link, and a sentence for each file that
/// couldn't be added.
#[tauri::command(async)]
pub fn add_images(
    app: AppHandle,
    window: WebviewWindow,
    id: u64,
    document: String,
    folder: String,
) -> Result<AddedImages, String> {
    let (document, too_broad) = own_document(&app, &window, &document)?;
    let files = app
        .state::<ImageSources>()
        .take(window.label(), id)
        .ok_or_else(|| {
            "Those images were added already, or weren’t given to this window.".to_owned()
        })?;
    add_files(&document, &folder, too_broad, &files, MAX_IMAGE_BYTES)
}

/// Writes a pasted image into the folder for the images of the window's document, as
/// `add_images` does for files. The request's body is the image data, and its headers say, written
/// as percent codes, the document (`x-redlines-document`), the folder (`x-redlines-folder`) and the
/// file name the image should have (`x-redlines-name`).
#[tauri::command(async)]
pub fn add_pasted_image(
    app: AppHandle,
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<AddedImages, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("The pasted image didn’t come as data.".to_owned());
    };
    let header = |name: &str| -> Result<String, String> {
        let value = request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| format!("The request has no {name}."))?;
        percent_decode_str(value)
            .decode_utf8()
            .map(|decoded| decoded.into_owned())
            .map_err(|error| format!("{name}: {error}"))
    };
    let (document, too_broad) = own_document(&app, &window, &header("x-redlines-document")?)?;
    add_data(
        &document,
        &header("x-redlines-folder")?,
        too_broad,
        &header("x-redlines-name")?,
        bytes,
        MAX_IMAGE_BYTES,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The start of a PNG, which is all the app looks at to tell one.
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000";

    /// A new empty folder for one test.
    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "redlines-image-files-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    /// A document in a new folder, and the folder.
    fn document(name: &str) -> (PathBuf, PathBuf) {
        let own = folder(name);
        let document = own.join("plan.md");
        std::fs::write(&document, "# Plan\n").unwrap();
        (own, document)
    }

    #[test]
    fn the_folder_for_images_is_none_or_a_plain_name() {
        assert_eq!(relative_folder(""), Ok(None));
        for name in ["images", "plan.assets", "my images", "Bilder 1"] {
            assert_eq!(relative_folder(name), Ok(Some(name)), "{name}");
        }
        // No way out of the document's folder, and no hidden name, which the preview doesn't load.
        for name in [
            "../images",
            "a/b",
            "/images",
            ".images",
            "..",
            ".",
            "a\\b",
            " ",
            "a\nb",
        ] {
            assert!(relative_folder(name).is_err(), "{name:?}");
        }
    }

    #[test]
    fn images_go_beside_the_document_in_the_folder_named_or_in_its_own() {
        let document = Path::new("/docs/plan.md");
        assert_eq!(
            destination(document, "images", false),
            Ok(PathBuf::from("/docs/images"))
        );
        assert_eq!(destination(document, "", false), Ok(PathBuf::from("/docs")));
        assert!(destination(document, "../x", false).is_err());
        assert!(destination(Path::new("plan.md"), "images", false).is_err());
    }

    #[test]
    fn a_project_too_broad_takes_images_in_its_documents_own_folder_alone() {
        let document = Path::new("/Users/ada/plan.md");
        assert_eq!(
            destination(document, "", true),
            Ok(PathBuf::from("/Users/ada"))
        );
        let refused = destination(document, "images", true).unwrap_err();
        assert!(refused.contains("In Preferences"), "{refused}");
    }

    #[test]
    fn a_new_file_never_takes_the_name_of_one_that_is_there() {
        let dir = folder("unique");
        std::fs::write(dir.join("shot.png"), "mine").unwrap();
        let (_, made) = unique_file(&dir, "shot.png").unwrap();
        assert_eq!(made, "shot-2.png");
        let (_, made) = unique_file(&dir, "shot.png").unwrap();
        assert_eq!(made, "shot-3.png");
        assert_eq!(std::fs::read(dir.join("shot.png")).unwrap(), b"mine");
        // A name of no extension, and one of several dots, are numbered before the last.
        std::fs::write(dir.join("README"), "").unwrap();
        std::fs::write(dir.join("a.b.png"), "").unwrap();
        assert_eq!(unique_file(&dir, "README").unwrap().1, "README-2");
        assert_eq!(unique_file(&dir, "a.b.png").unwrap().1, "a.b-2.png");
    }

    #[test]
    fn a_name_is_made_one_a_folder_holds_and_the_preview_loads() {
        assert_eq!(
            clean_name("Screenshot 2026-11-12.png"),
            "Screenshot 2026-11-12.png"
        );
        assert_eq!(clean_name("café 日本.png"), "café 日本.png");
        // Never a hidden name, and never a path.
        assert_eq!(clean_name(".hidden.png"), "hidden.png");
        assert_eq!(clean_name("../../etc/shot.png"), "shot.png");
        assert_eq!(clean_name("a\\b\\shot.png"), "shot.png");
        assert_eq!(clean_name("a\u{7}b.png"), "a-b.png");
        assert_eq!(clean_name(""), "image");
        assert_eq!(clean_name("..."), "image");
        assert_eq!(clean_name("  "), "image");
    }

    #[test]
    fn copies_an_image_and_leaves_the_original_where_it_is() {
        let (own, _) = document("copies");
        let source = folder("copies-from").join("Photo 1.png");
        std::fs::write(&source, PNG).unwrap();
        let images = own.join("images");
        std::fs::create_dir_all(&images).unwrap();
        assert_eq!(
            copy_image(&images, &source, 1000),
            Ok("Photo 1.png".to_owned())
        );
        assert_eq!(std::fs::read(images.join("Photo 1.png")).unwrap(), PNG);
        // Copied, never moved.
        assert_eq!(std::fs::read(&source).unwrap(), PNG);
    }

    #[test]
    fn copies_to_a_numbered_name_when_the_name_is_taken_and_replaces_nothing() {
        let (own, _) = document("numbered");
        let source = folder("numbered-from").join("shot.png");
        std::fs::write(&source, PNG).unwrap();
        std::fs::write(own.join("shot.png"), "someone else's").unwrap();
        assert_eq!(copy_image(&own, &source, 1000), Ok("shot-2.png".to_owned()));
        assert_eq!(copy_image(&own, &source, 1000), Ok("shot-3.png".to_owned()));
        assert_eq!(
            std::fs::read(own.join("shot.png")).unwrap(),
            b"someone else's"
        );
        assert_eq!(std::fs::read(own.join("shot-3.png")).unwrap(), PNG);
    }

    #[test]
    fn links_an_image_that_is_in_the_folder_already_without_copying_it() {
        let (own, _) = document("already");
        std::fs::write(own.join("shot.png"), PNG).unwrap();
        assert_eq!(
            copy_image(&own, &own.join("shot.png"), 1000),
            Ok("shot.png".to_owned())
        );
        assert!(!own.join("shot-2.png").exists());
    }

    #[test]
    fn refuses_what_is_not_an_image_by_its_name_or_by_its_bytes() {
        let (own, _) = document("refuses");
        let from = folder("refuses-from");
        std::fs::write(from.join("notes.txt"), PNG).unwrap();
        std::fs::write(from.join("fake.png"), "not an image at all").unwrap();
        std::fs::create_dir_all(from.join("folder.png")).unwrap();
        for name in ["notes.txt", "fake.png", "folder.png", "gone.png"] {
            let refused = copy_image(&own, &from.join(name), 1000);
            assert!(refused.is_err(), "{name}: {refused:?}");
        }
        assert_eq!(
            copy_image(&own, &from.join("fake.png"), 1000),
            Err("“fake.png” isn’t an image Redlines can show.".to_owned())
        );
        // Nothing was made.
        assert_eq!(std::fs::read_dir(&own).unwrap().count(), 1);
    }

    #[test]
    fn refuses_an_image_larger_than_the_preview_serves_and_leaves_no_file() {
        let (own, _) = document("large");
        let source = folder("large-from").join("big.png");
        let mut bytes = PNG.to_vec();
        bytes.resize(2000, 0);
        std::fs::write(&source, &bytes).unwrap();
        assert_eq!(
            copy_image(&own, &source, 1000),
            Err("“big.png” is larger than 50 MB, so Redlines doesn’t add it.".to_owned())
        );
        assert!(!own.join("big.png").exists());
        assert_eq!(copy_image(&own, &source, 2000), Ok("big.png".to_owned()));
    }

    #[test]
    fn writes_pasted_data_under_the_name_it_is_given_and_never_over_a_file() {
        let (own, _) = document("pasted");
        assert_eq!(
            write_image(&own, "image-2026-11-12-153012.png", PNG, 1000),
            Ok("image-2026-11-12-153012.png".to_owned())
        );
        assert_eq!(
            write_image(&own, "image-2026-11-12-153012.png", PNG, 1000),
            Ok("image-2026-11-12-153012-2.png".to_owned())
        );
        assert_eq!(
            std::fs::read(own.join("image-2026-11-12-153012.png")).unwrap(),
            PNG
        );
    }

    #[test]
    fn refuses_pasted_data_that_is_not_the_image_its_name_says() {
        let (own, _) = document("pasted-bad");
        assert!(write_image(&own, "shot.png", b"text", 1000).is_err());
        assert!(write_image(&own, "shot.txt", PNG, 1000).is_err());
        assert!(write_image(&own, "shot.png", PNG, 5).is_err());
        assert_eq!(std::fs::read_dir(&own).unwrap().count(), 1);
    }

    #[test]
    fn adds_the_images_it_can_and_says_why_for_the_others() {
        let (own, document) = document("adds");
        let from = folder("adds-from");
        std::fs::write(from.join("a.png"), PNG).unwrap();
        std::fs::write(from.join("b.txt"), "no").unwrap();
        std::fs::write(from.join("c.png"), PNG).unwrap();
        let files = ["a.png", "b.txt", "c.png"].map(|name| from.join(name));
        let added = add_files(&document, "images", false, &files, 1000).unwrap();
        assert_eq!(added.paths, ["images/a.png", "images/c.png"]);
        assert_eq!(added.refused, ["“b.txt” isn’t an image Redlines can show."]);
        assert!(own.join("images/a.png").is_file());
        // The document's own folder is linked by the bare name.
        let beside = add_files(&document, "", false, &files[..1], 1000).unwrap();
        assert_eq!(beside.paths, ["a.png"]);
        assert!(own.join("a.png").is_file());
    }

    #[test]
    fn makes_the_folder_for_images_and_takes_it_away_when_nothing_went_in() {
        let (own, document) = document("empty");
        let from = folder("empty-from");
        std::fs::write(from.join("b.txt"), "no").unwrap();
        let added = add_files(&document, "images", false, &[from.join("b.txt")], 1000).unwrap();
        assert!(added.paths.is_empty());
        assert!(!own.join("images").exists());
        // A folder that was there stays, empty or not.
        std::fs::create_dir_all(own.join("images")).unwrap();
        add_files(&document, "images", false, &[from.join("b.txt")], 1000).unwrap();
        assert!(own.join("images").is_dir());
    }

    #[test]
    fn adds_pasted_data_beside_the_document() {
        let (own, document) = document("adds-data");
        let added = add_data(&document, "plan.assets", false, "image.png", PNG, 1000).unwrap();
        assert_eq!(added.paths, ["plan.assets/image.png"]);
        assert_eq!(
            std::fs::read(own.join("plan.assets/image.png")).unwrap(),
            PNG
        );
        let refused = add_data(&document, "plan.assets", false, "image.png", b"no", 1000).unwrap();
        assert!(refused.paths.is_empty());
        assert_eq!(
            refused.refused,
            ["“image.png” isn’t an image Redlines can show."]
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_folder_that_leads_out_of_the_documents_folder() {
        let (own, document) = document("outside");
        let elsewhere = folder("outside-elsewhere");
        std::os::unix::fs::symlink(&elsewhere, own.join("images")).unwrap();
        let from = folder("outside-from");
        std::fs::write(from.join("a.png"), PNG).unwrap();
        let refused = add_files(&document, "images", false, &[from.join("a.png")], 1000);
        assert_eq!(refused, Err(OUTSIDE.to_owned()));
        assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn follows_a_folder_that_is_a_link_to_one_inside_the_documents_folder() {
        let (own, document) = document("inside");
        std::fs::create_dir_all(own.join("real")).unwrap();
        std::os::unix::fs::symlink(own.join("real"), own.join("images")).unwrap();
        let added = add_data(&document, "images", false, "a.png", PNG, 1000).unwrap();
        assert_eq!(added.paths, ["images/a.png"]);
        assert!(own.join("real/a.png").is_file());
    }

    #[test]
    fn a_drop_adds_images_only_when_every_file_is_one() {
        let dir = folder("drop");
        std::fs::write(dir.join("a.png"), PNG).unwrap();
        std::fs::write(dir.join("b.JPG"), PNG).unwrap();
        std::fs::write(dir.join("c.svg"), "<svg/>").unwrap();
        std::fs::write(dir.join("plan.md"), "# Plan").unwrap();
        std::fs::create_dir_all(dir.join("folder.png")).unwrap();
        let at = |names: &[&str]| names.iter().map(|name| dir.join(name)).collect::<Vec<_>>();
        assert!(images_only(&at(&["a.png"])));
        assert!(images_only(&at(&["a.png", "b.JPG", "c.svg"])));
        assert!(!images_only(&[]));
        assert!(!images_only(&at(&["a.png", "plan.md"])));
        assert!(!images_only(&at(&["plan.md"])));
        // A folder named like an image is no image.
        assert!(!images_only(&at(&["folder.png"])));
        assert!(!images_only(&at(&["missing.png"])));
    }

    #[test]
    fn a_drops_position_is_in_points_of_the_page_whatever_the_system_calls_it() {
        // The Mac's drop position is the pasteboard's dragging location, in points from the top
        // left of the web view, though Tauri calls it physical (wry, wkwebview/drag_drop.rs): it is
        // taken as it is. Elsewhere it is physical pixels, which the scale factor turns into points.
        let position = PhysicalPosition::new(100.0, 40.0);
        assert_eq!(drop_points(position, 2.0, true), (100.0, 40.0));
        assert_eq!(drop_points(position, 2.0, false), (50.0, 20.0));
        assert_eq!(drop_points(position, 1.0, false), (100.0, 40.0));
        // A window that can't say its scale is at 1.
        assert_eq!(drop_points(position, 0.0, false), (100.0, 40.0));
    }

    #[test]
    fn keeps_each_drop_for_its_window_until_it_is_taken_once() {
        let sources = ImageSources::default();
        let one = sources.keep("main", vec![PathBuf::from("/a.png")]);
        let two = sources.keep("main", vec![PathBuf::from("/b.png")]);
        let other = sources.keep("doc-1", vec![PathBuf::from("/c.png")]);
        assert!(one < two && two < other);
        // Another window's files are not this one's.
        assert_eq!(sources.take("doc-1", one), None);
        assert_eq!(
            sources.take("main", two),
            Some(vec![PathBuf::from("/b.png")])
        );
        assert_eq!(sources.take("main", two), None);
        assert_eq!(
            sources.take("main", one),
            Some(vec![PathBuf::from("/a.png")])
        );
        sources.forget_window("doc-1");
        assert_eq!(sources.take("doc-1", other), None);
    }

    #[test]
    fn keeps_a_few_drops_for_a_window_and_lets_the_oldest_go() {
        let sources = ImageSources::default();
        let ids: Vec<u64> = (0..KEPT_PER_WINDOW + 2)
            .map(|n| sources.keep("main", vec![PathBuf::from(format!("/{n}.png"))]))
            .collect();
        assert_eq!(sources.take("main", ids[0]), None);
        assert_eq!(sources.take("main", ids[1]), None);
        assert!(sources.take("main", ids[2]).is_some());
        assert!(sources.take("main", *ids.last().unwrap()).is_some());
    }
}
