/// Starts the app. The desktop binary calls this from `main`; mobile builds start here directly.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Redlines");
}
