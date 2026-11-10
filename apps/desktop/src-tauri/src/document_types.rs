//! The documents the app's bundle declares, which macOS reads: Finder's Open With offers Redlines
//! for them, and Redlines can be made the default app for Markdown. They are in
//! `document-types.plist`, which Tauri's bundler merges into the Info.plist it writes for the Mac
//! (`bundle.macOS.infoPlist`), and nowhere else: the Windows and Linux installers claim no files,
//! and the program that `tauri dev` runs, outside a bundle, claims none either. These tests read
//! that file, and, after `pnpm tauri build --debug --bundles app`, the built app's Info.plist.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// The type macOS gives Markdown files, the one Redlines opens them by.
const MARKDOWN: &str = "net.daringfireball.markdown";

/// The parts of an Info.plist that say which documents an app opens.
#[derive(Debug, Deserialize)]
struct Declared {
    #[serde(rename = "CFBundleDocumentTypes", default)]
    documents: Vec<Document>,
    #[serde(rename = "UTImportedTypeDeclarations", default)]
    imported: Vec<Type>,
    #[serde(rename = "UTExportedTypeDeclarations", default)]
    exported: Vec<Type>,
}

/// A kind of document the app opens, by its types or else by the extensions of its files.
#[derive(Debug, Deserialize, PartialEq)]
struct Document {
    #[serde(rename = "CFBundleTypeName")]
    name: String,
    #[serde(rename = "CFBundleTypeRole")]
    role: String,
    #[serde(rename = "LSHandlerRank")]
    rank: String,
    #[serde(rename = "LSItemContentTypes", default)]
    types: Vec<String>,
    #[serde(rename = "CFBundleTypeExtensions", default)]
    extensions: Vec<String>,
}

/// A type an app declares: what it conforms to, and the extensions and MIME types of its files.
#[derive(Debug, Deserialize, PartialEq)]
struct Type {
    #[serde(rename = "UTTypeIdentifier")]
    identifier: String,
    #[serde(rename = "UTTypeConformsTo", default)]
    conforms_to: Vec<String>,
    #[serde(rename = "UTTypeTagSpecification")]
    tags: Tags,
}

#[derive(Debug, Deserialize, PartialEq)]
struct Tags {
    #[serde(rename = "public.filename-extension", default)]
    extensions: Vec<String>,
    #[serde(rename = "public.mime-type", default)]
    mime_types: Vec<String>,
}

/// The file Tauri's bundler merges into the app's Info.plist, as `tauri.conf.json` names it.
fn source() -> PathBuf {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.join("tauri.conf.json")).unwrap()).unwrap();
    let named = config["bundle"]["macOS"]["infoPlist"]
        .as_str()
        .expect("tauri.conf.json names the file the bundle's Info.plist takes in");
    folder.join(named)
}

fn read<T: serde::de::DeserializeOwned>(plist: &Path) -> T {
    plist::from_file(plist).unwrap_or_else(|error| panic!("{}: {error}", plist.display()))
}

/// What the bundle should declare: Markdown by its type, the one Redlines can be made the default
/// app for, at the rank of an app that opens it; R Markdown and Quarto by their extensions, which
/// macOS has no type for, at the same rank; and plain text by `.txt` alone, at the rank of an
/// alternative, so that Redlines is offered for those files and takes none from the app that opens
/// them. Plain text's own type would offer Redlines for every kind of text that is plain text to
/// macOS too, such as source code, which Redlines doesn't open. Redlines edits them all.
fn expected() -> Vec<Document> {
    let editor = |name: &str, rank: &str, types: &[&str], extensions: &[&str]| Document {
        name: name.to_owned(),
        role: "Editor".to_owned(),
        rank: rank.to_owned(),
        types: types.iter().map(|&each| each.to_owned()).collect(),
        extensions: extensions.iter().map(|&each| each.to_owned()).collect(),
    };
    vec![
        editor("Markdown Document", "Default", &[MARKDOWN], &[]),
        editor("R Markdown Document", "Default", &[], &["Rmd"]),
        editor("Quarto Document", "Default", &[], &["qmd"]),
        editor("Plain Text Document", "Alternate", &[], &["txt"]),
    ]
}

/// What the bundle imports: what Markdown is, for a macOS that doesn't say. The app owns no type.
fn markdown_type() -> Type {
    Type {
        identifier: MARKDOWN.to_owned(),
        conforms_to: vec!["public.plain-text".to_owned()],
        tags: Tags {
            extensions: vec!["md".to_owned(), "markdown".to_owned()],
            mime_types: vec!["text/markdown".to_owned()],
        },
    }
}

#[test]
fn the_bundle_declares_markdown_r_markdown_quarto_and_plain_text_for_editing() {
    let declared: Declared = read(&source());
    assert_eq!(declared.documents, expected());
    assert_eq!(declared.imported, [markdown_type()]);
    assert_eq!(declared.exported, []);
}

#[test]
fn every_document_the_app_opens_is_declared_and_no_other_file() {
    let declared: Declared = read(&source());
    let mut offered = BTreeSet::new();
    for document in &declared.documents {
        offered.extend(document.extensions.iter().map(|each| each.to_lowercase()));
        for name in &document.types {
            // A type is declared with its extensions, so that every macOS knows it.
            let imported = declared
                .imported
                .iter()
                .find(|each| &each.identifier == name)
                .unwrap_or_else(|| panic!("{name} is claimed but not imported"));
            offered.extend(
                imported
                    .tags
                    .extensions
                    .iter()
                    .map(|each| each.to_lowercase()),
            );
        }
    }
    let opened: BTreeSet<String> = crate::project::DOCUMENTS
        .iter()
        .map(|&each| each.to_owned())
        .collect();
    assert_eq!(offered, opened);
}

#[test]
fn the_file_holds_only_what_tauri_adds_to_its_own() {
    // Tauri's bundler lets each key of the file replace its own, such as the version.
    let keys: plist::Dictionary = read(&source());
    assert_eq!(
        keys.keys().map(String::as_str).collect::<Vec<_>>(),
        ["CFBundleDocumentTypes", "UTImportedTypeDeclarations"]
    );
    // Tauri builds an Info.plist beside its config into the program that `tauri dev` runs too.
    let beside = Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist");
    assert!(
        !beside.exists(),
        "{} would claim documents for that program",
        beside.display()
    );
}

/// The app that `pnpm tauri build --debug --bundles app` builds, or the one `REDLINES_APP` names.
fn built_app() -> PathBuf {
    std::env::var_os("REDLINES_APP").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("target/debug/bundle/macos/Redlines.app"),
        PathBuf::from,
    )
}

#[test]
#[ignore = "reads a built app: run with --ignored after pnpm tauri build --debug --bundles app"]
fn the_built_app_declares_them_and_keeps_what_tauri_writes() {
    let info = built_app().join("Contents/Info.plist");
    let declared: Declared = read(&info);
    assert_eq!(declared.documents, expected());
    assert_eq!(declared.imported, [markdown_type()]);
    assert_eq!(declared.exported, []);
    // Merged into Tauri's own, not in place of it: this app, with its program.
    let keys: plist::Dictionary = read(&info);
    let config: serde_json::Value = serde_json::from_slice(
        &std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        keys.get("CFBundleIdentifier")
            .and_then(plist::Value::as_string),
        config["identifier"].as_str()
    );
    assert!(keys.contains_key("CFBundleExecutable"), "{keys:?}");
}
