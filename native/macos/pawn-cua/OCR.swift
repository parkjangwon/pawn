// On-device OCR with the Vision framework (fast, private, multilingual).
// Finds text on any surface — canvases, images, remote desktops, games — where
// the accessibility tree has nothing, and returns clickable screen positions.

import Foundation
import Vision
import CoreGraphics
import CoreText
import Foundation

enum OCR {
    /// The first text recognition in a process compiles the Neural Engine
    /// model (seconds to minutes on a fresh install; cached afterwards).
    /// Warm it up in the background at launch so real requests don't stall.
    static let warmDone = DispatchSemaphore(value: 0)
    static var warmed = false
    static let warmQueue = DispatchQueue(label: "pawn.cua.ocr-warm", qos: .utility)

    static func warmUp() {
        warmQueue.async {
            // Real glyphs, so both the text detector and the recognizer load.
            let w = 420, h = 64
            let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
            if let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
                ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
                ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
                let font = CTFontCreateWithName("Helvetica" as CFString, 26, nil)
                let attrs: [NSAttributedString.Key: Any] = [
                    NSAttributedString.Key(kCTFontAttributeName as String): font,
                    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1)
                ]
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Pawn OCR 가나다 123", attributes: attrs))
                ctx.textPosition = CGPoint(x: 12, y: 20)
                CTLineDraw(line, ctx)
                if let img = ctx.makeImage() {
                    let t = Date()
                    let lines = try? recognize(img, region: CGRect(x: 0, y: 0, width: w, height: h), languages: nil, fast: false, skipWarmWait: true)
                    debugLog("ocr warm text=\(lines?.first?.text ?? "-") \(Int(Date().timeIntervalSince(t) * 1000))ms")
                }
            }
            warmed = true
            warmDone.signal()
            debugLog("ocr warm")
        }
    }

    static func waitWarm(timeout: Double) throws {
        if warmed { return }
        if warmDone.wait(timeout: .now() + timeout) == .timedOut {
            throw CuaError("ocr_warming", "On-device OCR is still preparing its text model (first use after install). Retry in a minute; meanwhile use ui_snapshot, ui_find, or zoom.")
        }
        warmDone.signal() // let other waiters through
    }

    struct Line {
        let text: String
        let confidence: Float
        let rect: CGRect  // global points
    }

    static func recognize(_ img: CGImage, region: CGRect, languages: [String]?, fast: Bool, skipWarmWait: Bool = false) throws -> [Line] {
        if !skipWarmWait { try waitWarm(timeout: 15) }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = fast ? .fast : .accurate
        req.usesLanguageCorrection = !fast
        if #available(macOS 13.0, *) { req.automaticallyDetectsLanguage = true }
        let supported = (try? req.supportedRecognitionLanguages()) ?? []
        // User's languages first (fewer models → faster), English always.
        var langs = languages ?? defaultLanguages(supported)
        langs = langs.filter { supported.contains($0) }
        if !langs.isEmpty { req.recognitionLanguages = langs }
        let handler = VNImageRequestHandler(cgImage: img, options: [:])
        debugLog("vision perform \(img.width)x\(img.height) langs=\(langs)")
        try handler.perform([req])
        debugLog("vision done \(req.results?.count ?? -1)")
        let results = req.results ?? []
        return results.compactMap { obs in
            guard let cand = obs.topCandidates(1).first else { return nil }
            // Vision boxes are normalized with a bottom-left origin.
            let b = obs.boundingBox
            let rect = CGRect(
                x: region.minX + b.minX * region.width,
                y: region.minY + (1 - b.maxY) * region.height,
                width: b.width * region.width,
                height: b.height * region.height)
            return Line(text: cand.string, confidence: cand.confidence, rect: rect)
        }
        .sorted { a, b in abs(a.rect.midY - b.rect.midY) < 6 ? a.rect.minX < b.rect.minX : a.rect.minY < b.rect.minY }
    }

    static func defaultLanguages(_ supported: [String]) -> [String] {
        var out: [String] = []
        for pref in Locale.preferredLanguages {
            let lower = pref.lowercased()
            if let hit = supported.first(where: { $0.lowercased() == lower })
                ?? supported.first(where: { lower.hasPrefix($0.lowercased().split(separator: "-").first.map(String.init) ?? "") }) {
                if !out.contains(hit) { out.append(hit) }
            }
            if out.count >= 3 { break }
        }
        if !out.contains("en-US") { out.append("en-US") }
        return out
    }

    static func lineJSON(_ l: Line) -> JSON {
        ["text": l.text, "confidence": Double(l.confidence), "frame": rectJSON(l.rect),
         "center": ["x": num(l.rect.midX), "y": num(l.rect.midY)]]
    }

    /// Locate a phrase; returns the tightest boxes (sub-line when possible).
    static func find(_ lines: [Line], query: String, img: CGImage?, region: CGRect) -> [JSON] {
        let q = query.lowercased().trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return [] }
        var hits: [JSON] = []
        for l in lines {
            let lower = l.text.lowercased()
            guard let range = lower.range(of: q) else { continue }
            // Estimate the sub-rect of the match by character offsets.
            let total = max(1, lower.count)
            let start = lower.distance(from: lower.startIndex, to: range.lowerBound)
            let len = lower.distance(from: range.lowerBound, to: range.upperBound)
            let x0 = l.rect.minX + l.rect.width * Double(start) / Double(total)
            let w = max(4, l.rect.width * Double(len) / Double(total))
            let r = CGRect(x: x0, y: l.rect.minY, width: w, height: l.rect.height)
            var j = lineJSON(Line(text: l.text, confidence: l.confidence, rect: r))
            j["line"] = l.text
            j["exact"] = lower == q
            hits.append(j)
        }
        return hits.sorted { ($0["exact"] as? Bool ?? false) && !($1["exact"] as? Bool ?? false) }
    }
}
