// Screen capture: ScreenCaptureKit (macOS 14+) with a CoreGraphics fallback.
//
// Every capture reports the global-point rectangle it covers and the image
// size, so callers can map image pixels back to screen points exactly:
//   globalX = region.x + imageX * (region.width / image.width)

import Foundation
import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import ScreenCaptureKit

struct DisplayInfo {
    let id: CGDirectDisplayID
    let frame: CGRect        // global points
    let pixelWidth: Int
    let pixelHeight: Int
    let scale: Double
    let name: String
    let isMain: Bool

    var json: JSON {
        ["id": Int(id), "frame": rectJSON(frame), "pixelWidth": pixelWidth, "pixelHeight": pixelHeight,
         "scale": scale, "name": name, "primary": isMain]
    }
}

enum Capture {
    static func displays() -> [DisplayInfo] {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(max(count, 1)))
        CGGetActiveDisplayList(count, &ids, &count)
        let screens = NSScreen.screens
        return ids.prefix(Int(count)).map { id in
            let bounds = CGDisplayBounds(id)
            let mode = CGDisplayCopyDisplayMode(id)
            let pw = mode?.pixelWidth ?? Int(bounds.width)
            let ph = mode?.pixelHeight ?? Int(bounds.height)
            let screen = screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id }
            let scale = Double(screen?.backingScaleFactor ?? CGFloat(pw) / max(bounds.width, 1))
            return DisplayInfo(id: id, frame: bounds, pixelWidth: pw, pixelHeight: ph, scale: scale,
                               name: screen?.localizedName ?? "Display \(id)", isMain: CGDisplayIsMain(id) != 0)
        }
    }

    static func display(_ id: Int?) throws -> DisplayInfo {
        let all = displays()
        if let id = id, id != 0 {
            guard let d = all.first(where: { Int($0.id) == id }) else {
                throw CuaError("bad_display", "No display with id \(id). Call displays.")
            }
            return d
        }
        return all.first(where: { $0.isMain }) ?? all[0]
    }

    /// Display containing a global point (for zoom regions / window captures).
    static func display(containing p: CGPoint) -> DisplayInfo? {
        displays().first { $0.frame.contains(p) }
    }

    // MARK: Capture

    struct Shot {
        let image: CGImage
        let region: CGRect      // global points covered by the image
        let display: DisplayInfo
    }

    /// Capture `region` (global points) of a display at native resolution.
    static func capture(display d: DisplayInfo, region: CGRect?, showCursor: Bool, excludeOwn: Bool, excludePids: [Int32]) throws -> Shot {
        let target = (region ?? d.frame).intersection(d.frame)
        guard !target.isNull, target.width >= 1, target.height >= 1 else {
            throw CuaError("bad_region", "Region is outside display \(d.id)")
        }
        if #available(macOS 14.0, *) {
            if let img = try? captureSCK(display: d, region: target, showCursor: showCursor, excludeOwn: excludeOwn, excludePids: excludePids) {
                return Shot(image: img, region: target, display: d)
            }
        }
        // CoreGraphics fallback (no cursor, includes every window).
        let local = CGRect(x: target.minX - d.frame.minX, y: target.minY - d.frame.minY, width: target.width, height: target.height)
        guard let full = CGDisplayCreateImage(d.id) else {
            throw CuaError("capture_failed", "Screen capture failed. Grant Screen Recording to Pawn in System Settings → Privacy & Security, then restart Pawn.")
        }
        let sx = Double(full.width) / Double(d.frame.width)
        let sy = Double(full.height) / Double(d.frame.height)
        let px = CGRect(x: local.minX * sx, y: local.minY * sy, width: local.width * sx, height: local.height * sy).integral
        let img = region == nil ? full : (full.cropping(to: px) ?? full)
        return Shot(image: img, region: target, display: d)
    }

    @available(macOS 14.0, *)
    static func captureSCK(display d: DisplayInfo, region: CGRect, showCursor: Bool, excludeOwn: Bool, excludePids: [Int32]) throws -> CGImage {
        let content = try awaitSync(timeout: 8) {
            try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        }
        guard let scDisplay = content.displays.first(where: { $0.displayID == d.id }) else {
            throw CuaError("capture_failed", "Display \(d.id) not shareable")
        }
        let myPid = ProcessInfo.processInfo.processIdentifier
        var pids = Set(excludePids)
        if excludeOwn { pids.insert(myPid) }
        let excluded = content.applications.filter { pids.contains($0.processID) }
        let filter = SCContentFilter(display: scDisplay, excludingApplications: excluded, exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        let local = CGRect(x: region.minX - d.frame.minX, y: region.minY - d.frame.minY, width: region.width, height: region.height)
        if local.size != d.frame.size { cfg.sourceRect = local }
        cfg.width = max(1, Int((region.width * d.scale).rounded()))
        cfg.height = max(1, Int((region.height * d.scale).rounded()))
        cfg.showsCursor = showCursor
        cfg.capturesAudio = false
        cfg.colorSpaceName = CGColorSpace.sRGB
        return try awaitSync(timeout: 8) {
            try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        }
    }

    /// Capture a single window (even partially covered) by CGWindowID.
    static func captureWindow(_ windowId: CGWindowID) throws -> (CGImage, CGRect) {
        guard let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]])?.first,
              let b = info[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: b as CFDictionary) else {
            throw CuaError("bad_window", "No window \(windowId)")
        }
        if #available(macOS 14.0, *) {
            let content = try awaitSync(timeout: 8) {
                try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            }
            if let w = content.windows.first(where: { $0.windowID == windowId }) {
                let filter = SCContentFilter(desktopIndependentWindow: w)
                let cfg = SCStreamConfiguration()
                let scale = display(containing: CGPoint(x: bounds.midX, y: bounds.midY))?.scale ?? 2
                cfg.width = max(1, Int(bounds.width * scale))
                cfg.height = max(1, Int(bounds.height * scale))
                cfg.showsCursor = false
                if let img = try? awaitSync(timeout: 8, { try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg) }) {
                    return (img, bounds)
                }
            }
        }
        guard let img = CGWindowListCreateImage(.null, .optionIncludingWindow, windowId, [.boundsIgnoreFraming, .bestResolution]) else {
            throw CuaError("capture_failed", "Window capture failed")
        }
        return (img, bounds)
    }

    // MARK: Encode

    /// Resize so the image fits `maxW × maxH`, a long-edge cap, and a pixel budget.
    static func fit(_ w: Int, _ h: Int, maxWidth: Int?, maxHeight: Int?, maxLongEdge: Int?, maxPixels: Int?) -> (Int, Int) {
        var scale = 1.0
        if let m = maxWidth, m > 0 { scale = min(scale, Double(m) / Double(w)) }
        if let m = maxHeight, m > 0 { scale = min(scale, Double(m) / Double(h)) }
        if let m = maxLongEdge, m > 0 { scale = min(scale, Double(m) / Double(max(w, h))) }
        if let m = maxPixels, m > 0, w * h > m { scale = min(scale, sqrt(Double(m) / Double(w * h))) }
        return (max(1, Int((Double(w) * scale).rounded(.down))), max(1, Int((Double(h) * scale).rounded(.down))))
    }

    static func resize(_ img: CGImage, to w: Int, _ h: Int) -> CGImage {
        if img.width == w && img.height == h { return img }
        let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return img }
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage() ?? img
    }

    static func encode(_ img: CGImage, format: String, quality: Double) throws -> (Data, String) {
        let data = NSMutableData()
        let isJpeg = format == "jpeg" || format == "jpg"
        let type = (isJpeg ? UTType.jpeg : UTType.png).identifier as CFString
        guard let dest = CGImageDestinationCreateWithData(data, type, 1, nil) else {
            throw CuaError("encode_failed", "Image encoder unavailable")
        }
        var props: [CFString: Any] = [:]
        if isJpeg { props[kCGImageDestinationLossyCompressionQuality] = max(0.3, min(quality, 1.0)) }
        var src = img
        if isJpeg, img.alphaInfo != .none, img.alphaInfo != .noneSkipFirst, img.alphaInfo != .noneSkipLast {
            src = flatten(img)
        }
        CGImageDestinationAddImage(dest, src, props as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw CuaError("encode_failed", "Image encoding failed") }
        return (data as Data, isJpeg ? "image/jpeg" : "image/png")
    }

    /// JPEG has no alpha: composite onto white.
    static func flatten(_ img: CGImage) -> CGImage {
        let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return img }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: img.width, height: img.height))
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        return ctx.makeImage() ?? img
    }

    // MARK: Set-of-Mark annotation

    struct Mark {
        let rect: CGRect   // global points
        let label: String
    }

    /// Draw numbered boxes onto an image whose top-left pixel is `region.origin`.
    static func annotate(_ img: CGImage, region: CGRect, marks: [Mark]) -> CGImage {
        guard !marks.isEmpty else { return img }
        let w = img.width, h = img.height
        let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return img }
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        let sx = Double(w) / Double(region.width)
        let sy = Double(h) / Double(region.height)
        let palette: [CGColor] = [
            CGColor(red: 0.93, green: 0.25, blue: 0.35, alpha: 1), CGColor(red: 0.16, green: 0.55, blue: 0.95, alpha: 1),
            CGColor(red: 0.18, green: 0.72, blue: 0.42, alpha: 1), CGColor(red: 0.95, green: 0.55, blue: 0.1, alpha: 1),
            CGColor(red: 0.6, green: 0.35, blue: 0.9, alpha: 1)
        ]
        let fontSize = max(10, min(18, Double(w) / 110))
        let lineW = max(1.5, Double(w) / 900)
        for (i, m) in marks.enumerated() {
            // Convert to image pixels; CG context origin is bottom-left.
            let x = (m.rect.minX - region.minX) * sx
            let y = (m.rect.minY - region.minY) * sy
            let rw = m.rect.width * sx
            let rh = m.rect.height * sy
            let r = CGRect(x: x, y: Double(h) - y - rh, width: rw, height: rh)
            let color = palette[i % palette.count]
            ctx.setStrokeColor(color)
            ctx.setLineWidth(lineW)
            ctx.stroke(r)
            let label = m.label as NSString
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.boldSystemFont(ofSize: fontSize),
                .foregroundColor: NSColor.white
            ]
            let size = label.size(withAttributes: attrs)
            let pad = 2.0
            var tag = CGRect(x: r.minX, y: r.maxY - size.height - pad * 2, width: size.width + pad * 2, height: size.height + pad * 2)
            if tag.minY < 0 { tag.origin.y = 0 }
            if tag.maxX > Double(w) { tag.origin.x = Double(w) - tag.width }
            ctx.setFillColor(color)
            ctx.fill(tag)
            let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = ns
            label.draw(at: CGPoint(x: tag.minX + pad, y: tag.minY + pad), withAttributes: attrs)
            NSGraphicsContext.restoreGraphicsState()
        }
        return ctx.makeImage() ?? img
    }
}

/// Run an async throwing closure synchronously (never call on the main thread).
func awaitSync<T>(timeout: Double, _ body: @escaping () async throws -> T) throws -> T {
    let sem = DispatchSemaphore(value: 0)
    var result: Result<T, Error>?
    Task.detached {
        do { result = .success(try await body()) } catch { result = .failure(error) }
        sem.signal()
    }
    if sem.wait(timeout: .now() + timeout) == .timedOut {
        throw CuaError("timeout", "Operation timed out after \(Int(timeout))s")
    }
    switch result! {
    case .success(let v): return v
    case .failure(let e): throw e
    }
}
