#!/usr/bin/env xcrun swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

private let yellow = (red: 250, green: 204, blue: 21) // #FACC15
private let legacyMarkFloor = 40

private let scriptURL = URL(fileURLWithPath: #filePath).standardizedFileURL
private let macRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
private let resources = macRoot.appendingPathComponent("Resources", isDirectory: true)
private let sourceComposer = resources.appendingPathComponent("AppIcon.icon", isDirectory: true)
private let devComposer = resources.appendingPathComponent("AppIconDev.icon", isDirectory: true)
private let sourceLegacy = resources.appendingPathComponent(
    "Assets.xcassets/AppIcon.appiconset",
    isDirectory: true
)
private let devLegacy = resources.appendingPathComponent(
    "Assets.xcassets/AppIconDev.appiconset",
    isDirectory: true
)
private let legacySizes = [16, 32, 64, 128, 256, 512, 1024]

private enum GeneratorError: Error, CustomStringConvertible {
    case invalidImage(URL)
    case invalidDimensions(URL, expected: Int, actualWidth: Int, actualHeight: Int)
    case missingGlyph(URL)
    case unexpectedBrightPixels(URL, count: Int)
    case writeFailed(URL)

    var description: String {
        switch self {
        case let .invalidImage(url):
            return "Could not decode PNG: \(url.path)"
        case let .invalidDimensions(url, expected, width, height):
            return "Expected \(expected)x\(expected), got \(width)x\(height): \(url.path)"
        case let .missingGlyph(url):
            return "Could not find the neutral white bookmark glyph: \(url.path)"
        case let .unexpectedBrightPixels(url, count):
            return "Found \(count) neutral pixels outside the derived bookmark bounds: \(url.path)"
        case let .writeFailed(url):
            return "Could not encode PNG: \(url.path)"
        }
    }
}

private struct Pixel {
    let red: Int
    let green: Int
    let blue: Int
    let alpha: Int

    var minimum: Int { min(red, min(green, blue)) }
    var maximum: Int { max(red, max(green, blue)) }
    var isNeutral: Bool { maximum - minimum <= 8 }
}

private struct Bounds {
    var minX: Int
    var minY: Int
    var maxX: Int
    var maxY: Int

    func contains(x: Int, y: Int) -> Bool {
        x >= minX && x <= maxX && y >= minY && y <= maxY
    }
}

private func decodedPixel(_ bytes: UnsafeMutableBufferPointer<UInt8>, at offset: Int) -> Pixel {
    let alpha = Int(bytes[offset + 3])
    guard alpha > 0 else { return Pixel(red: 0, green: 0, blue: 0, alpha: 0) }

    func unpremultiply(_ value: UInt8) -> Int {
        min(255, (Int(value) * 255 + alpha / 2) / alpha)
    }

    return Pixel(
        red: unpremultiply(bytes[offset]),
        green: unpremultiply(bytes[offset + 1]),
        blue: unpremultiply(bytes[offset + 2]),
        alpha: alpha
    )
}

private func setPixel(
    _ bytes: UnsafeMutableBufferPointer<UInt8>,
    at offset: Int,
    red: Int,
    green: Int,
    blue: Int,
    alpha: Int
) {
    func premultiply(_ value: Int) -> UInt8 {
        UInt8(clamping: (value * alpha + 127) / 255)
    }

    bytes[offset] = premultiply(red)
    bytes[offset + 1] = premultiply(green)
    bytes[offset + 2] = premultiply(blue)
    bytes[offset + 3] = UInt8(alpha)
}

private func writePNG(
    source: URL,
    destination: URL,
    expectedSize: Int,
    transform: (UnsafeMutableBufferPointer<UInt8>, Int, Int) throws -> String
) throws -> String {
    guard
        let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
    else {
        throw GeneratorError.invalidImage(source)
    }

    guard image.width == expectedSize, image.height == expectedSize else {
        throw GeneratorError.invalidDimensions(
            source,
            expected: expectedSize,
            actualWidth: image.width,
            actualHeight: image.height
        )
    }

    let bytesPerRow = image.width * 4
    let byteCount = bytesPerRow * image.height
    let storage = UnsafeMutablePointer<UInt8>.allocate(capacity: byteCount)
    storage.initialize(repeating: 0, count: byteCount)
    defer {
        storage.deinitialize(count: byteCount)
        storage.deallocate()
    }

    let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
        | CGImageAlphaInfo.premultipliedLast.rawValue
    guard let context = CGContext(
        data: storage,
        width: image.width,
        height: image.height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: bitmapInfo
    ) else {
        throw GeneratorError.invalidImage(source)
    }

    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let pixels = UnsafeMutableBufferPointer(start: storage, count: byteCount)
    let result = try transform(pixels, image.width, image.height)

    guard let outputImage = context.makeImage() else {
        throw GeneratorError.writeFailed(destination)
    }
    guard let destinationWriter = CGImageDestinationCreateWithURL(
        destination as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        throw GeneratorError.writeFailed(destination)
    }
    CGImageDestinationAddImage(destinationWriter, outputImage, nil)
    guard CGImageDestinationFinalize(destinationWriter) else {
        throw GeneratorError.writeFailed(destination)
    }
    return result
}

private func recolorComposerGlyph(
    source: URL,
    destination: URL
) throws -> String {
    try writePNG(source: source, destination: destination, expectedSize: 1024) { bytes, width, height in
        var changed = 0
        var alphaBefore = [UInt8]()
        alphaBefore.reserveCapacity(width * height)

        for offset in stride(from: 0, to: bytes.count, by: 4) {
            let pixel = decodedPixel(bytes, at: offset)
            alphaBefore.append(UInt8(pixel.alpha))
            guard pixel.alpha > 0 else { continue }
            setPixel(
                bytes,
                at: offset,
                red: yellow.red,
                green: yellow.green,
                blue: yellow.blue,
                alpha: pixel.alpha
            )
            changed += 1
        }

        for (index, alpha) in alphaBefore.enumerated() {
            precondition(bytes[index * 4 + 3] == alpha, "Composer glyph alpha changed")
        }
        return "\(width)x\(height), recolored \(changed) nontransparent glyph pixels"
    }
}

private func recolorLegacyIcon(
    source: URL,
    destination: URL,
    size: Int
) throws -> String {
    try writePNG(source: source, destination: destination, expectedSize: size) { bytes, width, height in
        let original = Array(bytes)
        var bounds = Bounds(minX: width, minY: height, maxX: -1, maxY: -1)

        // Bright, neutral pixels are an unambiguous seed for the white bookmark.
        // Deriving the bounds from the source keeps every generated size aligned
        // with the hand-tuned production artwork.
        for y in 0..<height {
            for x in 0..<width {
                let offset = y * width * 4 + x * 4
                let pixel = decodedPixel(bytes, at: offset)
                guard pixel.alpha >= 250, pixel.isNeutral, pixel.minimum >= 180 else { continue }
                bounds.minX = min(bounds.minX, x)
                bounds.minY = min(bounds.minY, y)
                bounds.maxX = max(bounds.maxX, x)
                bounds.maxY = max(bounds.maxY, y)
            }
        }
        guard bounds.maxX >= bounds.minX, bounds.maxY >= bounds.minY else {
            throw GeneratorError.missingGlyph(source)
        }

        // Two source pixels cover the antialias fringe even in the smallest
        // committed icon; larger sources need no wider expansion.
        let fringe = 2
        bounds.minX = max(0, bounds.minX - fringe)
        bounds.minY = max(0, bounds.minY - fringe)
        bounds.maxX = min(width - 1, bounds.maxX + fringe)
        bounds.maxY = min(height - 1, bounds.maxY + fringe)

        var changed = 0
        var unexpectedBright = 0
        for y in 0..<height {
            for x in 0..<width {
                let offset = y * width * 4 + x * 4
                let pixel = decodedPixel(bytes, at: offset)
                let isMarkPixel = pixel.alpha >= 250
                    && pixel.isNeutral
                    && pixel.minimum >= legacyMarkFloor

                if isMarkPixel && !bounds.contains(x: x, y: y) {
                    unexpectedBright += 1
                    continue
                }
                guard isMarkPixel else { continue }

                // Preserve the source antialias intensity while changing only hue.
                // The core white (#FAFAFA) becomes exactly #FACC15; dim edge pixels
                // remain proportionally dim. Alpha, dark plate, and shadow stay byte-identical.
                let sourceIntensity = min(250, (pixel.red + pixel.green + pixel.blue) / 3)
                setPixel(
                    bytes,
                    at: offset,
                    red: yellow.red * sourceIntensity / 250,
                    green: yellow.green * sourceIntensity / 250,
                    blue: yellow.blue * sourceIntensity / 250,
                    alpha: pixel.alpha
                )
                changed += 1
            }
        }
        guard unexpectedBright == 0 else {
            throw GeneratorError.unexpectedBrightPixels(source, count: unexpectedBright)
        }

        var untouchedBytes = 0
        for offset in stride(from: 0, to: bytes.count, by: 4) {
            precondition(bytes[offset + 3] == original[offset + 3], "Legacy icon alpha changed")
            if bytes[offset] == original[offset]
                && bytes[offset + 1] == original[offset + 1]
                && bytes[offset + 2] == original[offset + 2]
            {
                untouchedBytes += 3
            }
        }
        precondition(changed > 0, "No legacy glyph pixels changed")
        return "\(width)x\(height), recolored \(changed) glyph pixels; \(untouchedBytes) RGB bytes unchanged"
    }
}

private func copyVerbatim(_ source: URL, to destination: URL) throws {
    try Data(contentsOf: source).write(to: destination, options: .atomic)
}

do {
    let fileManager = FileManager.default
    try fileManager.createDirectory(
        at: devComposer.appendingPathComponent("Assets", isDirectory: true),
        withIntermediateDirectories: true
    )
    try fileManager.createDirectory(at: devLegacy, withIntermediateDirectories: true)

    try copyVerbatim(
        sourceComposer.appendingPathComponent("icon.json"),
        to: devComposer.appendingPathComponent("icon.json")
    )
    let composerResult = try recolorComposerGlyph(
        source: sourceComposer.appendingPathComponent("Assets/bookmark-glyph.png"),
        destination: devComposer.appendingPathComponent("Assets/bookmark-glyph.png")
    )
    print("AppIconDev.icon: \(composerResult)")

    try copyVerbatim(
        sourceLegacy.appendingPathComponent("Contents.json"),
        to: devLegacy.appendingPathComponent("Contents.json")
    )
    for size in legacySizes {
        let filename = "icon_\(size).png"
        let result = try recolorLegacyIcon(
            source: sourceLegacy.appendingPathComponent(filename),
            destination: devLegacy.appendingPathComponent(filename),
            size: size
        )
        print("AppIconDev.appiconset/\(filename): \(result)")
    }
} catch {
    fputs("generate-dev-app-icon: \(error)\n", stderr)
    exit(1)
}
