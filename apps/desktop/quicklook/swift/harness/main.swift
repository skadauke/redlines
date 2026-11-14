// A command line that runs the renderer the way the Quick Look extension does, in the system's
// JavaScriptCore, for the checks of scripts/build-quicklook and for timing it by hand.
//
//     preview-render <preview.js> <file> [--name NAME] [--cut] [--max-bytes N] [--repeat N]
//     preview-render --fallback <file>
//     preview-render --dynamic-type <extension>
//     preview-render --thumbnail <thumbnail.js> <fonts folder or -> <file> <out.png> [--width N]
//     preview-render --blocks <thumbnail.js> <file>
//
// The first prints the page on standard output and says on standard error how long it took. The
// second prints the page that the extension shows when the renderer fails. The third prints the type
// that this Mac gives files with that extension, which is how the extension's dynamic types are
// checked (scripts/build-quicklook). The fourth draws the thumbnail that the Finder extension draws,
// as a PNG N pixels across (512 by default), and says on standard output what it drew: the blocks
// of the page, and how much of the picture is not blank.

import AppKit
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

if arguments.first == "--blocks" {
    guard arguments.count == 3 else { fail("usage: preview-render --blocks <thumbnail.js> <file>") }
    do {
        let script = try String(contentsOfFile: arguments[1], encoding: .utf8)
        let read = try PreviewText.read(URL(fileURLWithPath: arguments[2]), maxBytes: ThumbnailPage.maxBytes)
        let renderer = try PreviewRenderer(script: script, function: "redlinesThumbnail")
        FileHandle.standardOutput.write(Data(try renderer.string(text: read.text).utf8))
        exit(0)
    } catch { fail("\(error)") }
}

if arguments.first == "--thumbnail" {
    var rest = Array(arguments.dropFirst())
    var width = 512
    if let at = rest.firstIndex(of: "--width"), at + 1 < rest.count, let n = Int(rest[at + 1]), n > 0 {
        width = n
        rest.removeSubrange(at...at + 1)
    }
    guard rest.count == 4 else { fail("usage: preview-render --thumbnail <thumbnail.js> <fonts folder or -> <file> <out.png> [--width N]") }
    do {
        let script = try String(contentsOfFile: rest[0], encoding: .utf8)
        let fonts = ThumbnailFonts(directory: rest[1] == "-" ? nil : URL(fileURLWithPath: rest[1]))
        let read = try PreviewText.read(URL(fileURLWithPath: rest[2]), maxBytes: ThumbnailPage.maxBytes)
        let started = Date()
        let renderer = try PreviewRenderer(script: script, function: "redlinesThumbnail")
        let json = try renderer.string(text: read.text)
        let blocks = try ThumbnailPage.blocks(from: json)
        guard let rep = ThumbnailPage.bitmap(blocks, width: width, fonts: fonts),
              let png = rep.representation(using: .png, properties: [:]) else { fail("no picture") }
        try png.write(to: URL(fileURLWithPath: rest[3]))
        let kinds = blocks.map(\.kind).joined(separator: ",")
        let ms = Int(Date().timeIntervalSince(started) * 1000)
        print("thumbnail \(rep.pixelsWide)x\(rep.pixelsHigh), \(blocks.count) blocks (\(kinds)), ink \(String(format: "%.3f", ThumbnailPage.ink(of: rep))), in \(ms) ms")
        exit(0)
    } catch { fail("\(error)") }
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
