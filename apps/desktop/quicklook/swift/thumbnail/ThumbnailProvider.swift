// The Finder thumbnails of Markdown, R Markdown and Quarto files (#345): a thumbnail extension that
// draws the first blocks of the document in the Clean view, as the preview shows it (design §10).
// It reads the one file it is asked for, runs the script that is bundled in it (thumbnail.js, the
// format library and a scan of the blocks), draws them (ThumbnailPage.swift), and never calls the
// `redlines` program, the app or anything on the PATH. It is sandboxed and has no network.

import Foundation
import QuickLookThumbnailing
import os

private let log = Logger(subsystem: "md.redlines.editor.thumbnail", category: "thumbnail")

/// What the extension keeps from one thumbnail to the next: Finder asks for many, one after another.
private struct Loaded {
    let renderer: PreviewRenderer
    let fonts: ThumbnailFonts
}

private let loaded: Result<Loaded, Error> = Result {
    let bundle = Bundle(for: ThumbnailProvider.self)
    guard let script = bundle.url(forResource: "thumbnail", withExtension: "js") else {
        throw PreviewRenderer.Failure.missing("thumbnail.js is not in the extension")
    }
    let renderer = try PreviewRenderer(script: String(contentsOf: script, encoding: .utf8), function: "redlinesThumbnail")
    return Loaded(renderer: renderer, fonts: ThumbnailFonts(directory: bundle.resourceURL?.appendingPathComponent("fonts")))
}

@objc(RedlinesThumbnailProvider)
final class ThumbnailProvider: QLThumbnailProvider {
    /// A file with nothing to show in it has no thumbnail: Finder keeps its icon.
    private struct Empty: Error {}

    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        let started = Date()
        do {
            let read = try PreviewText.read(request.fileURL, maxBytes: ThumbnailPage.maxBytes)
            let have = try loaded.get()
            let blocks = try ThumbnailPage.blocks(from: have.renderer.string(text: read.text))
            if blocks.isEmpty { throw Empty() }
            let size = ThumbnailPage.contextSize(maximum: request.maximumSize)
            let reply = QLThumbnailReply(contextSize: size, currentContextDrawing: {
                ThumbnailPage.draw(blocks, size: size, fonts: have.fonts)
                return true
            })
            handler(reply, nil)
            log.notice("thumbnail of \(read.bytes) bytes, \(blocks.count) blocks, in \(Int(Date().timeIntervalSince(started) * 1000)) ms")
        } catch {
            // A file's name is the person's, and stays out of the log: the log is read by whoever reads it.
            log.error("no thumbnail: \(String(describing: error), privacy: .private)")
            handler(nil, error)
        }
    }
}
