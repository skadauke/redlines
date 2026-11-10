//! The images the preview loads (design, Rendering): the files of the folders the sidebars show
//! (`project::Projects`), and no others. The page loads them through `asset:` URLs, which it makes
//! with `convertFileSrc` (`src/host.ts`), and asks only for the files of its own project
//! (`src/images.ts`); what those URLs reach is the app's to decide, here.

use std::path::Path;

use tauri::{AppHandle, Manager, Runtime};

use crate::project::Projects;

/// What the page may load through `asset:` URLs: the asset protocol's scope, which starts empty
/// (`tauri.conf.json`) and takes each folder a sidebar shows (`allow_shown`).
#[derive(Clone)]
pub struct Images(tauri::fs::Scope);

impl Images {
    fn new<R: Runtime>(app: &impl Manager<R>) -> Self {
        Self(app.asset_protocol_scope())
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

    /// Whether the page may load the file at `path`.
    #[cfg(test)]
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

/// The preview loads the images of the project folders the sidebars show, and no others.
pub fn set_up(app: &AppHandle) {
    allow_shown(&Images::new(app), &app.state::<Projects>());
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

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
        let (images, projects) = (Images::new(&app), Projects::default());
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

    #[test]
    fn a_folder_shown_alone_lets_the_page_load_its_own_files_and_not_its_subfolders() {
        // As a document in the home folder shows it (`Projects::show`).
        let folder = folder("alone");
        make(&folder, &["note.md", "cat.png", "Pictures/dog.png"]);
        let app = tauri::test::mock_app();
        let images = Images::new(&app);
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
        let images = Images::new(&app);
        images.allow_folder(&folder.join("Notes"), true);
        assert!(images.may_load(&folder.join("Notes/cat.png")));
        assert!(images.may_load(&folder.join("CloudStorage/Notes/cat.png")));
        fs::remove_dir_all(&folder).unwrap();
    }
}
