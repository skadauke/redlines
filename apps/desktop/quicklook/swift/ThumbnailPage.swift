// Draws the thumbnail of a Markdown file (#345): a page of the document in the Clean view, the first
// blocks of it, in the Default theme's fonts and colors. The blocks come from thumbnail.js
// (apps/desktop/quicklook/src/thumbnail.ts) as JSON; this draws them, and is shared by the Finder
// thumbnail extension and by the command line that tests it (harness/main.swift), so that what the
// tests draw is what Finder shows.

import AppKit
import CoreText
import Foundation

/// A block of the document, as thumbnail.js says it (src/thumbnail.ts).
struct ThumbnailBlock: Decodable, Equatable {
    var kind: String
    var level: Int?
    var text: String?
    var depth: Int?
    var marker: String?
    var rows: [[String]]?
}

/// The theme's fonts, from the files in the extension (Carlito for the text and Cousine for code,
/// design §6.6). A font that doesn't load is the system's: macOS reads the files as they are, WOFF2
/// included, on the Macs that were tried, and a Mac that doesn't draws the page all the same.
final class ThumbnailFonts {
    private let directory: URL?
    private var loaded: [String: NSFont] = [:]

    init(directory: URL?) {
        self.directory = directory
    }

    enum Face {
        case text, bold, mono
    }

    private static let files: [Face: String] = [
        .text: "carlito-latin-400-normal.woff2",
        .bold: "carlito-latin-700-normal.woff2",
        .mono: "cousine-latin-400-normal.woff2",
    ]

    func font(_ face: Face, size: CGFloat) -> NSFont {
        let key = "\(face)-\(size)"
        if let font = loaded[key] { return font }
        var font: NSFont?
        if let file = Self.files[face], let url = directory?.appendingPathComponent(file),
           let data = try? Data(contentsOf: url),
           let descriptor = CTFontManagerCreateFontDescriptorFromData(data as CFData) {
            // A Core Text font is an NSFont: the two are one object.
            font = unsafeBitCast(CTFontCreateWithFontDescriptor(descriptor, size, nil), to: NSFont.self)
        }
        let result = font ?? Self.system(face, size: size)
        loaded[key] = result
        return result
    }

    private static func system(_ face: Face, size: CGFloat) -> NSFont {
        switch face {
        case .text: return NSFont.systemFont(ofSize: size)
        case .bold: return NSFont.boldSystemFont(ofSize: size)
        case .mono: return NSFont.monospacedSystemFont(ofSize: size, weight: .regular)
        }
    }
}

enum ThumbnailPage {
    /// The most of a file that is read for a thumbnail, in bytes: a page holds a good deal less.
    static let maxBytes = 64 * 1024

    /// The page, in the points that the theme's sizes are in: its text column is the theme's, 680
    /// wide, and a thumbnail is this page made smaller.
    static let pageWidth: CGFloat = 780
    static let pageHeight: CGFloat = 1010
    private static let margin: CGFloat = 50
    private static let column: CGFloat = pageWidth - 2 * margin

    // The Default theme's colors in light (plugins/themes/src/tokens.css), which a thumbnail always
    // has: it is an image, kept for later, and no one can ask it for the Mac's appearance.
    private static let page = NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
    private static let ink = NSColor(srgbRed: 0x1d / 255, green: 0x1d / 255, blue: 0x1f / 255, alpha: 1)
    private static let ink2 = NSColor(srgbRed: 0x6e / 255, green: 0x6e / 255, blue: 0x73 / 255, alpha: 1)
    private static let ink3 = NSColor(srgbRed: 0xa1 / 255, green: 0xa1 / 255, blue: 0xa6 / 255, alpha: 1)
    private static let rule = NSColor(srgbRed: 0xe5 / 255, green: 0xe5 / 255, blue: 0xea / 255, alpha: 1)
    private static let tint = NSColor(srgbRed: 0xf3 / 255, green: 0xf3 / 255, blue: 0xf5 / 255, alpha: 1)

    /// The blocks in what thumbnail.js gave.
    static func blocks(from json: String) throws -> [ThumbnailBlock] {
        try JSONDecoder().decode([ThumbnailBlock].self, from: Data(json.utf8))
    }

    /// The size of the thumbnail within the size that Quick Look allows: a page, as high as it may be
    /// unless that is wider than it may be.
    static func contextSize(maximum: CGSize) -> CGSize {
        let aspect = pageWidth / pageHeight
        var height = maximum.height
        var width = (height * aspect).rounded()
        if width > maximum.width {
            width = maximum.width
            height = (width / aspect).rounded()
        }
        return CGSize(width: max(1, width), height: max(1, height))
    }

    // MARK: Drawing

    /// Draws the blocks as a page in the current graphics context, `size` points across, from its
    /// top: as many as it holds, and the last as far as it goes.
    static func draw(_ blocks: [ThumbnailBlock], size: CGSize, fonts: ThumbnailFonts) {
        guard let current = NSGraphicsContext.current else { return }
        let cg = current.cgContext
        let scale = size.width / pageWidth
        cg.saveGState()
        defer { cg.restoreGState() }
        cg.setFillColor(page.cgColor)
        cg.fill(CGRect(origin: .zero, size: size))
        // A hairline round the page, which a white page needs on Finder's white.
        cg.setStrokeColor(rule.cgColor)
        cg.setLineWidth(1)
        cg.stroke(CGRect(origin: .zero, size: size).insetBy(dx: 0.5, dy: 0.5))
        // From here the context is the page, in its own points, with the origin at the top left.
        cg.translateBy(x: 0, y: size.height)
        cg.scaleBy(x: scale, y: -scale)
        cg.clip(to: CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight))
        NSGraphicsContext.saveGraphicsState()
        defer { NSGraphicsContext.restoreGraphicsState() }
        NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)

        var y = margin + 8
        for (index, block) in blocks.enumerated() where y < pageHeight {
            y += space(before: block, after: index > 0 ? blocks[index - 1] : nil)
            y += drawBlock(block, at: y, in: cg, fonts: fonts)
        }
    }

    /// The space above a block, in points, from the theme's rhythm: a heading has more above it than
    /// a paragraph, and a list's items are closer than paragraphs are.
    private static func space(before block: ThumbnailBlock, after previous: ThumbnailBlock?) -> CGFloat {
        guard let previous else { return 0 }
        if block.kind == "heading" { return block.level == 1 ? 22 : 20 }
        if block.kind == "item", previous.kind == "item" { return 6 }
        return 16
    }

    private static func headingSize(_ level: Int?) -> CGFloat {
        switch level ?? 1 {
        case 1: return 34
        case 2: return 23
        case 3: return 19
        default: return 17.5
        }
    }

    private static func paragraphStyle(lineHeight: CGFloat, lineBreak: NSLineBreakMode = .byWordWrapping) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = lineHeight
        style.maximumLineHeight = lineHeight
        style.lineBreakMode = lineBreak
        return style
    }

    /// Draws `text` in a column starting at (`x`, `y`) `width` wide, and says how tall it is.
    @discardableResult
    private static func drawText(
        _ text: String, font: NSFont, color: NSColor, lineHeight: CGFloat,
        x: CGFloat, y: CGFloat, width: CGFloat, lineBreak: NSLineBreakMode = .byWordWrapping
    ) -> CGFloat {
        let string = NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraphStyle(lineHeight: lineHeight, lineBreak: lineBreak),
            ]
        )
        let bounds = CGRect(x: x, y: y, width: width, height: .greatestFiniteMagnitude)
        let height = ceil(string.boundingRect(with: bounds.size, options: [.usesLineFragmentOrigin]).height)
        string.draw(with: CGRect(x: x, y: y, width: width, height: height), options: [.usesLineFragmentOrigin])
        return height
    }

    /// Draws one block with its top at `y`, and says how tall it is.
    private static func drawBlock(_ block: ThumbnailBlock, at y: CGFloat, in cg: CGContext, fonts: ThumbnailFonts) -> CGFloat {
        let text = block.text ?? ""
        switch block.kind {
        case "heading":
            let size = headingSize(block.level)
            return drawText(text, font: fonts.font(.bold, size: size), color: ink, lineHeight: (size * 1.25).rounded(), x: margin, y: y, width: column)
        case "paragraph":
            return drawText(text, font: fonts.font(.text, size: 17.5), color: ink, lineHeight: 27, x: margin, y: y, width: column)
        case "item":
            let indent = CGFloat(block.depth ?? 0) * 26
            let marker = block.marker ?? "•"
            drawText(marker, font: fonts.font(.text, size: 17.5), color: ink2, lineHeight: 27, x: margin + indent, y: y, width: 26, lineBreak: .byClipping)
            return drawText(text, font: fonts.font(.text, size: 17.5), color: ink, lineHeight: 27, x: margin + indent + 26, y: y, width: column - indent - 26)
        case "quote":
            let height = drawText(text, font: fonts.font(.text, size: 17.5), color: ink2, lineHeight: 27, x: margin + 18, y: y, width: column - 18)
            cg.setFillColor(ink3.cgColor)
            cg.fill(CGRect(x: margin, y: y + 2, width: 3, height: max(0, height - 4)))
            return height
        case "code":
            let font = fonts.font(.mono, size: 14.5)
            let inset: CGFloat = 12
            let measured = NSAttributedString(string: text, attributes: [.font: font, .paragraphStyle: paragraphStyle(lineHeight: 21, lineBreak: .byClipping)])
            let height = ceil(measured.boundingRect(with: CGSize(width: column - 2 * inset, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin]).height) + 2 * inset
            let path = CGPath(roundedRect: CGRect(x: margin, y: y, width: column, height: height), cornerWidth: 6, cornerHeight: 6, transform: nil)
            cg.addPath(path)
            cg.setFillColor(tint.cgColor)
            cg.fillPath()
            drawText(text, font: font, color: ink, lineHeight: 21, x: margin + inset, y: y + inset, width: column - 2 * inset, lineBreak: .byClipping)
            return height
        case "rule":
            cg.setFillColor(rule.cgColor)
            cg.fill(CGRect(x: margin, y: y + 6, width: column, height: 2))
            return 14
        case "table":
            let rows = block.rows ?? []
            let columns = max(1, rows.map(\.count).max() ?? 1)
            let cell = column / CGFloat(columns)
            var top = y
            for (n, row) in rows.enumerated() {
                let rowFont = fonts.font(n == 0 ? .bold : .text, size: 16)
                for (c, value) in row.enumerated() {
                    drawText(value, font: rowFont, color: ink, lineHeight: 24, x: margin + CGFloat(c) * cell + 4, y: top + 5, width: cell - 12, lineBreak: .byTruncatingTail)
                }
                top += 34
                cg.setFillColor((n == 0 ? ink3 : rule).cgColor)
                cg.fill(CGRect(x: margin, y: top - 1, width: column, height: n == 0 ? 1.5 : 1))
            }
            return top - y
        default:
            return 0
        }
    }

    // MARK: Pictures

    /// A picture of the page `width` pixels across, for the command line that tests it.
    static func bitmap(_ blocks: [ThumbnailBlock], width: Int, fonts: ThumbnailFonts) -> NSBitmapImageRep? {
        let size = contextSize(maximum: CGSize(width: CGFloat(width), height: CGFloat(width) * pageHeight / pageWidth + 1))
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ), let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        draw(blocks, size: size, fonts: fonts)
        NSGraphicsContext.restoreGraphicsState()
        return rep
    }

    /// How much of a picture is not the page's own white, as a fraction: what is drawn on it.
    static func ink(of rep: NSBitmapImageRep) -> Double {
        guard let data = rep.bitmapData else { return 0 }
        var inked = 0
        let pixels = rep.pixelsWide * rep.pixelsHigh
        for pixel in 0..<pixels {
            let offset = pixel * 4
            if data[offset] < 250 || data[offset + 1] < 250 || data[offset + 2] < 250 { inked += 1 }
        }
        return Double(inked) / Double(max(1, pixels))
    }
}
