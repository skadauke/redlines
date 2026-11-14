// The Quick Look preview of Markdown, R Markdown and Quarto files (#316): a data-based preview that
// answers with a page of HTML, which Quick Look draws. The extension reads the one file it is asked
// to preview, runs the renderer that is bundled in it (PreviewRenderer.swift, preview.js), and never
// calls the `redlines` program, the app or anything on the PATH. It is sandboxed, has no network
// entitlement, and the page it sends carries no script. A document's local images are loaded from
// beside it (PreviewImages.swift) and sent as attachments of the reply, which the page names by
// `cid:`; an image from a server is never loaded.

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
        var images: [PreviewImages.Loaded] = []
        do {
            let renderer = try renderer()
            // A document that links to no image (the usual) is drawn at once; one that does is asked
            // for its images, and drawn with those that were loaded.
            if text.contains("![") {
                images = PreviewImages.load(try renderer.imageSources(text: text, cut: read.cut), from: url)
            }
            let names = Dictionary(images.map { ($0.source, $0.image.name) }, uniquingKeysWith: { first, _ in first })
            html = try renderer.html(text: text, name: url.lastPathComponent, cut: read.cut, images: names)
        } catch {
            // A preview that fails shows nothing, so the file is shown as the text it is. A file's
            // name is the person's, and stays out of the log: the log is read by whoever reads it.
            log.error("preview failed: \(String(describing: error), privacy: .private)")
            html = PreviewRenderer.fallbackPage(text: text, name: url.lastPathComponent)
            images = []
        }
        let imageBytes = images.reduce(0) { $0 + $1.image.data.count }
        log.notice("preview of \(read.bytes) bytes, \(images.count) images (\(imageBytes) bytes), in \(Int(Date().timeIntervalSince(started) * 1000)) ms")

        let reply = QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 800, height: 960)) { reply in
            reply.stringEncoding = .utf8
            return Data(html.utf8)
        }
        for loaded in images {
            let type = UTType(mimeType: loaded.image.mimeType) ?? .data
            reply.attachments[loaded.image.name] = QLPreviewReplyAttachment(data: loaded.image.data, contentType: type)
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
