// A command line that runs the renderer the way the Quick Look extension does, in the system's
// JavaScriptCore, for the checks of scripts/build-quicklook and for timing it by hand.
//
//     preview-render <preview.js> <file> [--name NAME] [--cut] [--max-bytes N] [--repeat N]
//     preview-render --fallback <file>
//     preview-render --dynamic-type <extension>
//
// The first prints the page on standard output and says on standard error how long it took. The
// second prints the page that the extension shows when the renderer fails. The third prints the type
// that this Mac gives files with that extension, which is how the extension's dynamic types are
// checked (scripts/build-quicklook).

import Foundation
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("preview-render: \(message)\n".utf8))
    exit(1)
}

var arguments = Array(CommandLine.arguments.dropFirst())

if arguments.first == "--dynamic-type" {
    guard arguments.count == 2 else { fail("usage: preview-render --dynamic-type <extension>") }
    print(UTType(filenameExtension: arguments[1])?.identifier ?? "none")
    exit(0)
}

if arguments.first == "--fallback" {
    guard arguments.count == 2, let data = FileManager.default.contents(atPath: arguments[1]) else {
        fail("usage: preview-render --fallback <file>")
    }
    let page = PreviewRenderer.fallbackPage(text: String(decoding: data, as: UTF8.self), name: URL(fileURLWithPath: arguments[1]).lastPathComponent)
    FileHandle.standardOutput.write(Data(page.utf8))
    exit(0)
}

var name: String?
var cut = false
var maxBytes = PreviewText.maxBytes
var repeats = 1
var positional: [String] = []
while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--cut": cut = true
    case "--name":
        guard let value = arguments.first else { fail("--name needs a value") }
        name = value
        arguments.removeFirst()
    case "--max-bytes":
        guard let value = arguments.first, let n = Int(value), n > 0 else { fail("--max-bytes needs a number") }
        maxBytes = n
        arguments.removeFirst()
    case "--repeat":
        guard let value = arguments.first, let n = Int(value), n > 0 else { fail("--repeat needs a number") }
        repeats = n
        arguments.removeFirst()
    default: positional.append(argument)
    }
}
guard positional.count == 2 else { fail("usage: preview-render <preview.js> <file> [--name NAME] [--cut] [--max-bytes N] [--repeat N]") }

let script: String
let read: PreviewText
do {
    script = try String(contentsOfFile: positional[0], encoding: .utf8)
    read = try PreviewText.read(URL(fileURLWithPath: positional[1]), maxBytes: maxBytes)
} catch { fail("\(error)") }
let text = read.text

do {
    let loaded = Date()
    let renderer = try PreviewRenderer(script: script)
    let loadMs = Date().timeIntervalSince(loaded) * 1000
    var html = ""
    var times: [Double] = []
    for _ in 0..<repeats {
        let started = Date()
        html = try renderer.html(text: text, name: name ?? URL(fileURLWithPath: positional[1]).lastPathComponent, cut: cut || read.cut)
        times.append(Date().timeIntervalSince(started) * 1000)
    }
    FileHandle.standardOutput.write(Data(html.utf8))
    let first = times.first ?? 0
    let best = times.min() ?? 0
    let summary = "preview-render: \(text.count) chars\(read.cut ? " (the start of a longer file)" : ""), loaded in \(Int(loadMs)) ms, rendered in \(Int(first)) ms (best of \(repeats): \(Int(best)) ms), \(html.count) chars of HTML\n"
    FileHandle.standardError.write(Data(summary.utf8))
} catch { fail("\(error)") }
