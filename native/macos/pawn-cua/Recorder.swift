// Record & Replay: watch what the user does in Mac apps and stream it to Pawn.
//
// While recording, global event monitors see the user's clicks, shortcuts,
// typing and scrolling; NSWorkspace reports app switches. Each action is
// resolved to the accessibility element it hit (role + label + app + window),
// so replay can find the same control again instead of replaying pixels.
//
// Privacy and safety:
// - Pawn's own windows (the pids Pawn passes in) and the agent's synthetic
//   input (tagged with PAWN_EVENT_TAG) are never recorded.
// - Typing is not logged key by key: a field's final value is read through
//   accessibility when the user leaves it. Secure text fields are never read
//   (and macOS delivers no key events at all while secure input is on).
// - A red pill ("Pawn is recording — press Esc twice to stop") stays on every
//   screen while recording; it is excluded from screenshots.
//
// Events: {"event":"rec","data":{kind,...}}; Esc×2 → {"event":"record_stop_request"}.

import Foundation
import AppKit
import ApplicationServices
import Carbon.HIToolbox

enum Recorder {
    static let queue = DispatchQueue(label: "pawn.cua.recorder", qos: .userInitiated)

    // Main-thread state.
    private static var monitors: [Any] = []
    private static var workspaceObserver: NSObjectProtocol?
    private(set) static var active = false

    // Recorder-queue state.
    private static var ignorePids: Set<pid_t> = []
    private static var typing: Typing?
    private static var idleFlush: DispatchWorkItem?
    private static var lastScroll = Date.distantPast
    private static var lastApp: pid_t = 0

    /// A field the user is typing into (flushed as one `input` event).
    private struct Typing {
        let element: AXUIElement?
        let pid: pid_t
        let target: JSON
        let secure: Bool
        var typed: String
        var edited: Bool
    }

    static let maxValue = 300

    private static func onMain(_ fn: () -> Void) {
        if Thread.isMainThread { fn() } else { DispatchQueue.main.sync(execute: fn) }
    }

    // MARK: Start / stop

    static func start(_ p: JSON) throws -> JSON {
        guard AXIsProcessTrusted() else {
            throw CuaError("no_accessibility", "Recording Mac apps needs the Accessibility permission. System Settings → Privacy & Security → Accessibility → enable Pawn.")
        }
        let pids = (p["ignorePids"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.int32Value }
        let pill = p.string("pill") ?? "Pawn is recording — press Esc twice to stop"
        queue.sync {
            ignorePids = Set(pids).union([ProcessInfo.processInfo.processIdentifier])
            typing = nil
            lastApp = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        }
        onMain {
            stopMonitors()
            active = true
            installMonitors()
            Overlay.setRecording(pill)
        }
        // Where the demo starts: the app in front (unless it is Pawn).
        queue.async {
            if let app = NSWorkspace.shared.frontmostApplication, !ignorePids.contains(app.processIdentifier) {
                emitApp(app)
            }
        }
        return ["ok": true, "recording": true]
    }

    /// Flush pending typing, stop listening, remove the pill. Replies after
    /// every event has been written, so the caller can stop reading.
    static func stop() -> JSON {
        onMain {
            active = false
            stopMonitors()
            Overlay.setRecording(nil)
        }
        queue.sync {
            idleFlush?.cancel()
            idleFlush = nil
            flushTyping()
            ignorePids = []
        }
        return ["ok": true, "recording": false]
    }

    // MARK: Monitors (main thread)

    private static func installMonitors() {
        let mouse = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { e in
            guard active, !synthetic(e) else { return }
            let loc = e.cgEvent?.location ?? CGPoint.zero
            let button = e.type == .rightMouseDown ? "right" : e.type == .otherMouseDown ? "middle" : "left"
            let right = e.type == .rightMouseDown || e.modifierFlags.contains(.control)
            let count = e.clickCount
            queue.async { onClick(at: loc, button: right ? "right" : button, clickCount: count) }
        }
        let keys = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { e in
            guard active, !synthetic(e), !e.isARepeat else { return }
            // No key events arrive while a password field has secure input on;
            // this is a second guard for anything that slips through.
            if IsSecureEventInputEnabled() { return }
            let code = Int(e.keyCode)
            let flags = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let chars = e.characters ?? ""
            let bare = e.charactersIgnoringModifiers ?? ""
            queue.async { onKey(code: code, flags: flags, chars: chars, bare: bare) }
        }
        let scroll = NSEvent.addGlobalMonitorForEvents(matching: [.scrollWheel]) { e in
            guard active, !synthetic(e) else { return }
            let dy = e.scrollingDeltaY
            let dx = e.scrollingDeltaX
            guard abs(dy) > 0.5 || abs(dx) > 0.5 else { return }
            let dir = abs(dy) >= abs(dx) ? (dy > 0 ? "up" : "down") : (dx > 0 ? "left" : "right")
            queue.async { onScroll(direction: dir) }
        }
        monitors = [mouse, keys, scroll].compactMap { $0 }
        workspaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: nil
        ) { note in
            guard active, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            queue.async { onActivate(app) }
        }
    }

    private static func stopMonitors() {
        for m in monitors { NSEvent.removeMonitor(m) }
        monitors = []
        if let o = workspaceObserver { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        workspaceObserver = nil
    }

    private static func synthetic(_ e: NSEvent) -> Bool {
        e.cgEvent?.getIntegerValueField(.eventSourceUserData) == PAWN_EVENT_TAG
    }

    // MARK: Resolution (recorder queue)

    private static func pidOf(_ el: AXUIElement) -> pid_t {
        var pid: pid_t = 0
        AXUIElementGetPid(el, &pid)
        return pid
    }

    private static func appInfo(_ pid: pid_t) -> (name: String, bundleId: String) {
        let app = NSRunningApplication(processIdentifier: pid)
        return (app?.localizedName ?? "", app?.bundleIdentifier ?? "")
    }

    private static func windowTitle(of el: AXUIElement) -> String {
        var win: AXUIElement?
        if let w = AX.copy(el, kAXWindowAttribute) { win = (w as! AXUIElement) }
        if win == nil, let w = AX.copy(el, kAXTopLevelUIElementAttribute) { win = (w as! AXUIElement) }
        if win == nil {
            let app = AX.appElement(pidOf(el))
            if let w = AX.copy(app, kAXFocusedWindowAttribute) { win = (w as! AXUIElement) }
        }
        guard let w = win else { return "" }
        return (AX.copy(w, kAXTitleAttribute) as? String) ?? ""
    }

    private static func isSecure(_ role: String, _ subrole: String?) -> Bool {
        role == "AXSecureTextField" || subrole == "AXSecureTextField"
    }

    private static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXSearchField", "AXComboBox", "AXSecureTextField"]
    private static let toggleRoles: Set<String> = ["AXCheckBox", "AXRadioButton", "AXSwitch", "AXToggle"]

    private static func target(_ el: AXUIElement) -> (json: JSON, role: String, secure: Bool, checked: Bool?) {
        var d = AX.describe(el)
        // A click often lands on a label inside the control: prefer an
        // actionable ancestor that names it.
        var node = el
        var hops = 0
        while hops < 3, !AX.interactiveRoles.contains(d.role), let parent = AX.copy(node, kAXParentAttribute) {
            let pe = parent as! AXUIElement
            let pd = AX.describe(pe)
            if pd.role == "AXWindow" || pd.role == "AXApplication" || pd.role == "AXWebArea" { break }
            if AX.interactiveRoles.contains(pd.role) {
                if d.label.isEmpty || pd.label.isEmpty == false {
                    node = pe
                    d = pd
                }
                break
            }
            node = pe
            hops += 1
            if !d.label.isEmpty { break }
        }
        let secure = isSecure(d.role, d.subrole)
        // NSSecureTextField reports AXTextField + subrole AXSecureTextField.
        var j: JSON = ["role": secure ? "AXSecureTextField" : d.role]
        if !d.label.isEmpty { j["label"] = AX.clip(d.label, 120) }
        if let ident = AX.copy(node, kAXIdentifierAttribute) as? String, ident.count < 60, !ident.hasPrefix("_NS:") { j["id"] = ident }
        if let ph = AX.copy(node, kAXPlaceholderValueAttribute) as? String, !ph.isEmpty { j["placeholder"] = AX.clip(ph, 120) }
        let checked: Bool? = toggleRoles.contains(d.role) ? d.states.contains("checked") : nil
        return (j, d.role, secure, checked)
    }

    private static func base(_ kind: String, pid: pid_t, window: String) -> JSON {
        let a = appInfo(pid)
        var j: JSON = ["kind": kind]
        if !a.name.isEmpty { j["app"] = a.name }
        if !a.bundleId.isEmpty { j["bundleId"] = a.bundleId }
        if !window.isEmpty, window != a.name { j["window"] = AX.clip(window, 160) }
        return j
    }

    private static func emit(_ data: JSON) {
        Output.shared.send(["event": "rec", "data": data])
    }

    private static func emitApp(_ app: NSRunningApplication) {
        lastApp = app.processIdentifier
        let win = (AX.copy(AX.appElement(app.processIdentifier), kAXFocusedWindowAttribute)).flatMap { AX.copy($0 as! AXUIElement, kAXTitleAttribute) as? String } ?? ""
        emit(base("app", pid: app.processIdentifier, window: win))
    }

    // MARK: Handlers (recorder queue)

    private static func onClick(at p: CGPoint, button: String, clickCount: Int) {
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(AX.systemWide, Float(p.x), Float(p.y), &hit) == .success, let el = hit else {
            // No accessibility info (games, canvases): still note the click happened.
            if let app = NSWorkspace.shared.frontmostApplication, !ignorePids.contains(app.processIdentifier) {
                flushTyping()
                var j = base("click", pid: app.processIdentifier, window: "")
                j["button"] = button
                j["clickCount"] = clickCount
                emit(j)
            }
            return
        }
        let pid = pidOf(el)
        if ignorePids.contains(pid) { return }
        AX.enableRichAccessibility(pid)
        let t = target(el)
        // Clicking back into the field being typed in keeps the edit going.
        if let cur = typing, let ce = cur.element, CFEqual(ce, el) { return }
        flushTyping()
        var j = base("click", pid: pid, window: windowTitle(of: el))
        j["target"] = t.json
        j["button"] = button
        j["clickCount"] = clickCount
        if t.checked != nil {
            // The toggle flips after the click is handled: read the new state.
            usleep(220_000)
            j["checked"] = AX.describe(el).states.contains("checked")
        }
        emit(j)
        if textRoles.contains(t.role) {
            typing = Typing(element: el, pid: pid, target: t.json, secure: t.secure, typed: "", edited: false)
        }
    }

    private static let specialKeys: [Int: String] = [
        kVK_Return: "Enter", kVK_ANSI_KeypadEnter: "Enter", kVK_Tab: "Tab", kVK_Escape: "Escape",
        kVK_Delete: "Backspace", kVK_ForwardDelete: "Delete", kVK_LeftArrow: "Left", kVK_RightArrow: "Right",
        kVK_UpArrow: "Up", kVK_DownArrow: "Down", kVK_Home: "Home", kVK_End: "End", kVK_PageUp: "PageUp",
        kVK_PageDown: "PageDown", kVK_Space: "Space", kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4",
        kVK_F5: "F5", kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12"
    ]

    private static func focused() -> AXUIElement? {
        guard let f = AX.copy(AX.systemWide, kAXFocusedUIElementAttribute) else { return nil }
        return (f as! AXUIElement)
    }

    private static func onKey(code: Int, flags: NSEvent.ModifierFlags, chars: String, bare: String) {
        let front = NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        if ignorePids.contains(front) { return }
        let cmd = flags.contains(.command), ctrl = flags.contains(.control), alt = flags.contains(.option), shift = flags.contains(.shift)
        let special = specialKeys[code]

        // Shortcuts: record the combo (⌘Tab is an app switch, seen separately).
        if cmd || ctrl {
            if cmd && code == kVK_Tab { return }
            var parts: [String] = []
            if cmd { parts.append("cmd") }
            if ctrl { parts.append("ctrl") }
            if alt { parts.append("alt") }
            if shift { parts.append("shift") }
            let key = special ?? bare.lowercased()
            guard !key.isEmpty else { return }
            // Paste / cut / undo change the field: keep the edit open.
            if cmd && ["v", "x", "z"].contains(key), typing != nil { typing?.edited = true; scheduleFlush(); return }
            flushTyping()
            var j = base("key", pid: front, window: "")
            j["key"] = (parts + [key]).joined(separator: "+")
            emit(j)
            return
        }

        if let s = special, !["Space", "Backspace", "Delete", "Left", "Right", "Up", "Down", "Home", "End"].contains(s) {
            // Enter / Tab / Escape end an edit and are steps themselves.
            let field = typing?.target
            flushTyping()
            if s == "Tab" && field != nil { return }
            if s.hasPrefix("F") || s == "PageUp" || s == "PageDown" || s == "Enter" || s == "Escape" || s == "Tab" {
                var j = base("key", pid: front, window: "")
                j["key"] = s
                if let f = field, s == "Enter" { j["target"] = f }
                emit(j)
            }
            return
        }

        // Typing: attribute it to the focused element; read its value later.
        let el = focused()
        if let cur = typing {
            let same: Bool = { if let a = cur.element, let b = el { return CFEqual(a, b) }; return cur.element == nil && el == nil }()
            if !same { flushTyping() }
        }
        if typing == nil {
            if let el = el {
                let pid = pidOf(el)
                if ignorePids.contains(pid) { return }
                let t = target(el)
                typing = Typing(element: el, pid: pid, target: t.json, secure: t.secure, typed: "", edited: false)
            } else {
                typing = Typing(element: nil, pid: front, target: [:], secure: false, typed: "", edited: false)
            }
        }
        typing?.edited = true
        if typing?.secure == false {
            if special == "Backspace" || special == "Delete" {
                if typing?.typed.isEmpty == false { typing?.typed.removeLast() }
            } else if special == "Space" {
                typing?.typed.append(" ")
            } else if special == nil, !chars.isEmpty, chars.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) {
                if (typing?.typed.count ?? 0) < maxValue * 2 { typing?.typed.append(chars) }
            }
        }
        scheduleFlush()
    }

    private static func scheduleFlush() {
        idleFlush?.cancel()
        let item = DispatchWorkItem { flushTyping() }
        idleFlush = item
        queue.asyncAfter(deadline: .now() + 1.5, execute: item)
    }

    /// Emit the pending edit: the field's value (read through accessibility),
    /// or what was typed when the value is unreadable or huge (terminals).
    private static func flushTyping() {
        idleFlush?.cancel()
        idleFlush = nil
        guard let cur = typing else { return }
        typing = nil
        if cur.secure {
            // No key events reach us while secure input is on; the field's
            // (masked) value only tells whether something was entered.
            let masked = cur.element.flatMap { AX.describe($0).value } ?? ""
            guard cur.edited || !masked.isEmpty else { return }
            var j = base("input", pid: cur.pid, window: cur.element.map { windowTitle(of: $0) } ?? "")
            if !cur.target.isEmpty { j["target"] = cur.target }
            j["secret"] = true
            emit(j)
            return
        }
        guard cur.edited else { return }
        let window = cur.element.map { windowTitle(of: $0) } ?? ""
        var j = base("input", pid: cur.pid, window: window)
        if !cur.target.isEmpty { j["target"] = cur.target }
        var value: String?
        if let el = cur.element {
            let d = AX.describe(el)
            if isSecure(d.role, d.subrole) {
                j["secret"] = true
                emit(j)
                return
            }
            if let v = d.value, v.count <= maxValue { value = v }
        }
        if value == nil {
            let typed = cur.typed.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !typed.isEmpty else { return }
            value = typed
        }
        j["value"] = value
        emit(j)
    }

    private static func onScroll(direction: String) {
        let now = Date()
        guard now.timeIntervalSince(lastScroll) > 1.2 else { return }
        lastScroll = now
        guard let app = NSWorkspace.shared.frontmostApplication, !ignorePids.contains(app.processIdentifier) else { return }
        var j = base("scroll", pid: app.processIdentifier, window: "")
        j["direction"] = direction
        emit(j)
    }

    /// System processes that take focus in passing (not a user's app switch).
    private static let transientApps: Set<String> = [
        "com.apple.loginwindow", "com.apple.dock", "com.apple.systemuiserver", "com.apple.controlcenter",
        "com.apple.notificationcenterui", "com.apple.WindowManager", "com.apple.UserNotificationCenter"
    ]

    private static func onActivate(_ app: NSRunningApplication) {
        flushTyping()
        let pid = app.processIdentifier
        if transientApps.contains(app.bundleIdentifier ?? "") || app.activationPolicy == .prohibited { return }
        if ignorePids.contains(pid) || pid == lastApp { lastApp = pid; return }
        emitApp(app)
    }
}
