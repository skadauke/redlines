// The Quick Look preview of Markdown, R Markdown and Quarto files (#316): a data-based preview that
// answers with a page of HTML, which Quick Look draws. The extension reads the one file it is asked
// to preview, runs the renderer that is bundled in it (PreviewRenderer.swift, preview.js), and never
// calls the `redlines` program, the app or anything on the PATH. It is sandboxed, has no network
// entitlement, and the page it sends carries no script.

import Foundation
import QuickLookUI
import UniformTypeIdentifiers
import os

private let log = Logger(subsystem: "md.redlines.editor.preview", category: "preview")

/// The most of a file that is read, in bytes. A longer file is shown as far as this, and the page
/// says so: the renderer would take longer than Quick Look waits.
private let maxBytes = 4 * 1024 * 1024

@objc(RedlinesPreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let url = request.fileURL
        let started = Date()
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: maxBytes + 1) ?? Data()
        let cut = data.count > maxBytes
        // Not every file is well-formed UTF-8: what isn't is shown as the replacement character.
        var text = String(decoding: cut ? data.prefix(maxBytes) : data, as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }

        let html: String
        do {
            html = try renderer().html(text: text, name: url.lastPathComponent, cut: cut)
        } catch {
            // A preview that fails shows nothing, so the file is shown as the text it is. A file's
            // name is the person's, and stays out of the log: the log is read by whoever reads it.
            log.error("preview failed: \(String(describing: error), privacy: .private)")
            html = PreviewRenderer.fallbackPage(text: text, name: url.lastPathComponent)
        }
        log.notice("preview of \(data.count) bytes in \(Int(Date().timeIntervalSince(started) * 1000)) ms")

        let reply = QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 800, height: 960)) { reply in
            reply.stringEncoding = .utf8
            return Data(html.utf8)
        }
        return reply
    }

    /// The renderer that is bundled in this extension.
    private func renderer() throws -> PreviewRenderer {
        guard let script = Bundle(for: PreviewProvider.self).url(forResource: "preview", withExtension: "js") else {
            throw PreviewRenderer.Failure.missing("preview.js is not in the extension")
        }
        return try PreviewRenderer(script: String(contentsOf: script, encoding: .utf8))
    }
}
