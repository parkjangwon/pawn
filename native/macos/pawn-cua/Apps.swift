// Applications, windows, URLs/files, clipboard.

import Foundation
import AppKit
import ApplicationServices

enum Apps {
    static func list(includeBackground: Bool) -> [JSON] {
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return NSWorkspace.shared.runningApplications
            .filter { includeBackground || $0.activationPolicy == .regular }
            .map { a in
                [
                    "name": a.localizedName ?? "",
                    "bundleId": a.bundleIdentifier ?? "",
                    "pid": Int(a.processIdentifier),
                    "active": a.processIdentifier == front,
                    "hidden": a.isHidden,
                    "path": a.bundleURL?.path ?? ""
                ]
            }
    }

    /// Resolve an app by pid, bundle id, or (fuzzy) name among running apps.
    static func running(_ p: JSON) -> NSRunningApplication? {
        if let pid = p.int("pid"), pid > 0 {
            let app = NSRunningApplication(processIdentifier: pid_t(pid))
            return app?.isTerminated == false ? app : nil
        }
        // Skip instances that are quitting (they linger briefly after terminate).
        let apps = NSWorkspace.shared.runningApplications.filter { !$0.isTerminated }
        if let b = p.string("bundleId") ?? p.string("bundle_id"), !b.isEmpty {
            return apps.first { $0.bundleIdentifier?.lowercased() == b.lowercased() }
        }
        if let n = p.string("app") ?? p.string("name"), !n.isEmpty {
            let lower = n.lowercased()
            // Strip only a trailing ".app" ("com.apple.TextEdit" must stay intact).
            let want = lower.hasSuffix(".app") ? String(lower.dropLast(4)) : lower
            return apps.first { ($0.bundleIdentifier ?? "").lowercased() == lower }
                ?? apps.first { ($0.localizedName ?? "").lowercased() == want }
                ?? apps.first { ($0.bundleURL?.deletingPathExtension().lastPathComponent ?? "").lowercased() == want }
                ?? apps.first { $0.activationPolicy == .regular && ($0.localizedName ?? "").lowercased().hasPrefix(want) }
                ?? apps.first { $0.activationPolicy == .regular && ($0.localizedName ?? "").lowercased().contains(want) }
        }
        return nil
    }

    static func appURL(_ p: JSON) -> URL? {
        let ws = NSWorkspace.shared
        if let b = p.string("bundleId") ?? p.string("bundle_id"), let u = ws.urlForApplication(withBundleIdentifier: b) { return u }
        guard let raw = p.string("app") ?? p.string("name"), !raw.isEmpty else { return nil }
        if raw.hasPrefix("/") { return URL(fileURLWithPath: raw) }
        if let u = ws.urlForApplication(withBundleIdentifier: raw) { return u }
        let name = raw.hasSuffix(".app") ? raw : raw + ".app"
        let dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities",
                    NSHomeDirectory() + "/Applications", "/System/Library/CoreServices"]
        for d in dirs {
            let u = URL(fileURLWithPath: d).appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        // Case-insensitive scan as a last resort.
        let lower = name.lowercased()
        for d in dirs {
            if let items = try? FileManager.default.contentsOfDirectory(atPath: d),
               let hit = items.first(where: { $0.lowercased() == lower }) {
                return URL(fileURLWithPath: d).appendingPathComponent(hit)
            }
        }
        return nil
    }

    static func launch(_ p: JSON) throws -> JSON {
        // An instance that is still shutting down can't be activated; wait it out.
        if let app = running(p), !app.isFinishedLaunching || app.isTerminated {
            let deadline = Date().addingTimeInterval(3)
            while Date() < deadline, !app.isTerminated, !app.isFinishedLaunching { sleepMs(50) }
        }
        if let app = running(p), !(p.bool("new_instance") ?? false), !app.isTerminated {
            _ = activate(app)
            return ["ok": true, "pid": Int(app.processIdentifier), "name": app.localizedName ?? "", "launched": false]
        }
        guard let url = appURL(p) else {
            throw CuaError("not_found", "Application not found: \(p.string("app") ?? p.string("bundleId") ?? "?")")
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = p.bool("activate") ?? true
        cfg.createsNewApplicationInstance = p.bool("new_instance") ?? false
        let app: NSRunningApplication = try awaitSync(timeout: 20) {
            try await NSWorkspace.shared.openApplication(at: url, configuration: cfg)
        }
        // Wait until it can answer AX (window up) so the next snapshot is useful.
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            let ae = AX.appElement(app.processIdentifier)
            if AX.copy(ae, kAXWindowsAttribute) as? [AXUIElement] != nil, app.isFinishedLaunching { break }
            sleepMs(120)
        }
        return ["ok": true, "pid": Int(app.processIdentifier), "name": app.localizedName ?? url.lastPathComponent, "launched": true]
    }

    @discardableResult
    static func activate(_ app: NSRunningApplication) -> Bool {
        if app.isHidden { app.unhide() }
        let ok: Bool
        if #available(macOS 14.0, *) {
            ok = app.activate(from: NSRunningApplication.current, options: [.activateAllWindows])
                || app.activate(options: [.activateAllWindows])
        } else {
            ok = app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        }
        // Wait for the switch so the next action lands in the right app.
        let deadline = Date().addingTimeInterval(1.5)
        while Date() < deadline, NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier {
            sleepMs(40)
        }
        return ok
    }

    // MARK: Windows

    static func windows(pid: pid_t?, all: Bool) -> [JSON] {
        let opts: CGWindowListOption = all ? [.optionAll, .excludeDesktopElements] : [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return [] }
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let me = ProcessInfo.processInfo.processIdentifier
        var out: [JSON] = []
        for (z, w) in list.enumerated() {
            guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
                  let wpid = w[kCGWindowOwnerPID as String] as? Int32, wpid != me,
                  let b = w[kCGWindowBounds as String] as? [String: Any],
                  let bounds = CGRect(dictionaryRepresentation: b as CFDictionary),
                  bounds.width >= 40, bounds.height >= 30 else { continue }
            if let p = pid, p != wpid { continue }
            let alpha = w[kCGWindowAlpha as String] as? Double ?? 1
            if alpha < 0.05 { continue }
            out.append([
                "id": w[kCGWindowNumber as String] as? Int ?? 0,
                "pid": Int(wpid),
                "app": w[kCGWindowOwnerName as String] as? String ?? "",
                "title": w[kCGWindowName as String] as? String ?? "",
                "frame": rectJSON(bounds),
                "onScreen": w[kCGWindowIsOnscreen as String] as? Bool ?? false,
                "frontApp": wpid == front,
                "z": z
            ])
        }
        return out
    }

    /// AX window element for a CGWindowID (or the app's focused window).
    static func axWindow(windowId: CGWindowID?, pid: pid_t?) throws -> (AXUIElement, pid_t) {
        var ownerPid = pid
        if let wid = windowId, ownerPid == nil,
           let info = (CGWindowListCopyWindowInfo([.optionIncludingWindow], wid) as? [[String: Any]])?.first {
            ownerPid = info[kCGWindowOwnerPID as String] as? Int32
        }
        guard let p = ownerPid ?? AX.frontmostPid() else { throw CuaError("not_found", "Window owner not found") }
        let app = AX.appElement(p)
        let ws = AX.copy(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
        if let wid = windowId {
            if let hit = ws.first(where: { AX.windowId($0) == wid }) { return (hit, p) }
            throw CuaError("not_found", "Window \(wid) is not accessible (minimized to another Space?)")
        }
        if let f = AX.copy(app, kAXFocusedWindowAttribute) { return (f as! AXUIElement, p) }
        if let first = ws.first { return (first, p) }
        throw CuaError("not_found", "App has no windows")
    }

    static func windowAction(_ p: JSON) throws -> JSON {
        let wid = p.int("windowId").map { CGWindowID($0) }
        let (w, pid) = try axWindow(windowId: wid, pid: p.int("pid").map { pid_t($0) })
        let action = (p.string("action") ?? "focus").lowercased()
        func set(_ attr: String, _ v: CFTypeRef) -> Bool { AXUIElementSetAttributeValue(w, attr as CFString, v) == .success }
        switch action {
        case "focus", "raise", "activate":
            if let app = NSRunningApplication(processIdentifier: pid) { activate(app) }
            _ = AXUIElementPerformAction(w, kAXRaiseAction as CFString)
            _ = set(kAXMainAttribute, kCFBooleanTrue)
        case "move":
            guard let x = p.double("x"), let y = p.double("y") else { throw CuaError("bad_args", "x, y required") }
            var pt = CGPoint(x: x, y: y)
            guard let v = AXValueCreate(.cgPoint, &pt), set(kAXPositionAttribute, v) else { throw CuaError("action_failed", "Window cannot be moved") }
        case "resize":
            guard let wd = p.double("width"), let ht = p.double("height") else { throw CuaError("bad_args", "width, height required") }
            var sz = CGSize(width: wd, height: ht)
            guard let v = AXValueCreate(.cgSize, &sz), set(kAXSizeAttribute, v) else { throw CuaError("action_failed", "Window cannot be resized") }
        case "set_frame", "frame":
            guard let x = p.double("x"), let y = p.double("y"), let wd = p.double("width"), let ht = p.double("height") else {
                throw CuaError("bad_args", "x, y, width, height required")
            }
            var pt = CGPoint(x: x, y: y)
            var sz = CGSize(width: wd, height: ht)
            if let v = AXValueCreate(.cgPoint, &pt) { _ = set(kAXPositionAttribute, v) }
            if let v = AXValueCreate(.cgSize, &sz) { _ = set(kAXSizeAttribute, v) }
        case "minimize": _ = set(kAXMinimizedAttribute, kCFBooleanTrue)
        case "unminimize", "restore": _ = set(kAXMinimizedAttribute, kCFBooleanFalse)
        case "fullscreen": _ = set("AXFullScreen", kCFBooleanTrue)
        case "exit_fullscreen": _ = set("AXFullScreen", kCFBooleanFalse)
        case "close":
            if let btn = AX.copy(w, kAXCloseButtonAttribute) {
                guard AXUIElementPerformAction(btn as! AXUIElement, kAXPressAction as CFString) == .success else {
                    throw CuaError("action_failed", "Close button did not respond")
                }
            } else { throw CuaError("action_failed", "Window has no close button") }
        default:
            throw CuaError("bad_action", "Unknown window action \(action). Use focus, move, resize, set_frame, minimize, unminimize, fullscreen, exit_fullscreen, close.")
        }
        sleepMs(80)
        return ["ok": true, "action": action, "frame": AX.frame(w).map(rectJSON) ?? NSNull(), "title": AX.string(w, kAXTitleAttribute) ?? ""]
    }

    // MARK: Open

    static func open(_ p: JSON) throws -> JSON {
        guard let target = p.string("target") ?? p.string("url") ?? p.string("path"), !target.isEmpty else {
            throw CuaError("bad_args", "target (URL or file path) is required")
        }
        let url: URL
        if let u = URL(string: target), let scheme = u.scheme, scheme.count > 1 {
            url = u
        } else {
            let path = (target as NSString).expandingTildeInPath
            guard FileManager.default.fileExists(atPath: path) else { throw CuaError("not_found", "No such file: \(path)") }
            url = URL(fileURLWithPath: path)
        }
        let cfg = NSWorkspace.OpenConfiguration()
        cfg.activates = true
        if let appName = p.string("app"), let appUrl = appURL(["app": appName]) {
            _ = try awaitSync(timeout: 20) { try await NSWorkspace.shared.open([url], withApplicationAt: appUrl, configuration: cfg) }
        } else {
            guard NSWorkspace.shared.open(url) else { throw CuaError("action_failed", "Could not open \(target)") }
        }
        return ["ok": true, "opened": url.absoluteString]
    }

    // MARK: Clipboard

    static func clipboard(_ p: JSON) throws -> JSON {
        let pb = NSPasteboard.general
        switch (p.string("action") ?? "get").lowercased() {
        case "get", "read":
            var j: JSON = ["text": pb.string(forType: .string) ?? ""]
            j["types"] = (pb.types ?? []).map { $0.rawValue }.prefix(12).map { $0 }
            if let files = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !files.isEmpty {
                j["files"] = files.map { $0.path }
            }
            j["hasImage"] = pb.canReadItem(withDataConformingToTypes: [NSPasteboard.PasteboardType.png.rawValue, NSPasteboard.PasteboardType.tiff.rawValue])
            return j
        case "set", "write":
            pb.clearContents()
            if let files = p["files"] as? [String], !files.isEmpty {
                pb.writeObjects(files.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) as NSURL })
            } else {
                pb.setString(p.string("text") ?? "", forType: .string)
            }
            return ["ok": true]
        case "clear":
            pb.clearContents()
            return ["ok": true]
        default:
            throw CuaError("bad_args", "action must be get, set, or clear")
        }
    }
}
