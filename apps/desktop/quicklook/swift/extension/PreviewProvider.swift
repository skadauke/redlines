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

@objc(RedlinesPreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {
    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let url = request.fileURL
        let started = Date()
        let read = try PreviewText.read(url)
        let text = read.text

        let html: String
        do {
            html = try renderer().html(text: text, name: url.lastPathComponent, cut: read.cut)
        } catch {
            // A preview that fails shows nothing, so the file is shown as the text it is. A file's
            // name is the person's, and stays out of the log: the log is read by whoever reads it.
            log.error("preview failed: \(String(describing: error), privacy: .private)")
            html = PreviewRenderer.fallbackPage(text: text, name: url.lastPathComponent)
        }
        log.notice("preview of \(read.bytes) bytes in \(Int(Date().timeIntervalSince(started) * 1000)) ms")

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
