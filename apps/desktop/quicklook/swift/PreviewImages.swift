// The local images of a preview (#344): the image files that a document links to, loaded from beside
// it for the page to show. The extension is sandboxed and may read one file, the document, so it has
// the read-only exception for files (RedlinesPreview.entitlements); everything that this file asks
// of the exception is here, so that what it may be used for is read in one place. It loads an image
// by the rule that the app serves them by (src-tauri/src/images.rs, src/images.ts): a file inside
// the document's project folder, no matter how the document wrote its path, that is no hidden
// file or folder's, whose name and first bytes both say it is an image the preview shows, and that
// no link leads out of the project to. It loads no more than a preview can hold, and reads nothing
// that the document didn't name. Shared by the extension and by the command line that tests it.

import Foundation

/// An image that a document links to, ready for the page: the name the page shows it by
/// (`cid:name`), the type it is sent as, and its bytes.
struct PreviewImage {
    let name: String
    let mimeType: String
    let data: Data
}

enum PreviewImages {
    /// The most images, and bytes of image, that a preview loads. The script asks about no more than
    /// 40 images (MAX_IMAGES in src/markdown.ts); the sizes keep a document from making the
    /// extension read more than Quick Look waits for.
    static let maxImages = 40
    static let maxImageBytes = 16 * 1024 * 1024
    static let maxTotalBytes = 48 * 1024 * 1024

    /// How far up a document's folders its project's root is looked for.
    private static let maxLevels = 24

    /// How much of a file is looked at to tell what it is: more than any image's signature, and the
    /// start of an SVG up to its root element.
    private static let headBytes = 8192

    // MARK: The project

    /// The folder of the project that the document at `document` is in, as it really is: the nearest
    /// folder at or above the document's that holds a `.git`, its repository, and otherwise the
    /// document's own folder (design, "One document per window").
    static func projectRoot(of document: URL) -> String {
        let folder = realPath(document.deletingLastPathComponent().path) ?? document.deletingLastPathComponent().path
        var candidate = folder
        for _ in 0..<maxLevels {
            if candidate.count > 1, FileManager.default.fileExists(atPath: candidate + "/.git") { return candidate }
            let parent = (candidate as NSString).deletingLastPathComponent
            if parent == candidate || parent.isEmpty { break }
            candidate = parent
        }
        return folder
    }

    /// `path` as it really is, every link in it followed, or nil if there is no such file.
    static func realPath(_ path: String) -> String? {
        guard let resolved = realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    // MARK: Loading

    /// An image that was loaded for one of the sources, as the document wrote it.
    struct Loaded {
        let source: String
        let image: PreviewImage
    }

    /// The images that the document at `document` links to, by the paths `sources` that it wrote, in
    /// order, as many as may be loaded. A source that may not be loaded, and one that isn't there, is
    /// left out: the page shows its alt text instead.
    static func load(_ sources: [String], from document: URL) -> [Loaded] {
        let root = projectRoot(of: document)
        let folder = realPath(document.deletingLastPathComponent().path) ?? document.deletingLastPathComponent().path
        var loaded: [Loaded] = []
        var total = 0
        for source in sources.prefix(maxImages) {
            guard let path = candidate(source, in: folder),
                  let real = realPath(path),
                  isInside(real, root: root),
                  let image = read(real, name: "img-\(loaded.count)", budget: maxTotalBytes - total)
            else { continue }
            total += image.data.count
            loaded.append(Loaded(source: source, image: image))
        }
        return loaded
    }

    /// The path that a document in `folder` means by `source`: a path from the folder, or an
    /// absolute one. Nothing that isn't a plain path.
    private static func candidate(_ source: String, in folder: String) -> String? {
        if source.isEmpty || source.contains("\0") { return nil }
        return source.hasPrefix("/") ? source : folder + "/" + source
    }

    /// Whether `real`, a path with no link in it, is a file inside the folder `root`, and no hidden
    /// file's or folder's: no name below the root starts with a dot.
    static func isInside(_ real: String, root: String) -> Bool {
        let prefix = root.hasSuffix("/") ? root : root + "/"
        guard real.hasPrefix(prefix), real.count > prefix.count else { return false }
        let below = real.dropFirst(prefix.count)
        return !below.split(separator: "/").contains { $0.hasPrefix(".") }
    }

    /// The image at `real`, if it is one the preview shows and there is room for it: a plain file, opened
    /// as the file that was looked at (never through a link put in its place since: `O_NOFOLLOW`),
    /// no larger than an image may be, whose name and first bytes both say what it is.
    private static func read(_ real: String, name: String, budget: Int) -> PreviewImage? {
        let descriptor = open(real, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        if descriptor < 0 { return nil }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var status = stat()
        guard fstat(descriptor, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG else { return nil }
        let size = Int(status.st_size)
        guard size > 0, size <= maxImageBytes, size <= budget else { return nil }
        guard let head = try? handle.read(upToCount: headBytes),
              let mime = mimeType(ofFileNamed: real, head: head)
        else { return nil }
        // The rest of the file, and a little more than an image may be, should it have grown since it
        // was looked at. A read that has nothing left to give is nil, not empty.
        let rest = (try? handle.read(upToCount: maxImageBytes + 1 - head.count)) ?? Data()
        var data = head
        data.append(rest)
        // Whatever the file has grown to since it was looked at.
        guard data.count <= maxImageBytes, data.count <= budget else { return nil }
        return PreviewImage(name: name, mimeType: mime, data: data)
    }

    // MARK: What is an image

    /// What an image is sent as: by the name of its file and the bytes that it starts with together.
    /// A raster image the preview shows, named as one and holding one; or an SVG, named as one and
    /// holding its markup. Nothing for anything else, whatever its name or its bytes. An SVG is shown
    /// in an `<img>`, where nothing in it runs and nothing it names is loaded, and the page's policy
    /// allows only `cid:`.
    static func mimeType(ofFileNamed path: String, head: Data) -> String? {
        let ext = (path as NSString).pathExtension.lowercased()
        let bytes = [UInt8](head.prefix(headBytes))
        func starts(_ prefix: [UInt8], at offset: Int = 0) -> Bool {
            bytes.count >= offset + prefix.count && Array(bytes[offset..<offset + prefix.count]) == prefix
        }
        func ascii(_ text: String, at offset: Int = 0) -> Bool { starts(Array(text.utf8), at: offset) }
        func brand(_ brands: [String]) -> Bool { ascii("ftyp", at: 4) && brands.contains { ascii($0, at: 8) } }
        switch ext {
        case "png", "apng":
            return starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) ? "image/png" : nil
        case "jpg", "jpeg":
            return starts([0xFF, 0xD8, 0xFF]) ? "image/jpeg" : nil
        case "gif":
            return ascii("GIF87a") || ascii("GIF89a") ? "image/gif" : nil
        case "webp":
            return ascii("RIFF") && ascii("WEBP", at: 8) ? "image/webp" : nil
        case "bmp":
            return ascii("BM") ? "image/bmp" : nil
        case "ico":
            return starts([0x00, 0x00, 0x01, 0x00]) ? "image/vnd.microsoft.icon" : nil
        case "tif", "tiff":
            return starts([0x49, 0x49, 0x2A, 0x00]) || starts([0x4D, 0x4D, 0x00, 0x2A]) ? "image/tiff" : nil
        case "avif":
            return brand(["avif", "avis"]) ? "image/avif" : nil
        case "heic", "heif":
            return brand(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]) ? "image/heif" : nil
        case "svg":
            return svgMarkup(bytes) ? "image/svg+xml" : nil
        default:
            return nil
        }
    }

    /// Whether the bytes a file starts with are an SVG document's: past a byte order mark, and an XML
    /// declaration, comments or a document type, its root element is `<svg>`. A filter, not a proof
    /// (a document type's subset can be built to fool it): what keeps an SVG inert is the `<img>` it
    /// is shown in.
    static func svgMarkup(_ head: [UInt8]) -> Bool {
        var rest = head[...]
        if rest.starts(with: [0xEF, 0xBB, 0xBF]) { rest = rest.dropFirst(3) }
        func trimmed(_ bytes: ArraySlice<UInt8>) -> ArraySlice<UInt8> {
            bytes.drop { [0x20, 0x09, 0x0D, 0x0A].contains($0) }
        }
        func past(_ bytes: ArraySlice<UInt8>, _ end: String) -> ArraySlice<UInt8>? {
            let pattern = Array(end.utf8)
            var index = bytes.startIndex
            while index + pattern.count <= bytes.endIndex {
                if Array(bytes[index..<index + pattern.count]) == pattern { return bytes[(index + pattern.count)...] }
                index += 1
            }
            return nil
        }
        while true {
            rest = trimmed(rest)
            if rest.starts(with: Array("<?".utf8)) {
                guard let after = past(rest.dropFirst(2), "?>") else { return false }
                rest = after
            } else if rest.starts(with: Array("<!--".utf8)) {
                guard let after = past(rest.dropFirst(4), "-->") else { return false }
                rest = after
            } else if rest.starts(with: Array("<!DOCTYPE".utf8)) {
                // An internal subset, in brackets, holds `>` of its own.
                var depth = 0
                var index = rest.startIndex + 9
                var end: Int?
                while index < rest.endIndex {
                    let byte = rest[index]
                    if byte == UInt8(ascii: "[") { depth += 1 } else if byte == UInt8(ascii: "]") { depth = max(0, depth - 1) } else if byte == UInt8(ascii: ">"), depth == 0 {
                        end = index
                        break
                    }
                    index += 1
                }
                guard let end else { return false }
                rest = rest[(end + 1)...]
            } else {
                guard rest.starts(with: Array("<svg".utf8)), let next = rest.dropFirst(4).first else { return false }
                return [0x20, 0x09, 0x0D, 0x0A, UInt8(ascii: "/"), UInt8(ascii: ">")].contains(next)
            }
        }
    }
}
