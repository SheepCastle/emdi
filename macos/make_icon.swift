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
    ctx.interpolationQuality = .high

    // 1) macOS squircle-like rounded rect with subtle drop shadow
    let inset = s * 0.085
    let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let radius = rect.width * 0.228
    let basePath = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)

    // Outer ambient shadow (macOS icon standard)
    ctx.saveGState()
    ctx.setShadow(
        offset: CGSize(width: 0, height: -s * 0.018),
        blur: s * 0.036,
        color: CGColor(srgbRed: 0.02, green: 0.02, blue: 0.06, alpha: 0.48)
    )
    ctx.addPath(basePath)
    ctx.setFillColor(CGColor(srgbRed: 0.09, green: 0.10, blue: 0.15, alpha: 1.0))
    ctx.fillPath()
    ctx.restoreGState()

    // 2) Clipped dark glass canvas (Catppuccin / Deep Indigo Night)
    ctx.saveGState()
    ctx.addPath(basePath)
    ctx.clip()

    let bgColors = [
        CGColor(srgbRed: 0.145, green: 0.153, blue: 0.235, alpha: 1.0),
        CGColor(srgbRed: 0.094, green: 0.098, blue: 0.157, alpha: 1.0),
        CGColor(srgbRed: 0.067, green: 0.071, blue: 0.118, alpha: 1.0)
    ] as CFArray
    let bgGrad = CGGradient(colorsSpace: colorSpace, colors: bgColors, locations: [0.0, 0.55, 1.0])!
    ctx.drawLinearGradient(
        bgGrad,
        start: CGPoint(x: s * 0.15, y: s * 0.94),
        end: CGPoint(x: s * 0.85, y: s * 0.06),
        options: []
    )

    // Soft top-left lavender ambient bloom
    let topBloom = CGGradient(
        colorsSpace: colorSpace,
        colors: [
            CGColor(srgbRed: 0.796, green: 0.651, blue: 0.969, alpha: 0.22),
            CGColor(srgbRed: 0.796, green: 0.651, blue: 0.969, alpha: 0.0)
        ] as CFArray,
        locations: [0.0, 1.0]
    )!
    ctx.drawRadialGradient(
        topBloom,
        startCenter: CGPoint(x: s * 0.30, y: s * 0.82),
        startRadius: 0,
        endCenter: CGPoint(x: s * 0.30, y: s * 0.82),
        endRadius: s * 0.56,
        options: []
    )

    // Soft bottom-right sky-blue ambient bloom
    let botBloom = CGGradient(
        colorsSpace: colorSpace,
        colors: [
            CGColor(srgbRed: 0.537, green: 0.706, blue: 0.980, alpha: 0.16),
            CGColor(srgbRed: 0.537, green: 0.706, blue: 0.980, alpha: 0.0)
        ] as CFArray,
        locations: [0.0, 1.0]
    )!
    ctx.drawRadialGradient(
        botBloom,
        startCenter: CGPoint(x: s * 0.78, y: s * 0.20),
        startRadius: 0,
        endCenter: CGPoint(x: s * 0.78, y: s * 0.20),
        endRadius: s * 0.48,
        options: []
    )

    // Subtle top specular rim highlight inside the squircle
    let rimRect = rect.insetBy(dx: s * 0.006, dy: s * 0.006)
    let rimPath = CGPath(roundedRect: rimRect, cornerWidth: radius - s * 0.005, cornerHeight: radius - s * 0.005, transform: nil)
    ctx.addPath(rimPath)
    ctx.setStrokeColor(CGColor(srgbRed: 1.0, green: 1.0, blue: 1.0, alpha: 0.14))
    ctx.setLineWidth(max(1.0, s * 0.012))
    ctx.strokePath()

    // 3) Origami Ribbon "M" Monogram (3 layered geometric folds)
    // Coordinates in standard CG space (origin bottom-left)
    let xL = s * 0.235
    let xR = s * 0.765
    let yB = s * 0.275
    let yT = s * 0.735
    let w  = s * 0.118  // ribbon stroke thickness
    let xM = s * 0.500
    let yV = s * 0.425  // inner V vertex bottom

    // Helper: fill path with linear gradient + optional shadow
    func drawFold(path: CGPath, colors: [CGColor], start: CGPoint, end: CGPoint, shadow: Bool = false) {
        ctx.saveGState()
        if shadow {
            ctx.setShadow(
                offset: CGSize(width: 0, height: -s * 0.018),
                blur: s * 0.042,
                color: CGColor(srgbRed: 0.02, green: 0.02, blue: 0.07, alpha: 0.55)
            )
            ctx.addPath(path)
            ctx.setFillColor(colors[0])
            ctx.fillPath()
        }
        ctx.restoreGState()

        ctx.saveGState()
        ctx.addPath(path)
        ctx.clip()
        let grad = CGGradient(colorsSpace: colorSpace, colors: colors as CFArray, locations: [0.0, 1.0])!
        ctx.drawLinearGradient(grad, start: start, end: end, options: [])
        ctx.restoreGState()
    }

    // Fold A: Left vertical pillar (cool pearl-white)
    let leftPillar = CGMutablePath()
    leftPillar.addRoundedRect(
        in: CGRect(x: xL, y: yB, width: w, height: yT - yB),
        cornerWidth: w * 0.28,
        cornerHeight: w * 0.28
    )
    drawFold(
        path: leftPillar,
        colors: [
            CGColor(srgbRed: 0.945, green: 0.955, blue: 1.000, alpha: 1.0),
            CGColor(srgbRed: 0.760, green: 0.790, blue: 0.910, alpha: 1.0)
        ],
        start: CGPoint(x: xL, y: yT),
        end: CGPoint(x: xL + w, y: yB),
        shadow: true
    )

    // Fold B: Right vertical pillar (deep sky-indigo)
    let rightPillar = CGMutablePath()
    rightPillar.addRoundedRect(
        in: CGRect(x: xR - w, y: yB, width: w, height: yT - yB),
        cornerWidth: w * 0.28,
        cornerHeight: w * 0.28
    )
    drawFold(
        path: rightPillar,
        colors: [
            CGColor(srgbRed: 0.590, green: 0.750, blue: 0.990, alpha: 1.0),
            CGColor(srgbRed: 0.435, green: 0.560, blue: 0.940, alpha: 1.0)
        ],
        start: CGPoint(x: xR - w, y: yT),
        end: CGPoint(x: xR, y: yB),
        shadow: true
    )

    // Fold C: Right diagonal ribbon (from top-right down to center V)
    let rightDiag = CGMutablePath()
    let dTopRightOuter = CGPoint(x: xR - w * 0.16, y: yT - w * 0.02)
    let dTopRightInner = CGPoint(x: xR - w * 0.88, y: yT - w * 0.02)
    let dMidBottom = CGPoint(x: xM, y: yV)
    let dMidTop = CGPoint(x: xM, y: yV + w * 1.16)
    rightDiag.move(to: dTopRightInner)
    rightDiag.addLine(to: dTopRightOuter)
    rightDiag.addLine(to: dMidBottom)
    rightDiag.addLine(to: dMidTop)
    rightDiag.closeSubpath()

    drawFold(
        path: rightDiag,
        colors: [
            CGColor(srgbRed: 0.537, green: 0.706, blue: 0.980, alpha: 1.0),
            CGColor(srgbRed: 0.710, green: 0.580, blue: 0.965, alpha: 1.0)
        ],
        start: CGPoint(x: xR, y: yT),
        end: CGPoint(x: xM, y: yV),
        shadow: true
    )

    // Fold D: Left diagonal ribbon (overlaps right diagonal at the V for true origami depth)
    let leftDiag = CGMutablePath()
    let dTopLeftOuter = CGPoint(x: xL + w * 0.16, y: yT - w * 0.02)
    let dTopLeftInner = CGPoint(x: xL + w * 0.88, y: yT - w * 0.02)
    leftDiag.move(to: dTopLeftOuter)
    leftDiag.addLine(to: dTopLeftInner)
    leftDiag.addLine(to: dMidTop)
    leftDiag.addLine(to: dMidBottom)
    leftDiag.closeSubpath()

    drawFold(
        path: leftDiag,
        colors: [
            CGColor(srgbRed: 0.965, green: 0.955, blue: 1.000, alpha: 1.0),
            CGColor(srgbRed: 0.796, green: 0.651, blue: 0.969, alpha: 1.0)
        ],
        start: CGPoint(x: xL, y: yT),
        end: CGPoint(x: xM, y: yV),
        shadow: true
    )

    // 4) Minimal Markdown down-caret / cursor diamond beneath the V
    let gemSize = s * 0.048
    let gemCY = s * 0.295
    let gem = CGMutablePath()
    gem.move(to: CGPoint(x: xM, y: gemCY + gemSize))
    gem.addLine(to: CGPoint(x: xM + gemSize, y: gemCY))
    gem.addLine(to: CGPoint(x: xM, y: gemCY - gemSize))
    gem.addLine(to: CGPoint(x: xM - gemSize, y: gemCY))
    gem.closeSubpath()

    drawFold(
        path: gem,
        colors: [
            CGColor(srgbRed: 0.976, green: 0.886, blue: 0.686, alpha: 1.0),
            CGColor(srgbRed: 0.796, green: 0.651, blue: 0.969, alpha: 1.0)
        ],
        start: CGPoint(x: xM, y: gemCY + gemSize),
        end: CGPoint(x: xM, y: gemCY - gemSize),
        shadow: true
    )

    ctx.restoreGState()

    // Final crisp outer border
    ctx.addPath(basePath)
    ctx.setStrokeColor(CGColor(srgbRed: 0.796, green: 0.651, blue: 0.969, alpha: 0.24))
    ctx.setLineWidth(max(1.0, s * 0.010))
    ctx.strokePath()

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
