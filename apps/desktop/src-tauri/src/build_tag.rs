//! The build tag: which build of Redlines this is. About Redlines shows it, and nothing else does.
//!
//! A release build, which the release workflow makes for a published release, is tagged with its
//! version and commit: `0.1.0 (1a2b3c4)`. Every other build (`pnpm tauri build`, `pnpm tauri dev`,
//! a test build of the release workflow) adds `-dev` to the version, and to the commit the time it
//! was built, so that two builds of one commit can be told apart: `0.1.0-dev
//! (1a2b3c4-20261101.1430)`.
//!
//! `build.rs` makes the tag as the app compiles, from what the release workflow sets
//! (`REDLINES_RELEASE`, `REDLINES_COMMIT`, `SOURCE_DATE_EPOCH`), or else from git and the clock.
//! The time is when the build script last ran: Cargo runs it again when the commit, those
//! variables or the app's configuration change. This file is compiled into the build script, and
//! into the app for its tests.

use std::fmt;

/// A build tag in the two parts that About shows: "Version 0.1.0 (1a2b3c4)".
#[derive(Debug, PartialEq)]
pub struct BuildTag {
    /// The version, `0.1.0`, or `0.1.0-dev` for a build that isn't a release.
    pub version: String,
    /// The commit, `1a2b3c4`, and for a build that isn't a release the time it was built in UTC,
    /// `1a2b3c4-20261101.1430`.
    pub build: String,
}

impl BuildTag {
    /// The tag of a build of `version` from `commit` (as `short_commit` gives it), made at
    /// `built_at` seconds since 1970.
    pub fn new(version: &str, commit: &str, built_at: u64, release: bool) -> Self {
        if release {
            BuildTag {
                version: version.to_owned(),
                build: commit.to_owned(),
            }
        } else {
            BuildTag {
                version: format!("{version}-dev"),
                build: format!("{commit}-{}", utc_stamp(built_at)),
            }
        }
    }
}

impl fmt::Display for BuildTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.version, self.build)
    }
}

/// Whether `REDLINES_RELEASE` marks a release build: set to `1` or `true`.
pub fn is_release(value: Option<&str>) -> bool {
    matches!(value.map(str::trim), Some("1" | "true"))
}

/// A commit as the tag shows it: its first seven hexadecimal digits, or `unknown`.
pub fn short_commit(commit: Option<&str>) -> String {
    let commit = commit.map(str::trim).unwrap_or_default();
    if commit.len() >= 7 && commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        commit[..7].to_ascii_lowercase()
    } else {
        "unknown".to_owned()
    }
}

/// A time in seconds since 1970 as `yyyymmdd.hhmm`, in UTC.
pub fn utc_stamp(seconds: u64) -> String {
    let (days, of_day) = (seconds / 86_400, seconds % 86_400);
    let (hour, minute) = (of_day / 3_600, of_day % 3_600 / 60);
    // The days since 1970 as a date in the proleptic Gregorian calendar, in eras of 400 years
    // that start on 1 March (Howard Hinnant's `civil_from_days`).
    let shifted = days + 719_468;
    let (era, day_of_era) = (shifted / 146_097, shifted % 146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_from_march = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_from_march + 2) / 5 + 1;
    let month = if month_from_march < 10 {
        month_from_march + 3
    } else {
        month_from_march - 9
    };
    let year = era * 400 + year_of_era + u64::from(month <= 2);
    format!("{year:04}{month:02}{day:02}.{hour:02}{minute:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_is_tagged_with_its_version_and_commit() {
        let tag = BuildTag::new("0.1.0", "1a2b3c4", 1_793_543_459, true);
        assert_eq!(
            tag,
            BuildTag {
                version: "0.1.0".to_owned(),
                build: "1a2b3c4".to_owned()
            }
        );
        assert_eq!(tag.to_string(), "0.1.0 (1a2b3c4)");
    }

    #[test]
    fn any_other_build_is_a_dev_build_with_the_time_it_was_built() {
        let tag = BuildTag::new("0.1.0", "1a2b3c4", 1_793_543_459, false);
        assert_eq!(tag.version, "0.1.0-dev");
        assert_eq!(tag.build, "1a2b3c4-20261101.1430");
        assert_eq!(tag.to_string(), "0.1.0-dev (1a2b3c4-20261101.1430)");
    }

    #[test]
    fn only_1_or_true_marks_a_release() {
        assert!(is_release(Some("1")));
        assert!(is_release(Some("true")));
        assert!(is_release(Some(" 1\n")));
        assert!(!is_release(None));
        assert!(!is_release(Some("")));
        assert!(!is_release(Some("0")));
        assert!(!is_release(Some("false")));
        assert!(!is_release(Some("yes")));
    }

    #[test]
    fn a_commit_is_shown_by_its_first_seven_digits() {
        let full = "1A2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D";
        assert_eq!(short_commit(Some(full)), "1a2b3c4");
        assert_eq!(short_commit(Some("1a2b3c4\n")), "1a2b3c4");
        // Anything that isn't a commit says so.
        assert_eq!(short_commit(None), "unknown");
        assert_eq!(short_commit(Some("")), "unknown");
        assert_eq!(short_commit(Some("1a2b3c")), "unknown");
        assert_eq!(short_commit(Some("main-branch")), "unknown");
    }

    #[test]
    fn times_are_dates_and_minutes_in_utc() {
        assert_eq!(utc_stamp(0), "19700101.0000");
        assert_eq!(utc_stamp(951_868_799), "20000229.2359");
        assert_eq!(utc_stamp(1_709_208_300), "20240229.1205");
        assert_eq!(utc_stamp(1_793_543_459), "20261101.1430");
        assert_eq!(utc_stamp(1_798_761_540), "20261231.2359");
        // 2100 isn't a leap year: the day after 28 February is 1 March.
        assert_eq!(utc_stamp(4_107_542_400), "21000301.0000");
        assert_eq!(utc_stamp(4_107_542_400 - 86_400), "21000228.0000");
    }
}
