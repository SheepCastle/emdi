import AppKit
import CoreGraphics

let outputDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
let fm = FileManager.default
try? fm.removeItem(atPath: outputDir)
try fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

func renderIcon(size: Int) -> Data {
    let s = CGFloat(size)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!

    ctx.setAllowsAntialiasing(true)
    ctx.setShouldAntialias(true)

    // macOS icon padding & squircle-like rounded rect
    let inset = s * 0.08
    let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let radius = rect.width * 0.225
    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()

    // Background gradient (Ghostty Dracula dark slate)
    let bgColors = [
        CGColor(srgbRed: 0.165, green: 0.176, blue: 0.235, alpha: 1.0),
        CGColor(srgbRed: 0.098, green: 0.106, blue: 0.145, alpha: 1.0)
    ] as CFArray
    let bgGrad = CGGradient(colorsSpace: colorSpace, colors: bgColors, locations: [0.0, 1.0])!
    ctx.drawLinearGradient(
        bgGrad,
        start: CGPoint(x: s * 0.2, y: s * 0.95),
        end: CGPoint(x: s * 0.8, y: s * 0.05),
        options: []
    )

    // Subtle lavender radial glow top-center
    let glowColors = [
        CGColor(srgbRed: 0.768, green: 0.710, blue: 0.992, alpha: 0.20),
        CGColor(srgbRed: 0.768, green: 0.710, blue: 0.992, alpha: 0.0)
    ] as CFArray
    let glowGrad = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: [0.0, 1.0])!
    ctx.drawRadialGradient(
        glowGrad,
        startCenter: CGPoint(x: s * 0.5, y: s * 0.76),
        startRadius: 0,
        endCenter: CGPoint(x: s * 0.5, y: s * 0.76),
        endRadius: s * 0.48,
        options: []
    )
    ctx.restoreGState()

    // Subtle border
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(srgbRed: 0.768, green: 0.710, blue: 0.992, alpha: 0.30))
    ctx.setLineWidth(max(1.5, s * 0.014))
    ctx.strokePath()

    // Draw stylized "M" in lavender gradient
    let mPath = CGMutablePath()
    let left = s * 0.28
    let right = s * 0.72
    let bottom = s * 0.34
    let top = s * 0.68
    let midX = s * 0.50
    let midY = s * 0.48

    mPath.move(to: CGPoint(x: left, y: bottom))
    mPath.addLine(to: CGPoint(x: left, y: top))
    mPath.addLine(to: CGPoint(x: midX, y: midY))
    mPath.addLine(to: CGPoint(x: right, y: top))
    mPath.addLine(to: CGPoint(x: right, y: bottom))

    ctx.saveGState()
    ctx.addPath(mPath)
    ctx.setLineWidth(s * 0.072)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.replacePathWithStrokedPath()
    ctx.clip()

    let fgColors = [
        CGColor(srgbRed: 0.929, green: 0.914, blue: 0.996, alpha: 1.0),
        CGColor(srgbRed: 0.768, green: 0.710, blue: 0.992, alpha: 1.0),
        CGColor(srgbRed: 0.655, green: 0.545, blue: 0.980, alpha: 1.0)
    ] as CFArray
    let fgGrad = CGGradient(colorsSpace: colorSpace, colors: fgColors, locations: [0.0, 0.55, 1.0])!
    ctx.drawLinearGradient(
        fgGrad,
        start: CGPoint(x: s * 0.5, y: top + s * 0.05),
        end: CGPoint(x: s * 0.5, y: bottom - s * 0.05),
        options: []
    )
    ctx.restoreGState()

    // Accent bar underneath
    let barW = s * 0.28
    let barH = s * 0.036
    let barRect = CGRect(x: (s - barW) / 2, y: s * 0.215, width: barW, height: barH)
    let barPath = CGPath(roundedRect: barRect, cornerWidth: barH / 2, cornerHeight: barH / 2, transform: nil)
    ctx.addPath(barPath)
    ctx.setFillColor(CGColor(srgbRed: 0.768, green: 0.710, blue: 0.992, alpha: 0.82))
    ctx.fillPath()

    let cgImage = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: cgImage)
    return rep.representation(using: .png, properties: [:])!
}

let specs: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (name, px) in specs {
    let data = renderIcon(size: px)
    try data.write(to: URL(fileURLWithPath: "\(outputDir)/\(name)"))
}
print("Generated iconset at \(outputDir)")
