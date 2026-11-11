//! Spell checking while typing, on the Mac (design §6.4: the platform's spellcheck, on by default
//! in the app).
//!
//! WebKit checks spelling as the person types only while its switch for the whole app is on: the
//! switch that Safari's Edit › Spelling and Grammar › Check Spelling While Typing turns, which WebKit
//! reads from the app's defaults (`WebContinuousSpellCheckingEnabled`), once, no later than the
//! first web view. A missing key is off, and nothing in Tauri or its web views sets it. The
//! `spellcheck` attribute, which Preferences › Editor › Spell check sets on the document, only says
//! what is checked while the switch is on.
//!
//! So the app registers the switch as on, first thing at launch. A registered default is never
//! saved, and a value in the app's own defaults wins over it: turning the switch off in a field's
//! context menu (Spelling and Grammar › Check Spelling While Typing) saves one, which the next
//! launches keep, as in Safari. The web views of other platforms don't read the Mac's defaults, and
//! nothing is registered there.
//!
//! A word ended with Return gets the system's correction, which WebKit never makes (the editor
//! handles the key itself): `correct_word` asks `NSSpellChecker` for it, for the editor to make.

/// What the checker is asked: the context and the word as one text, and where the word is in it,
/// in UTF-16 units, which is how `NSString` counts.
#[derive(Debug, PartialEq, Eq)]
pub struct Query {
    pub text: String,
    pub start: usize,
    pub len: usize,
}

/// How much of the block before the word the checker reads, in characters: its language, and
/// nothing a paragraph further back would add.
const CONTEXT_CHARS: usize = 500;

/// Whether `word` is one the editor may ask about: letters, with an apostrophe inside. Anything else
/// is left unsaid, so that no one is sent whatever text a page sends.
fn is_word(word: &str) -> bool {
    let mut chars = word.chars().peekable();
    let mut previous_letter = false;
    let mut any = false;
    while let Some(c) = chars.next() {
        if c.is_alphabetic() {
            previous_letter = true;
            any = true;
        } else if matches!(c, '\'' | '\u{2019}') && previous_letter && chars.peek().is_some() {
            previous_letter = false;
        } else {
            return false;
        }
    }
    any && previous_letter
}

/// The text to check and the word's range in it, or None when `word` is no word.
pub fn query(word: &str, before: &str) -> Option<Query> {
    if !is_word(word) {
        return None;
    }
    // The last characters of the context, from a character boundary.
    let skip = before.chars().count().saturating_sub(CONTEXT_CHARS);
    let context: String = before.chars().skip(skip).collect();
    let start = context.encode_utf16().count();
    Some(Query {
        len: word.encode_utf16().count(),
        text: context + word,
        start,
    })
}

/// What the checker found over the text, in UTF-16 units.
#[derive(Debug, PartialEq, Eq)]
pub enum Found {
    /// A correction of the range, with its text: what the checker replaces on its own, as `i`
    /// with `I`.
    Correction {
        start: usize,
        len: usize,
        text: String,
    },
    /// A misspelled range, whose correction the checker gives when asked for that range.
    Misspelled { start: usize, len: usize },
}

/// The correction of the word: the checker's own for exactly its range, which differs from the
/// word, or, for a range it found misspelled exactly there, what `suggest` says of that range.
pub fn choose(
    query: &Query,
    found: impl IntoIterator<Item = Found>,
    suggest: impl FnOnce(&Query) -> Option<String>,
) -> Option<String> {
    let word = String::from_utf16(
        &query
            .text
            .encode_utf16()
            .skip(query.start)
            .take(query.len)
            .collect::<Vec<_>>(),
    )
    .ok()?;
    let mut misspelled = false;
    for item in found {
        match item {
            Found::Correction { start, len, text }
                if start == query.start && len == query.len && !text.is_empty() && text != word =>
            {
                return Some(text);
            }
            Found::Misspelled { start, len } if start == query.start && len == query.len => {
                misspelled = true;
            }
            _ => {}
        }
    }
    misspelled
        .then(|| suggest(query))
        .flatten()
        .filter(|text| !text.is_empty() && *text != word)
}

/// The correction of `word`, or None: for a word, while corrections are `enabled` (the system's
/// "Correct spelling automatically"), by `check`, which gets the query, and `suggest`.
pub fn correction(
    enabled: impl FnOnce() -> bool,
    word: &str,
    before: &str,
    check: impl FnOnce(&Query) -> Vec<Found>,
    suggest: impl FnOnce(&Query) -> Option<String>,
) -> Option<String> {
    let query = query(word, before)?;
    if !enabled() {
        return None;
    }
    choose(&query, check(&query), suggest)
}

/// The spell document tags of the windows, one for each window's life: the checker keeps what it
/// learns about a document, such as the words ignored, under its tag, so that repeated calls for a
/// window agree with each other. (WebKit's own tag for the page can't be reached from here, so
/// words ignored through the page's context menu are not among them.)
#[derive(Default)]
pub struct Tags {
    by_window: std::collections::HashMap<String, isize>,
}

impl Tags {
    /// The window's tag, made by `make` the first time.
    pub fn of(&mut self, window: &str, make: impl FnOnce() -> isize) -> isize {
        *self
            .by_window
            .entry(window.to_string())
            .or_insert_with(make)
    }

    /// Forgets the window's tag, and gives it for the checker to close.
    pub fn forget(&mut self, window: &str) -> Option<isize> {
        self.by_window.remove(window)
    }
}

/// A window has closed: its spell document is closed too.
pub fn window_closed(window: &str) {
    #[cfg(target_os = "macos")]
    macos::window_closed(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// The system's correction of `word`, which a Return ended (`before` is the block's text up to it),
/// or nothing: not a word, no correction, or "Correct spelling automatically" off in System
/// Settings. A plain function command, which Tauri runs on the main thread, where AppKit's spell
/// checker is meant to be used. Elsewhere it answers nothing.
#[tauri::command]
pub fn correct_word(window: tauri::WebviewWindow, word: String, before: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let tag = macos::tag_of(window.label());
        correction(
            macos::automatic_correction_enabled,
            &word,
            &before,
            |query| macos::check(query, tag),
            |query| macos::suggest(query, tag),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, word, before);
        None
    }
}

/// Registers the switch as on. First thing in `run`, before the app is built: WebKit reads it once,
/// no later than the first web view, and the first window opens in `setup`.
pub fn register_defaults() {
    #[cfg(target_os = "macos")]
    macos::register_defaults();
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSSpellChecker;
    use objc2_foundation::{
        NSDictionary, NSNumber, NSRange, NSString, NSTextCheckingType, NSUserDefaults,
    };
    use std::sync::Mutex;

    /// The defaults key WebKit reads its switch from.
    pub const CHECK_SPELLING_WHILE_TYPING: &str = "WebContinuousSpellCheckingEnabled";

    /// The defaults the app registers: the switch, on, as the number WebKit reads with
    /// `boolForKey:`.
    pub fn defaults() -> Retained<NSDictionary<NSString, AnyObject>> {
        let key = NSString::from_str(CHECK_SPELLING_WHILE_TYPING);
        let on = NSNumber::new_bool(true);
        let on: &AnyObject = &on;
        NSDictionary::from_slices(&[&*key], &[on])
    }

    static TAGS: Mutex<Option<super::Tags>> = Mutex::new(None);

    /// The window's spell document tag, made when it first asks.
    pub fn tag_of(window: &str) -> isize {
        let mut tags = TAGS.lock().unwrap_or_else(|e| e.into_inner());
        tags.get_or_insert_with(Default::default)
            .of(window, NSSpellChecker::uniqueSpellDocumentTag)
    }

    /// Closes the window's spell document, if it had one.
    pub fn window_closed(window: &str) {
        let forgotten = TAGS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .and_then(|tags| tags.forget(window));
        if let Some(tag) = forgotten {
            NSSpellChecker::sharedSpellChecker().closeSpellDocumentWithTag(tag);
        }
    }

    /// Whether the system's "Correct spelling automatically" is on.
    pub fn automatic_correction_enabled() -> bool {
        NSSpellChecker::isAutomaticSpellingCorrectionEnabled()
    }

    /// What the shared spell checker finds in the query's text: the corrections it makes on its
    /// own (`NSTextCheckingTypeCorrection`), and the misspelled words, which it gives no
    /// replacement for here, only for `suggest`.
    pub fn check(query: &super::Query, tag: isize) -> Vec<super::Found> {
        let checker = NSSpellChecker::sharedSpellChecker();
        let text = NSString::from_str(&query.text);
        let range = NSRange::new(0, text.length());
        let types = NSTextCheckingType::Correction.0 | NSTextCheckingType::Spelling.0;
        // SAFETY: the options are none and the orthography and word count are none and null: the
        // arguments the method documents as optional.
        let results = unsafe {
            checker.checkString_range_types_options_inSpellDocumentWithTag_orthography_wordCount(
                &text,
                range,
                types,
                None,
                tag,
                None,
                std::ptr::null_mut(),
            )
        };
        results
            .iter()
            .filter_map(|result| {
                let at = result.range();
                let (start, len) = (at.location, at.length);
                match result.resultType() {
                    NSTextCheckingType::Correction => Some(super::Found::Correction {
                        start,
                        len,
                        text: result.replacementString()?.to_string(),
                    }),
                    NSTextCheckingType::Spelling => Some(super::Found::Misspelled { start, len }),
                    _ => None,
                }
            })
            .collect()
    }

    /// The correction the checker proposes for the misspelled word: the one that autocorrection
    /// makes, which `checkString` leaves out of its results.
    pub fn suggest(query: &super::Query, tag: isize) -> Option<String> {
        let checker = NSSpellChecker::sharedSpellChecker();
        let text = NSString::from_str(&query.text);
        let correction = checker.correctionForWordRange_inString_language_inSpellDocumentWithTag(
            NSRange::new(query.start, query.len),
            &text,
            &checker.language(),
            tag,
        );
        correction.map(|text| text.to_string())
    }

    /// Adds the defaults to the registration domain, which keeps what was registered there before.
    pub fn register_defaults() {
        // SAFETY: the dictionary holds property list objects alone, a string and a number, which is
        // what the registration domain takes.
        unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults()) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_word_is_asked_about() {
        for word in ["teh", "Teh", "don't", "don\u{2019}t", "caf\u{e9}", "a"] {
            assert!(query(word, "").is_some(), "{word:?} is a word");
        }
        for word in [
            "", "12", "teh1", "a b", "'tis", "dont'", "a\nb", "x.y", "(teh)", "-",
        ] {
            assert!(query(word, "").is_none(), "{word:?} is no word");
        }
    }

    #[test]
    fn the_range_is_the_word_after_the_context_in_utf16_units() {
        let asked = query("teh", "Hello \u{1f600} ").unwrap();
        assert_eq!(asked.text, "Hello \u{1f600} teh");
        // The emoji takes two units.
        assert_eq!((asked.start, asked.len), (9, 3));
        assert_eq!(
            query("caf\u{e9}", "").unwrap(),
            Query {
                text: "caf\u{e9}".into(),
                start: 0,
                len: 4
            }
        );
    }

    #[test]
    fn the_context_is_cut_from_a_character_boundary() {
        let before = "\u{e9}".repeat(CONTEXT_CHARS + 20);
        let asked = query("teh", &before).unwrap();
        assert_eq!(asked.start, CONTEXT_CHARS);
        assert_eq!(asked.text.chars().count(), CONTEXT_CHARS + 3);
    }

    fn correction_at(start: usize, len: usize, text: &str) -> Found {
        Found::Correction {
            start,
            len,
            text: text.to_string(),
        }
    }

    fn no_suggestion(_: &Query) -> Option<String> {
        panic!("the checker is asked for a suggestion");
    }

    #[test]
    fn the_answer_is_the_correction_whose_range_is_the_word() {
        let asked = query("i", "Then ").unwrap();
        let found = vec![correction_at(0, 4, "Than"), correction_at(5, 1, "I")];
        assert_eq!(choose(&asked, found, no_suggestion), Some("I".to_string()));
    }

    #[test]
    fn a_correction_of_other_text_or_of_a_part_of_the_word_is_no_answer() {
        let asked = query("teh", "Hello ").unwrap();
        let none = |found| choose(&asked, found, no_suggestion);
        assert_eq!(none(vec![correction_at(0, 5, "Hullo")]), None);
        assert_eq!(none(vec![correction_at(6, 2, "th")]), None);
        assert_eq!(none(vec![correction_at(5, 4, "the")]), None);
        assert_eq!(none(vec![]), None);
        // A "correction" that is the word, or nothing.
        assert_eq!(none(vec![correction_at(6, 3, "teh")]), None);
        assert_eq!(none(vec![correction_at(6, 3, "")]), None);
    }

    #[test]
    fn a_misspelled_word_is_corrected_as_the_checker_suggests() {
        let asked = query("recieving", "I am ").unwrap();
        let found = vec![Found::Misspelled { start: 5, len: 9 }];
        let answer = choose(&asked, found, |q| {
            assert_eq!((q.start, q.len), (5, 9));
            Some("receiving".to_string())
        });
        assert_eq!(answer, Some("receiving".to_string()));
    }

    #[test]
    fn another_misspelled_word_is_not_asked_for() {
        let asked = query("recieving", "I am wierd and ").unwrap();
        let found = vec![
            Found::Misspelled { start: 5, len: 5 },
            Found::Misspelled { start: 20, len: 3 },
        ];
        assert_eq!(choose(&asked, found, no_suggestion), None);
    }

    #[test]
    fn a_suggestion_that_is_nothing_or_the_word_is_no_answer() {
        let asked = query("hte", "").unwrap();
        let found = || vec![Found::Misspelled { start: 0, len: 3 }];
        assert_eq!(choose(&asked, found(), |_| None), None);
        assert_eq!(choose(&asked, found(), |_| Some(String::new())), None);
        assert_eq!(choose(&asked, found(), |_| Some("hte".to_string())), None);
    }

    #[test]
    fn a_window_keeps_its_tag_until_it_closes() {
        let mut tags = Tags::default();
        let mut next = 10;
        let mut make = || {
            next += 1;
            next
        };
        let a = tags.of("doc-1", &mut make);
        assert_eq!(tags.of("doc-1", &mut make), a);
        let b = tags.of("doc-2", &mut make);
        assert_ne!(a, b);
        assert_eq!(tags.forget("doc-1"), Some(a));
        assert_eq!(tags.forget("doc-1"), None);
        // A window that opens again under the name has a tag of its own.
        assert_ne!(tags.of("doc-1", &mut make), a);
        assert_eq!(tags.of("doc-2", &mut make), b);
    }

    #[test]
    fn nothing_is_asked_while_corrections_are_off() {
        let answer = correction(
            || false,
            "teh",
            "Hello ",
            |_| panic!("the checker is asked with corrections off"),
            no_suggestion,
        );
        assert_eq!(answer, None);
    }

    #[test]
    fn nothing_is_asked_about_what_is_no_word() {
        let answer = correction(
            || panic!("the setting is read for no word"),
            "12",
            "Chapter ",
            |_| panic!("the checker is asked about no word"),
            no_suggestion,
        );
        assert_eq!(answer, None);
    }

    #[test]
    fn a_word_with_corrections_on_is_answered_from_the_checker() {
        let answer = correction(
            || true,
            "teh",
            "Hello ",
            |asked| {
                assert_eq!(asked.text, "Hello teh");
                vec![correction_at(asked.start, asked.len, "the")]
            },
            no_suggestion,
        );
        assert_eq!(answer, Some("the".to_string()));
    }

    /// Asks the real checker, which answers by the Mac's settings and language: run by hand.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "asks the system's spell checker, whose answer depends on the Mac's settings"]
    fn the_system_checker_corrects_a_typo() {
        let typo = query("recieving", "I am ").unwrap();
        let started = std::time::Instant::now();
        assert_eq!(
            choose(&typo, macos::check(&typo, 0), |q| macos::suggest(q, 0)),
            Some("receiving".to_string())
        );
        eprintln!("first call: {:?}", started.elapsed());
        let started = std::time::Instant::now();
        assert!(choose(&typo, macos::check(&typo, 0), |q| macos::suggest(q, 0)).is_some());
        eprintln!("second call: {:?}", started.elapsed());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn elsewhere_the_command_answers_nothing() {
        assert_eq!(correct_word("teh".into(), "Hello ".into()), None);
    }
    #[test]
    fn run_registers_the_defaults_before_it_builds_the_app() {
        // `run` in lib.rs: the registration comes before the builder, whose `setup` opens the
        // first window, the install question or the main window. Tauri opens none of the windows
        // in tauri.conf.json itself; the app does, from `setup` on.
        let lib = include_str!("lib.rs");
        let (_, run) = lib.split_once("pub fn run() {").expect("lib.rs has `run`");
        let registers = run
            .find("spelling::register_defaults();")
            .expect("`run` doesn't register the defaults");
        let builds = run
            .find("tauri::Builder::default()")
            .expect("`run` doesn't build the app");
        assert!(
            registers < builds,
            "`run` registers the defaults after it builds the app"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_defaults_turn_the_switch_on_and_nothing_else() {
        use super::macos;
        use objc2_foundation::{NSNumber, NSString};

        let defaults = macos::defaults();
        assert_eq!(defaults.count(), 1);
        let switch = defaults
            .objectForKey(&NSString::from_str(macos::CHECK_SPELLING_WHILE_TYPING))
            .expect("the switch isn't in the defaults");
        // A number, which WebKit reads with `boolForKey:`, as YES.
        let switch = switch
            .downcast_ref::<NSNumber>()
            .expect("the switch isn't a number");
        assert!(switch.as_bool());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_switch_is_registered_where_nothing_is_saved() {
        use super::{macos, register_defaults};
        use objc2_foundation::{NSNumber, NSRegistrationDomain, NSString, NSUserDefaults};

        register_defaults();
        let standard = NSUserDefaults::standardUserDefaults();
        // The registration domain is never written to disk, and every other domain wins over it:
        // the app's own, where the context menu saves the person's choice, and the global one.
        // SAFETY: a constant of Foundation's, there before any code of the app's runs.
        let registered = standard.volatileDomainForName(unsafe { NSRegistrationDomain });
        let switch = registered
            .objectForKey(&NSString::from_str(macos::CHECK_SPELLING_WHILE_TYPING))
            .expect("the switch isn't registered");
        let switch = switch
            .downcast_ref::<NSNumber>()
            .expect("the switch isn't a number");
        assert!(switch.as_bool());
    }
}
