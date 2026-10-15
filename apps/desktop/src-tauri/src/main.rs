// Keeps Windows from opening a console window next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    redlines_desktop_lib::run();
}
