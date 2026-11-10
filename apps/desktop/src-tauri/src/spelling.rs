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
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

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

    /// Adds the defaults to the registration domain, which keeps what was registered there before.
    pub fn register_defaults() {
        // SAFETY: the dictionary holds property list objects alone, a string and a number, which is
        // what the registration domain takes.
        unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults()) };
    }
}

#[cfg(test)]
mod tests {
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
