//! The menu bar's shortcuts are written in `src/menu-model.ts` as strings, and the menu bar
//! parses them with muda. Tauri drops a shortcut it can't parse without a word, leaving the item
//! with no key (`Plus` was one). This reads every `accelerator: '…'` in the model and parses it
//! the way the menu bar does.

use std::str::FromStr;

use muda::accelerator::Accelerator;

#[test]
fn every_accelerator_in_the_menu_model_parses() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/menu-model.ts");
    let source = std::fs::read_to_string(path).expect("the menu model is beside the app");
    let marker = "accelerator: '";
    let accelerators: Vec<&str> = source
        .match_indices(marker)
        .filter_map(|(at, _)| {
            let rest = &source[at + marker.len()..];
            rest.find('\'').map(|end| &rest[..end])
        })
        .collect();
    // Not vacuous: the model has well over a dozen.
    assert!(accelerators.len() > 12, "found {accelerators:?}");
    for accelerator in accelerators {
        assert!(
            Accelerator::from_str(accelerator).is_ok(),
            "the menu bar can't parse {accelerator:?}, so the item would have no shortcut"
        );
    }
}

#[test]
fn the_parser_refuses_what_this_test_exists_to_catch() {
    assert!(Accelerator::from_str("CmdOrCtrl+Plus").is_err());
    assert!(Accelerator::from_str("CmdOrCtrl+=").is_ok());
}
