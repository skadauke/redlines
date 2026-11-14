// Prints the on-screen windows of the processes asked for, as JSON, one object per window:
// id (for `screencapture -l`), pid, owner, title, layer, and bounds. Used by app-windows.
//
//   window-list <pid> [<pid> ...]
//
// A window's title is empty unless the terminal has Screen Recording permission; the id, the
// bounds and the owner never need it.

import CoreGraphics
import Foundation

// `window-list --preflight` says whether this process may record the screen (Screen Recording
// permission for the terminal that runs it), and exits 0 when it may and 1 when it may not.
if CommandLine.arguments.dropFirst().first == "--preflight" {
    let allowed = CGPreflightScreenCaptureAccess()
    print(allowed ? "true" : "false")
    exit(allowed ? 0 : 1)
}

let pids = Set(CommandLine.arguments.dropFirst().compactMap { Int32($0) })
let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
var found: [[String: Any]] = []
for window in info {
    guard let pid = window[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid) else { continue }
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    found.append([
        "id": window[kCGWindowNumber as String] as? Int ?? 0,
        "pid": Int(pid),
        "owner": window[kCGWindowOwnerName as String] as? String ?? "",
        "title": window[kCGWindowName as String] as? String ?? "",
        "layer": window[kCGWindowLayer as String] as? Int ?? 0,
        "onscreen": window[kCGWindowIsOnscreen as String] as? Bool ?? false,
        "x": bounds["X"] as? Double ?? 0,
        "y": bounds["Y"] as? Double ?? 0,
        "width": bounds["Width"] as? Double ?? 0,
        "height": bounds["Height"] as? Double ?? 0,
    ])
}
let data = try JSONSerialization.data(withJSONObject: found, options: [.sortedKeys])
print(String(data: data, encoding: .utf8) ?? "[]")
