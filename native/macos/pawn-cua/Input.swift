// Mouse + keyboard synthesis with CGEvent (HID-level, works in every app).
//
// - Clicks carry a proper click-state so double/triple clicks select words/lines.
// - Modifiers are applied as event flags for the duration of one action.
// - Text is typed as Unicode key events (any language, emoji) with the input
//   method temporarily switched to an ASCII layout so IMEs (Korean, Japanese,
//   Chinese) cannot re-compose the synthetic keystrokes.
// - Key events can be delivered to one pid (background typing, no focus change).

import Foundation
import CoreGraphics
import Carbon.HIToolbox
import AppKit

enum Input {
    static let source: CGEventSource? = {
        let s = CGEventSource(stateID: .hidSystemState)
        s?.localEventsSuppressionInterval = 0
        return s
    }()

    // MARK: Modifiers

    static func flags(_ names: [String]) throws -> CGEventFlags {
        var f: CGEventFlags = []
        for raw in names {
            let n = raw.lowercased().trimmingCharacters(in: .whitespaces)
            if n.isEmpty { continue }
            switch n {
            case "cmd", "command", "super", "meta", "win", "windows", "⌘", "super_l", "super_r", "cmd_l", "cmd_r":
                f.insert(.maskCommand)
            case "ctrl", "control", "⌃", "control_l", "control_r", "ctrl_l", "ctrl_r":
                f.insert(.maskControl)
            case "alt", "option", "opt", "⌥", "alt_l", "alt_r":
                f.insert(.maskAlternate)
            case "shift", "⇧", "shift_l", "shift_r":
                f.insert(.maskShift)
            case "fn", "function":
                f.insert(.maskSecondaryFn)
            default:
                throw CuaError("bad_modifier", "Unknown modifier \"\(raw)\". Use cmd, ctrl, alt, shift, fn.")
            }
        }
        return f
    }

    static let modifierKeys: [(CGEventFlags, CGKeyCode)] = [
        (.maskCommand, CGKeyCode(kVK_Command)),
        (.maskControl, CGKeyCode(kVK_Control)),
        (.maskAlternate, CGKeyCode(kVK_Option)),
        (.maskShift, CGKeyCode(kVK_Shift)),
        (.maskSecondaryFn, CGKeyCode(kVK_Function))
    ]

    // MARK: Key names

    static let named: [String: Int] = [
        "return": kVK_Return, "enter": kVK_Return, "kpenter": kVK_ANSI_KeypadEnter,
        "tab": kVK_Tab, "space": kVK_Space, " ": kVK_Space,
        "backspace": kVK_Delete, "delete": kVK_Delete, "back": kVK_Delete,
        "forwarddelete": kVK_ForwardDelete, "del": kVK_ForwardDelete,
        "escape": kVK_Escape, "esc": kVK_Escape,
        "command": kVK_Command, "cmd": kVK_Command, "super": kVK_Command, "superl": kVK_Command,
        "shift": kVK_Shift, "shiftl": kVK_Shift, "shiftr": kVK_RightShift,
        "capslock": kVK_CapsLock, "option": kVK_Option, "alt": kVK_Option, "altl": kVK_Option,
        "altr": kVK_RightOption, "control": kVK_Control, "ctrl": kVK_Control, "controll": kVK_Control,
        "controlr": kVK_RightControl, "fn": kVK_Function, "function": kVK_Function,
        "home": kVK_Home, "end": kVK_End, "pageup": kVK_PageUp, "pagedown": kVK_PageDown,
        "prior": kVK_PageUp, "next": kVK_PageDown,
        "left": kVK_LeftArrow, "right": kVK_RightArrow, "up": kVK_UpArrow, "down": kVK_DownArrow,
        "arrowleft": kVK_LeftArrow, "arrowright": kVK_RightArrow, "arrowup": kVK_UpArrow, "arrowdown": kVK_DownArrow,
        "help": kVK_Help, "insert": kVK_Help,
        "volumeup": kVK_VolumeUp, "volumedown": kVK_VolumeDown, "mute": kVK_Mute,
        "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6,
        "f7": kVK_F7, "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12,
        "f13": kVK_F13, "f14": kVK_F14, "f15": kVK_F15, "f16": kVK_F16, "f17": kVK_F17,
        "f18": kVK_F18, "f19": kVK_F19, "f20": kVK_F20,
        // xdotool / X11 keysym spellings the models were trained on
        "minus": kVK_ANSI_Minus, "equal": kVK_ANSI_Equal, "plus": kVK_ANSI_Equal,
        "comma": kVK_ANSI_Comma, "period": kVK_ANSI_Period, "slash": kVK_ANSI_Slash,
        "backslash": kVK_ANSI_Backslash, "semicolon": kVK_ANSI_Semicolon,
        "apostrophe": kVK_ANSI_Quote, "quote": kVK_ANSI_Quote, "grave": kVK_ANSI_Grave,
        "bracketleft": kVK_ANSI_LeftBracket, "bracketright": kVK_ANSI_RightBracket
    ]

    /// Char → (keycode, needsShift) for the current ASCII-capable layout (hotkeys
    /// must use the physical key that produces the character on this layout).
    static var charMap: [Character: (CGKeyCode, Bool)] = buildCharMap()
    static var charMapBuiltAt = Date()

    static func buildCharMap() -> [Character: (CGKeyCode, Bool)] {
        var map: [Character: (CGKeyCode, Bool)] = [:]
        guard let src = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue(),
              let ptr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData) else {
            return usAnsiMap()
        }
        let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard let base = raw.baseAddress else { return }
            let layout = base.assumingMemoryBound(to: UCKeyboardLayout.self)
            for shift in [false, true] {
                for code in 0..<128 {
                    var dead: UInt32 = 0
                    var len = 0
                    var chars = [UniChar](repeating: 0, count: 4)
                    let mod: UInt32 = shift ? UInt32((shiftKey >> 8) & 0xFF) : 0
                    let status = UCKeyTranslate(
                        layout, UInt16(code), UInt16(kUCKeyActionDown), mod, UInt32(LMGetKbdType()),
                        OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
                    guard status == noErr, len > 0 else { continue }
                    let s = String(utf16CodeUnits: chars, count: len)
                    guard let ch = s.first, s.count == 1, !ch.isNewline else { continue }
                    if map[ch] == nil { map[ch] = (CGKeyCode(code), shift) }
                }
            }
        }
        return map.isEmpty ? usAnsiMap() : map
    }

    static func usAnsiMap() -> [Character: (CGKeyCode, Bool)] {
        let base: [(String, Int)] = [
            ("a", kVK_ANSI_A), ("b", kVK_ANSI_B), ("c", kVK_ANSI_C), ("d", kVK_ANSI_D), ("e", kVK_ANSI_E),
            ("f", kVK_ANSI_F), ("g", kVK_ANSI_G), ("h", kVK_ANSI_H), ("i", kVK_ANSI_I), ("j", kVK_ANSI_J),
            ("k", kVK_ANSI_K), ("l", kVK_ANSI_L), ("m", kVK_ANSI_M), ("n", kVK_ANSI_N), ("o", kVK_ANSI_O),
            ("p", kVK_ANSI_P), ("q", kVK_ANSI_Q), ("r", kVK_ANSI_R), ("s", kVK_ANSI_S), ("t", kVK_ANSI_T),
            ("u", kVK_ANSI_U), ("v", kVK_ANSI_V), ("w", kVK_ANSI_W), ("x", kVK_ANSI_X), ("y", kVK_ANSI_Y),
            ("z", kVK_ANSI_Z), ("0", kVK_ANSI_0), ("1", kVK_ANSI_1), ("2", kVK_ANSI_2), ("3", kVK_ANSI_3),
            ("4", kVK_ANSI_4), ("5", kVK_ANSI_5), ("6", kVK_ANSI_6), ("7", kVK_ANSI_7), ("8", kVK_ANSI_8),
            ("9", kVK_ANSI_9), ("-", kVK_ANSI_Minus), ("=", kVK_ANSI_Equal), ("[", kVK_ANSI_LeftBracket),
            ("]", kVK_ANSI_RightBracket), ("\\", kVK_ANSI_Backslash), (";", kVK_ANSI_Semicolon),
            ("'", kVK_ANSI_Quote), (",", kVK_ANSI_Comma), (".", kVK_ANSI_Period), ("/", kVK_ANSI_Slash),
            ("`", kVK_ANSI_Grave)
        ]
        var m: [Character: (CGKeyCode, Bool)] = [:]
        for (s, c) in base { m[Character(s)] = (CGKeyCode(c), false) }
        return m
    }

    /// Resolve a key name or single character to (keycode, extra shift).
    static func resolveKey(_ raw: String) throws -> (CGKeyCode, Bool) {
        if Date().timeIntervalSince(charMapBuiltAt) > 30 {
            charMap = buildCharMap()
            charMapBuiltAt = Date()
        }
        if raw.count == 1, let ch = raw.first {
            if let hit = charMap[ch] { return hit }
            if let hit = charMap[Character(ch.lowercased())] { return (hit.0, ch.isUppercase || hit.1) }
        }
        let norm = raw.lowercased().replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "-", with: "")
        if let code = named[norm] { return (CGKeyCode(code), false) }
        if norm.hasPrefix("kp"), norm.count == 3, let d = Int(norm.suffix(1)) {
            let pad = [kVK_ANSI_Keypad0, kVK_ANSI_Keypad1, kVK_ANSI_Keypad2, kVK_ANSI_Keypad3, kVK_ANSI_Keypad4,
                       kVK_ANSI_Keypad5, kVK_ANSI_Keypad6, kVK_ANSI_Keypad7, kVK_ANSI_Keypad8, kVK_ANSI_Keypad9]
            return (CGKeyCode(pad[d]), false)
        }
        throw CuaError("bad_key", "Unknown key \"\(raw)\". Use names like Return, Tab, Escape, BackSpace, Left, Page_Down, F5, or a single character.")
    }

    /// "cmd+shift+t" → (flags, keycode). The last token is the key; a lone
    /// modifier ("shift") is a key press of that modifier.
    static func parseCombo(_ combo: String) throws -> (CGEventFlags, CGKeyCode) {
        let trimmed = combo.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { throw CuaError("bad_key", "key is required") }
        var parts = trimmed == "+" ? ["+"] : trimmed.split(separator: "+", omittingEmptySubsequences: true).map(String.init)
        if trimmed.hasSuffix("++") { parts.append("+") }
        let keyName = parts.removeLast()
        var f = try flags(parts)
        let (code, shift) = try resolveKey(keyName)
        if shift { f.insert(.maskShift) }
        return (f, code)
    }

    // MARK: Posting

    static func post(_ e: CGEvent, pid: pid_t?) {
        e.setIntegerValueField(.eventSourceUserData, value: PAWN_EVENT_TAG)
        if let pid = pid, pid > 0 { e.postToPid(pid) } else { e.post(tap: .cghidEventTap) }
    }

    static func keyEvent(_ code: CGKeyCode, down: Bool, flags: CGEventFlags, pid: pid_t?) {
        guard let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
        e.flags = flags
        post(e, pid: pid)
    }

    static func pressModifiers(_ f: CGEventFlags, down: Bool, pid: pid_t?) {
        var acc: CGEventFlags = down ? [] : f
        let keys = down ? modifierKeys : modifierKeys.reversed()
        for (flag, code) in keys where f.contains(flag) {
            if down { acc.insert(flag) } else { acc.remove(flag) }
            keyEvent(code, down: down, flags: acc, pid: pid)
            sleepMs(4)
        }
    }

    static func keyCombo(_ combo: String, repeatCount: Int, pid: pid_t?) throws {
        let (f, code) = try parseCombo(combo)
        let n = max(1, min(repeatCount, 100))
        pressModifiers(f, down: true, pid: pid)
        for i in 0..<n {
            keyEvent(code, down: true, flags: f, pid: pid)
            sleepMs(8)
            keyEvent(code, down: false, flags: f, pid: pid)
            if i < n - 1 { sleepMs(18) }
        }
        pressModifiers(f, down: false, pid: pid)
    }

    static var heldKeys: [String: (CGEventFlags, CGKeyCode, pid_t?)] = [:]

    static func keyDown(_ combo: String, pid: pid_t?) throws {
        let (f, code) = try parseCombo(combo)
        pressModifiers(f, down: true, pid: pid)
        keyEvent(code, down: true, flags: f, pid: pid)
        heldKeys[combo.lowercased()] = (f, code, pid)
    }

    static func keyUp(_ combo: String, pid: pid_t?) throws {
        let key = combo.lowercased()
        let (f, code, p) = try heldKeys[key] ?? { let (a, b) = try parseCombo(combo); return (a, b, pid) }()
        keyEvent(code, down: false, flags: f, pid: p)
        pressModifiers(f, down: false, pid: p)
        heldKeys.removeValue(forKey: key)
    }

    static func releaseAllHeld() {
        for (combo, _) in heldKeys { try? keyUp(combo, pid: nil) }
        heldKeys.removeAll()
        for button in mouseHeld { postButton(button, down: false, at: cursor(), clickState: 1, flags: []) }
        mouseHeld.removeAll()
    }

    // MARK: Text

    /// True when the selected input source is an input method (IME) rather than a plain layout.
    static func withAsciiInputSource<T>(_ body: () throws -> T) rethrows -> T {
        guard let current = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue() else { return try body() }
        let typeRef = TISGetInputSourceProperty(current, kTISPropertyInputSourceType)
        let type = typeRef.map { Unmanaged<CFString>.fromOpaque($0).takeUnretainedValue() as String } ?? ""
        let isLayout = type == (kTISTypeKeyboardLayout as String)
        guard !isLayout, let ascii = TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue() else {
            return try body()
        }
        TISSelectInputSource(ascii)
        sleepMs(40)
        defer {
            TISSelectInputSource(current)
        }
        return try body()
    }

    /// Type text as Unicode key events. Newlines/tabs are real Return/Tab presses.
    static func typeText(_ text: String, pid: pid_t?, delayMs: Double) {
        withAsciiInputSource {
            var buffer: [UniChar] = []
            func flush() {
                guard !buffer.isEmpty else { return }
                // One grapheme per event pair: the most compatible form (some apps
                // read only the first unit of a multi-character event).
                guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                      let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                    buffer.removeAll()
                    return
                }
                down.flags = []
                up.flags = []
                buffer.withUnsafeBufferPointer { p in
                    down.keyboardSetUnicodeString(stringLength: p.count, unicodeString: p.baseAddress)
                    up.keyboardSetUnicodeString(stringLength: p.count, unicodeString: p.baseAddress)
                }
                post(down, pid: pid)
                post(up, pid: pid)
                buffer.removeAll()
                sleepMs(delayMs)
            }
            for ch in text {
                if ch == "\n" || ch == "\r\n" || ch == "\r" {
                    flush()
                    keyEvent(CGKeyCode(kVK_Return), down: true, flags: [], pid: pid)
                    keyEvent(CGKeyCode(kVK_Return), down: false, flags: [], pid: pid)
                    sleepMs(max(delayMs, 12))
                    continue
                }
                if ch == "\t" {
                    flush()
                    keyEvent(CGKeyCode(kVK_Tab), down: true, flags: [], pid: pid)
                    keyEvent(CGKeyCode(kVK_Tab), down: false, flags: [], pid: pid)
                    sleepMs(max(delayMs, 8))
                    continue
                }
                buffer.append(contentsOf: Array(String(ch).utf16))
                flush()
            }
            flush()
        }
    }

    // MARK: Mouse

    static var mouseHeld: Set<String> = []

    static func cursor() -> CGPoint {
        CGEvent(source: nil)?.location ?? .zero
    }

    static func button(_ raw: String?) -> String {
        switch (raw ?? "left").lowercased() {
        case "right", "secondary", "2": return "right"
        case "middle", "center", "3", "wheel": return "middle"
        default: return "left"
        }
    }

    static func postButton(_ b: String, down: Bool, at p: CGPoint, clickState: Int, flags: CGEventFlags) {
        let type: CGEventType
        let cgButton: CGMouseButton
        switch b {
        case "right":
            type = down ? .rightMouseDown : .rightMouseUp
            cgButton = .right
        case "middle":
            type = down ? .otherMouseDown : .otherMouseUp
            cgButton = .center
        default:
            type = down ? .leftMouseDown : .leftMouseUp
            cgButton = .left
        }
        guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: cgButton) else { return }
        e.setIntegerValueField(.mouseEventClickState, value: Int64(max(1, clickState)))
        e.flags = flags
        post(e, pid: nil)
    }

    static func move(to p: CGPoint, flags: CGEventFlags = [], smooth: Bool = false) {
        if smooth {
            let from = cursor()
            let dist = hypot(p.x - from.x, p.y - from.y)
            let steps = max(1, min(24, Int(dist / 40)))
            if steps > 1 {
                for i in 1..<steps {
                    let t = Double(i) / Double(steps)
                    let e2 = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
                    moveRaw(CGPoint(x: from.x + (p.x - from.x) * e2, y: from.y + (p.y - from.y) * e2), flags: flags)
                    sleepMs(6)
                }
            }
        }
        moveRaw(p, flags: flags)
    }

    static func moveRaw(_ p: CGPoint, flags: CGEventFlags) {
        let dragging = mouseHeld.first
        let type: CGEventType
        let b: CGMouseButton
        switch dragging {
        case "left": type = .leftMouseDragged; b = .left
        case "right": type = .rightMouseDragged; b = .right
        case "middle": type = .otherMouseDragged; b = .center
        default: type = .mouseMoved; b = .left
        }
        guard let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: p, mouseButton: b) else { return }
        e.flags = flags
        post(e, pid: nil)
    }

    static func click(at p: CGPoint?, button b: String, count: Int, flags: CGEventFlags) {
        let target = p ?? cursor()
        if p != nil {
            move(to: target, flags: flags, smooth: false)
            sleepMs(25)
        }
        let n = max(1, min(count, 3))
        if !flags.isEmpty { pressModifiers(flags, down: true, pid: nil) }
        for i in 1...n {
            postButton(b, down: true, at: target, clickState: i, flags: flags)
            sleepMs(14)
            postButton(b, down: false, at: target, clickState: i, flags: flags)
            if i < n { sleepMs(45) }
        }
        if !flags.isEmpty { pressModifiers(flags, down: false, pid: nil) }
    }

    static func mouseButton(_ b: String, down: Bool, at p: CGPoint?, flags: CGEventFlags) {
        let target = p ?? cursor()
        if let p = p { move(to: p, flags: flags) ; sleepMs(15) }
        postButton(b, down: down, at: target, clickState: 1, flags: flags)
        if down { mouseHeld.insert(b) } else { mouseHeld.remove(b) }
    }

    static func drag(path: [CGPoint], button b: String, flags: CGEventFlags, durationMs: Double) {
        guard let first = path.first else { return }
        move(to: first, flags: flags)
        sleepMs(30)
        if !flags.isEmpty { pressModifiers(flags, down: true, pid: nil) }
        postButton(b, down: true, at: first, clickState: 1, flags: flags)
        mouseHeld.insert(b)
        sleepMs(60)
        // Interpolate so apps see a continuous gesture (drag thresholds, DnD).
        var points: [CGPoint] = []
        let segments = max(1, path.count - 1)
        let totalSteps = max(8, min(120, Int(durationMs / 8)))
        let perSegment = max(2, totalSteps / segments)
        for s in 0..<segments {
            let a = path[min(s, path.count - 1)]
            let c = path[min(s + 1, path.count - 1)]
            for i in 1...perSegment {
                let t = Double(i) / Double(perSegment)
                points.append(CGPoint(x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t))
            }
        }
        let stepDelay = max(2, durationMs / Double(max(1, points.count)))
        for pt in points {
            moveRaw(pt, flags: flags)
            sleepMs(stepDelay)
        }
        let last = path.last ?? first
        sleepMs(40)
        postButton(b, down: false, at: last, clickState: 1, flags: flags)
        mouseHeld.remove(b)
        if !flags.isEmpty { pressModifiers(flags, down: false, pid: nil) }
    }

    /// dy > 0 scrolls down (content moves up), dx > 0 scrolls right. Units are
    /// wheel notches (≈3 lines each) or pixels.
    static func scroll(at p: CGPoint?, dx: Double, dy: Double, pixels: Bool, flags: CGEventFlags) {
        if let p = p {
            move(to: p, flags: [])
            sleepMs(20)
        }
        if pixels {
            if let e = CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2,
                               wheel1: Int32(clamping: Int(-dy.rounded())), wheel2: Int32(clamping: Int(-dx.rounded())), wheel3: 0) {
                e.flags = flags
                post(e, pid: nil)
            }
            return
        }
        let notchesY = Int(dy.rounded())
        let notchesX = Int(dx.rounded())
        let n = min(50, max(abs(notchesY), abs(notchesX)))
        for i in 0..<n {
            let wy: Int32 = i < abs(notchesY) ? (notchesY > 0 ? -3 : 3) : 0
            let wx: Int32 = i < abs(notchesX) ? (notchesX > 0 ? -3 : 3) : 0
            if let e = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: wy, wheel2: wx, wheel3: 0) {
                e.flags = flags
                post(e, pid: nil)
            }
            sleepMs(12)
        }
    }
}
