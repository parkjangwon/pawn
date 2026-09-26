// pawn-cua — native macOS computer-use helper for Pawn.
//
// Long-lived process speaking JSON Lines on stdin/stdout. Input and capture
// requests run in order on one serial queue (actions must not reorder); the
// main thread runs AppKit for the agent-cursor overlay and the Esc×2 stop.

import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

let VERSION = "1.0.0"
let work = DispatchQueue(label: "pawn.cua.work", qos: .userInitiated)

// MARK: Helpers

func allDisplaysBounds() -> CGRect {
    Capture.displays().reduce(CGRect.null) { $0.union($1.frame) }
}

func checkedPoint(_ p: JSON, _ xk: String = "x", _ yk: String = "y") throws -> CGPoint? {
    guard let pt = p.point(xk, yk) else { return nil }
    let bounds = allDisplaysBounds()
    guard bounds.insetBy(dx: -1, dy: -1).contains(pt) else {
        throw CuaError("out_of_bounds", "Point (\(Int(pt.x)), \(Int(pt.y))) is outside every display \(rectJSON(bounds))")
    }
    return CGPoint(x: min(max(pt.x, bounds.minX), bounds.maxX - 1), y: min(max(pt.y, bounds.minY), bounds.maxY - 1))
}

func requireAX() throws {
    if !AXIsProcessTrusted() {
        throw CuaError("no_accessibility", "Accessibility permission is required to control the mouse and keyboard. System Settings → Privacy & Security → Accessibility → enable Pawn, then retry.")
    }
}

/// The app a request targets. Nil = no app named (use the frontmost). An app
/// that was named but isn't running is an error — never silently act on
/// whatever happens to be in front.
func targetPid(_ p: JSON) throws -> pid_t? {
    if let pid = p.int("pid"), pid > 0 {
        guard let app = NSRunningApplication(processIdentifier: pid_t(pid)), !app.isTerminated else {
            throw CuaError("not_found", "No running app with pid \(pid). Use apps to list running apps.")
        }
        return pid_t(pid)
    }
    let named = p.string("app") ?? p.string("bundleId") ?? p.string("bundle_id")
    guard let name = named, !name.isEmpty else { return nil }
    guard let app = Apps.running(p) else {
        throw CuaError("not_found", "App \"\(name)\" is not running. Launch it first (launch).")
    }
    return app.processIdentifier
}

func cursorJSON() -> JSON {
    let c = Input.cursor()
    return ["x": num(c.x), "y": num(c.y)]
}

// MARK: Screenshot

func screenshot(_ p: JSON) throws -> JSON {
    let format = (p.string("format") ?? "jpeg").lowercased()
    let quality = p.double("quality") ?? 0.85
    let showCursor = p.bool("showCursor") ?? true
    let excludeOwn = p.bool("excludeOwn") ?? true
    let excludePids = (p["excludePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
    var img: CGImage
    var region: CGRect
    var display: DisplayInfo
    if let wid = p.int("windowId") {
        let (i, bounds) = try Capture.captureWindow(CGWindowID(wid))
        img = i
        region = bounds
        if let d = Capture.display(containing: CGPoint(x: bounds.midX, y: bounds.midY)) { display = d } else { display = try Capture.display(nil) }
    } else {
        let requested = p.rect("region")
        if let r = requested {
            if let d = Capture.display(containing: CGPoint(x: r.midX, y: r.midY)) { display = d } else { display = try Capture.display(p.int("displayId")) }
        } else {
            display = try Capture.display(p.int("displayId"))
        }
        let shot = try Capture.capture(display: display, region: requested, showCursor: showCursor, excludeOwn: excludeOwn, excludePids: excludePids)
        img = shot.image
        region = shot.region
    }
    var marks: [JSON] = []
    if let annotate = p.string("annotate"), annotate == "ax" {
        var o = AX.SnapshotOptions()
        o.maxNodes = p.int("maxMarks") ?? 120
        o.interactiveOnly = true
        o.includeText = false
        o.bounds = region
        if let snap = try? AX.snapshot(pid: try targetPid(p), scope: p.string("scope") ?? "window", options: o),
           let nodes = snap["nodes"] as? [JSON] {
            var m: [Capture.Mark] = []
            for n in nodes {
                guard let id = n["id"] as? Int, let f = n["frame"] as? JSON,
                      let x = f.double("x"), let y = f.double("y"), let w = f.double("width"), let h = f.double("height"),
                      w >= 4, h >= 4 else { continue }
                let r = CGRect(x: x, y: y, width: w, height: h)
                guard r.intersects(region) else { continue }
                m.append(Capture.Mark(rect: r, label: "\(id)"))
                marks.append(["id": id, "role": n["role"] ?? "", "label": n["label"] ?? "",
                              "center": ["x": num(r.midX), "y": num(r.midY)]])
            }
            img = Capture.annotate(img, region: region, marks: m)
        }
    }
    let (w, h) = Capture.fit(img.width, img.height, maxWidth: p.int("maxWidth"), maxHeight: p.int("maxHeight"),
                             maxLongEdge: p.int("maxLongEdge"), maxPixels: p.int("maxPixels"))
    let out = Capture.resize(img, to: w, h)
    let (data, mime) = try Capture.encode(out, format: format, quality: quality)
    var j: JSON = [
        "data": data.base64EncodedString(),
        "mime": mime,
        "width": w,
        "height": h,
        "region": rectJSON(region),
        "display": display.json,
        "pointsPerPixel": num(region.width / CGFloat(w)),
        "cursor": cursorJSON(),
        "bytes": data.count
    ]
    if !marks.isEmpty { j["marks"] = marks }
    return j
}

// MARK: OCR

func ocr(_ p: JSON) throws -> JSON {
    var img: CGImage
    var region: CGRect
    if let wid = p.int("windowId") {
        (img, region) = try Capture.captureWindow(CGWindowID(wid))
    } else {
        let requested = p.rect("region")
        let d: DisplayInfo
        if let r = requested, let hit = Capture.display(containing: CGPoint(x: r.midX, y: r.midY)) { d = hit } else { d = try Capture.display(p.int("displayId")) }
        let shot = try Capture.capture(display: d, region: requested, showCursor: false, excludeOwn: true, excludePids: [])
        img = shot.image
        region = shot.region
    }
    let lines = try OCR.recognize(img, region: region, languages: p["languages"] as? [String], fast: p.bool("fast") ?? false)
    var j: JSON = ["region": rectJSON(region), "count": lines.count]
    if let q = p.string("query") {
        j["matches"] = OCR.find(lines, query: q, img: img, region: region)
    } else {
        let limit = p.int("limit") ?? 400
        j["lines"] = lines.prefix(limit).map(OCR.lineJSON)
        j["text"] = lines.map { $0.text }.joined(separator: "\n")
    }
    return j
}

// MARK: Dispatch

func handle(_ method: String, _ p: JSON) throws -> Any {
    switch method {
    case "ping":
        return ["ok": true, "version": VERSION]

    case "capabilities":
        return [
            "version": VERSION,
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "arch": {
                #if arch(arm64)
                return "arm64"
                #else
                return "x86_64"
                #endif
            }(),
            "screenCaptureKit": { if #available(macOS 14.0, *) { return true } else { return false } }(),
            "methods": ["screenshot", "zoom", "displays", "cursor", "move", "click", "mouse_down", "mouse_up", "drag",
                        "scroll", "key", "key_down", "key_up", "hold_key", "type", "ui_snapshot", "ui_action", "ui_find",
                        "ui_element_at", "ui_focused", "apps", "launch", "activate", "hide", "quit", "windows",
                        "window_action", "menu_list", "menu_select", "open", "clipboard", "ocr", "find_text",
                        "permissions", "overlay", "release_all", "wait"]
        ]

    case "permissions":
        if p.bool("prompt") == true {
            let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(opts)
            if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
        }
        return [
            "accessibility": AXIsProcessTrusted(),
            "screenRecording": CGPreflightScreenCaptureAccess(),
            "executable": ProcessInfo.processInfo.arguments.first ?? ""
        ]

    case "displays":
        return ["displays": Capture.displays().map { $0.json }, "cursor": cursorJSON()]

    case "screenshot", "zoom":
        if method == "zoom", p.rect("region") == nil { throw CuaError("bad_args", "zoom needs region [x0, y0, x1, y1] in global points") }
        return try screenshot(p)

    case "cursor":
        return cursorJSON()

    case "move":
        try requireAX()
        guard let pt = try checkedPoint(p) else { throw CuaError("bad_args", "x, y required") }
        Input.move(to: pt, flags: try Input.flags(p.strings("modifiers")), smooth: p.bool("smooth") ?? true)
        Overlay.action(at: pt, kind: "move")
        return ["ok": true, "cursor": cursorJSON()]

    case "click":
        try requireAX()
        let pt = try checkedPoint(p)
        let b = Input.button(p.string("button"))
        let flags = try Input.flags(p.strings("modifiers"))
        Overlay.action(at: pt ?? Input.cursor(), kind: b == "right" ? "right" : "click")
        if pt != nil, p.bool("smooth") ?? true { Input.move(to: pt!, smooth: true) }
        Input.click(at: pt, button: b, count: p.int("clicks") ?? 1, flags: flags)
        return ["ok": true, "cursor": cursorJSON()]

    case "mouse_down", "mouse_up":
        try requireAX()
        let pt = try checkedPoint(p)
        Input.mouseButton(Input.button(p.string("button")), down: method == "mouse_down", at: pt, flags: try Input.flags(p.strings("modifiers")))
        Overlay.action(at: pt ?? Input.cursor(), kind: method == "mouse_down" ? "click" : "move")
        return ["ok": true, "cursor": cursorJSON()]

    case "drag":
        try requireAX()
        var path: [CGPoint] = []
        if let pts = p["path"] as? [Any] {
            for raw in pts {
                if let a = raw as? [Any], a.count == 2, let x = (a[0] as? NSNumber)?.doubleValue, let y = (a[1] as? NSNumber)?.doubleValue {
                    path.append(CGPoint(x: x, y: y))
                } else if let d = raw as? JSON, let pt = d.point() {
                    path.append(pt)
                }
            }
        } else if let from = try checkedPoint(p, "fromX", "fromY"), let to = try checkedPoint(p, "toX", "toY") {
            path = [from, to]
        }
        guard path.count >= 2 else { throw CuaError("bad_args", "drag needs fromX/fromY/toX/toY or path [[x,y], …]") }
        let bounds = allDisplaysBounds().insetBy(dx: -1, dy: -1)
        guard path.allSatisfy({ bounds.contains($0) }) else { throw CuaError("out_of_bounds", "Drag path leaves the screen") }
        Overlay.action(at: path[0], kind: "click")
        Input.drag(path: path, button: Input.button(p.string("button")), flags: try Input.flags(p.strings("modifiers")),
                   durationMs: p.double("durationMs") ?? 350)
        Overlay.action(at: path.last, kind: "move")
        return ["ok": true, "cursor": cursorJSON()]

    case "scroll":
        try requireAX()
        let pt = try checkedPoint(p)
        var dx = p.double("dx") ?? 0
        var dy = p.double("dy") ?? 0
        if let dir = p.string("direction") {
            let amount = p.double("amount") ?? 3
            switch dir.lowercased() {
            case "up": dy = -amount
            case "down": dy = amount
            case "left": dx = -amount
            case "right": dx = amount
            default: throw CuaError("bad_args", "direction must be up, down, left, or right")
            }
        }
        guard dx != 0 || dy != 0 else { throw CuaError("bad_args", "scroll needs dy/dx or direction+amount") }
        Overlay.action(at: pt ?? Input.cursor(), kind: "move")
        Input.scroll(at: pt, dx: dx, dy: dy, pixels: p.bool("pixels") ?? false, flags: try Input.flags(p.strings("modifiers")))
        return ["ok": true]

    case "key":
        try requireAX()
        guard let combo = p.string("key"), !combo.isEmpty else { throw CuaError("bad_args", "key is required") }
        Overlay.action(at: nil, kind: "key")
        try Input.keyCombo(combo, repeatCount: p.int("repeat") ?? 1, pid: try targetPid(p))
        return ["ok": true]

    case "key_down":
        try requireAX()
        guard let combo = p.string("key") else { throw CuaError("bad_args", "key is required") }
        try Input.keyDown(combo, pid: try targetPid(p))
        return ["ok": true, "held": Array(Input.heldKeys.keys)]

    case "key_up":
        try requireAX()
        guard let combo = p.string("key") else { throw CuaError("bad_args", "key is required") }
        try Input.keyUp(combo, pid: try targetPid(p))
        return ["ok": true, "held": Array(Input.heldKeys.keys)]

    case "hold_key":
        try requireAX()
        guard let combo = p.string("key") else { throw CuaError("bad_args", "key is required") }
        let ms = min(max(p.double("durationMs") ?? 500, 10), 300_000)
        try Input.keyDown(combo, pid: try targetPid(p))
        sleepMs(ms)
        try Input.keyUp(combo, pid: try targetPid(p))
        return ["ok": true, "heldMs": ms]

    case "type":
        try requireAX()
        guard let text = p.string("text") else { throw CuaError("bad_args", "text is required") }
        let method = p.string("method") ?? (text.count > 400 ? "paste" : "keys")
        Overlay.action(at: nil, kind: "type")
        if method == "paste" {
            let pb = NSPasteboard.general
            let saved = pb.pasteboardItems?.compactMap { item -> NSPasteboardItem? in
                let copy = NSPasteboardItem()
                for t in item.types { if let d = item.data(forType: t) { copy.setData(d, forType: t) } }
                return copy
            } ?? []
            pb.clearContents()
            pb.setString(text, forType: .string)
            sleepMs(40)
            try Input.keyCombo("cmd+v", repeatCount: 1, pid: try targetPid(p))
            sleepMs(350)
            pb.clearContents()
            if !saved.isEmpty { pb.writeObjects(saved) }
        } else {
            Input.typeText(text, pid: try targetPid(p), delayMs: p.double("delayMs") ?? 3)
        }
        return ["ok": true, "chars": text.count, "method": method]

    case "ui_snapshot":
        var o = AX.SnapshotOptions()
        if let n = p.int("maxNodes") { o.maxNodes = max(10, min(n, 2000)) }
        if let d = p.int("maxDepth") { o.maxDepth = max(1, min(d, 120)) }
        o.includeText = p.bool("includeText") ?? true
        o.interactiveOnly = p.bool("interactiveOnly") ?? false
        o.query = p.string("query")
        let snap = try AX.snapshot(pid: try targetPid(p), scope: p.string("scope") ?? "window", options: o)
        if p.bool("nodes") != true {
            var lean = snap
            lean.removeValue(forKey: "nodes")
            return lean
        }
        return snap

    case "ui_find":
        guard let q = p.string("query"), !q.isEmpty else { throw CuaError("bad_args", "query is required") }
        var o = AX.SnapshotOptions()
        o.query = q
        o.maxNodes = p.int("limit") ?? 40
        o.includeText = true
        let snap = try AX.snapshot(pid: try targetPid(p), scope: p.string("scope") ?? "app", options: o)
        return ["pid": snap["pid"] ?? 0, "app": snap["app"] ?? "", "text": snap["text"] ?? "", "matches": snap["nodes"] ?? []]

    case "ui_action":
        try requireAX()
        guard let id = p.int("element") else { throw CuaError("bad_args", "element (index from ui_snapshot) is required") }
        let info = try? AX.info(id)
        if let f = (info?["frame"] as? JSON).flatMap({ f -> CGRect? in
            guard let x = f.double("x"), let y = f.double("y"), let w = f.double("width"), let h = f.double("height") else { return nil }
            return CGRect(x: x, y: y, width: w, height: h)
        }) {
            Overlay.highlight(f)
            Overlay.action(at: CGPoint(x: f.midX, y: f.midY), kind: "click")
        }
        return try AX.perform(id, action: p.string("action") ?? "press", value: p.string("value"))

    case "ui_element_at":
        guard let pt = p.point() else { throw CuaError("bad_args", "x, y required") }
        return try AX.elementAt(pt)

    case "ui_element":
        guard let id = p.int("element") else { throw CuaError("bad_args", "element is required") }
        return try AX.info(id)

    case "ui_focused":
        return AX.focused()

    case "apps":
        return ["apps": Apps.list(includeBackground: p.bool("all") ?? false),
                "frontmost": NSWorkspace.shared.frontmostApplication?.localizedName ?? ""]

    case "launch":
        return try Apps.launch(p)

    case "activate":
        guard let app = Apps.running(p) else { throw CuaError("not_found", "App is not running. Use launch.") }
        Apps.activate(app)
        return ["ok": true, "pid": Int(app.processIdentifier), "frontmost": NSWorkspace.shared.frontmostApplication?.localizedName ?? ""]

    case "hide":
        guard let app = Apps.running(p) else { throw CuaError("not_found", "App is not running") }
        return ["ok": app.hide()]

    case "quit":
        guard let app = Apps.running(p) else { throw CuaError("not_found", "App is not running") }
        let ok = (p.bool("force") ?? false) ? app.forceTerminate() : app.terminate()
        return ["ok": ok]

    case "windows":
        return ["windows": Apps.windows(pid: try targetPid(p), all: p.bool("all") ?? false)]

    case "window_action":
        try requireAX()
        return try Apps.windowAction(p)

    case "menu_list":
        guard let pid = try targetPid(p) ?? AX.frontmostPid() else { throw CuaError("no_app", "No app") }
        return try AX.listMenu(pid: pid, path: p["path"] as? [String] ?? [])

    case "menu_select":
        try requireAX()
        guard let pid = try targetPid(p) ?? AX.frontmostPid() else { throw CuaError("no_app", "No app") }
        return try AX.selectMenu(pid: pid, path: p["path"] as? [String] ?? [])

    case "open":
        return try Apps.open(p)

    case "clipboard":
        return try Apps.clipboard(p)

    case "ocr", "find_text":
        var q = p
        if method == "find_text", p.string("query") == nil { throw CuaError("bad_args", "query is required") }
        if method == "find_text" { q["fast"] = p.bool("fast") ?? false }
        return try ocr(q)

    case "overlay":
        Overlay.setEnabled(p.bool("enabled") ?? true, pill: p.string("text"))
        return ["ok": true]

    case "release_all":
        Input.releaseAllHeld()
        return ["ok": true]

    case "wait":
        let ms = min(max(p.double("ms") ?? 500, 0), 300_000)
        sleepMs(ms)
        return ["ok": true, "ms": ms]

    default:
        throw CuaError("unknown_method", "Unknown method \(method)")
    }
}

// MARK: Main

let DEBUG = ProcessInfo.processInfo.environment["PAWN_CUA_DEBUG"] == "1"
func debugLog(_ s: @autoclosure () -> String) {
    guard DEBUG else { return }
    FileHandle.standardError.write("[pawn-cua] \(s())\n".data(using: .utf8)!)
}

/// Read-only methods that don't touch input or the AX element store: served
/// concurrently so a long action never blocks them.
let immediate: Set<String> = ["ping", "overlay", "release_all", "permissions", "cursor", "displays", "apps",
                              "windows", "capabilities"]
/// OCR is CPU-heavy but independent of input ordering: its own queue.
let visionQueue = DispatchQueue(label: "pawn.cua.vision", qos: .userInitiated)
let visionMethods: Set<String> = ["ocr", "find_text"]

func process(_ line: String) {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? JSON else {
        Output.shared.send(["id": NSNull(), "error": ["code": "parse_error", "message": "Invalid JSON request"]])
        return
    }
    let id = obj["id"] ?? NSNull()
    guard let method = obj["method"] as? String else {
        Output.shared.send(["id": id, "error": ["code": "bad_request", "message": "method is required"]])
        return
    }
    let params = obj["params"] as? JSON ?? [:]
    let run = {
        let started = Date()
        debugLog("start \(method) id=\(id)")
        defer { debugLog("end \(method) id=\(id) \(Int(Date().timeIntervalSince(started) * 1000))ms") }
        do {
            var result = try handle(method, params)
            if var dict = result as? JSON {
                dict["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                result = dict
            }
            Output.shared.reply(id, .success(result))
        } catch {
            Output.shared.reply(id, .failure(error))
        }
    }
    if immediate.contains(method) {
        DispatchQueue.global(qos: .userInitiated).async(execute: run)
    } else if visionMethods.contains(method) {
        visionQueue.async(execute: run)
    } else {
        work.async(execute: run)
    }
}

// CLI mode for manual testing: `pawn-cua call <method> '<json params>'`
let args = CommandLine.arguments
if args.count >= 3 && args[1] == "call" {
    OCR.warmed = true
    let params = args.count >= 4 ? ((try? JSONSerialization.jsonObject(with: Data(args[3].utf8))) as? JSON ?? [:]) : [:]
    do {
        let r = try handle(args[2], params)
        let safe = sanitize(r)
        let d = try JSONSerialization.data(withJSONObject: safe, options: [.prettyPrinted, .sortedKeys])
        print(String(data: d, encoding: .utf8) ?? "")
        exit(0)
    } catch {
        FileHandle.standardError.write("error: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}
if args.count >= 2 && (args[1] == "--version" || args[1] == "version") {
    print(VERSION)
    exit(0)
}

setvbuf(stdout, nil, _IOLBF, 0)
signal(SIGPIPE, SIG_IGN)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

Overlay.installEmergencyStop {
    Input.releaseAllHeld()
    Output.shared.send(["event": "user_abort", "reason": "Esc pressed twice"])
}

Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }
        process(line)
    }
    // Parent closed stdin: release anything held and exit.
    work.sync { Input.releaseAllHeld() }
    exit(0)
}

OCR.warmUp()
Output.shared.send(["event": "ready", "version": VERSION, "accessibility": AXIsProcessTrusted(),
                    "screenRecording": CGPreflightScreenCaptureAccess()])
app.run()
