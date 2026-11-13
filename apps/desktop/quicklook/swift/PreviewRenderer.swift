// Runs the renderer (preview.js, bundled from ../src) in JavaScriptCore. Shared by the Quick Look
// extension and by the command line that tests it, so that what the tests run is what Quick Look
// runs: the system's JavaScriptCore, with no Node and no browser around it.

import Foundation
import JavaScriptCore

struct PreviewRenderer {
    enum Failure: Error, CustomStringConvertible {
        case script(String)
        case missing(String)

        var description: String {
            switch self {
            case .script(let message): return "The renderer failed: \(message)"
            case .missing(let message): return "The renderer is incomplete: \(message)"
            }
        }
    }

    private let context: JSContext
    private let render: JSValue
    private let thrown = Thrown()

    /// What the context's exception handler last heard.
    private final class Thrown {
        var message: String?
    }

    /// The renderer in `script`, the text of preview.js, which defines `redlinesPreview`.
    init(script: String) throws {
        guard let context = JSContext() else { throw Failure.missing("no JavaScript context") }
        let thrown = self.thrown
        context.exceptionHandler = { _, exception in
            thrown.message = exception?.toString() ?? "an exception without a message"
        }
        context.evaluateScript(script)
        if let message = thrown.message { throw Failure.script(message) }
        guard let render = context.objectForKeyedSubscript("redlinesPreview"), !render.isUndefined else {
            throw Failure.missing("the script defines no redlinesPreview")
        }
        self.context = context
        self.render = render
    }

    /// The page for a file. `cut` says that `text` is only the start of a longer file.
    func html(text: String, name: String, cut: Bool) throws -> String {
        thrown.message = nil
        let result = render.call(withArguments: [text, name, cut])
        if let message = thrown.message { throw Failure.script(message) }
        guard let result, result.isString, let html = result.toString() else {
            throw Failure.script("redlinesPreview gave no page")
        }
        return html
    }

    /// A page of the file's text, as itself, for when the renderer fails: a preview that shows
    /// nothing is worse than the text, which is what Quick Look would have shown without Redlines.
    static func fallbackPage(text: String, name: String) -> String {
        func escape(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
        }
        return """
            <!doctype html><html><head><meta charset="utf-8">\
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">\
            <meta name="color-scheme" content="light dark"><title>\(escape(name))</title>\
            <style>body{margin:24px;font:13px ui-monospace,Menlo,monospace;white-space:pre-wrap}</style></head>\
            <body>\(escape(text))</body></html>
            """
    }
}
