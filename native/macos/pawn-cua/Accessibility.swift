// Accessibility (AX) tree snapshots and element actions.
//
// Snapshots return a compact outline of the UI with numbered interactive
// elements. The numbers stay valid across snapshots (monotonic ids) until the
// element disappears, so the agent can act by element instead of by pixel:
// press a button, set a text field, pick a menu item — precise, resolution
// independent, and it works on windows that are covered by other windows.

import Foundation
import AppKit
import ApplicationServices

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

enum AX {
    static let systemWide: AXUIElement = {
        let s = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(s, 1.5)
        return s
    }()

    // MARK: Element store

    private static var nextId = 1
    private static var store: [Int: AXUIElement] = [:]
    private static var order: [Int] = []
    private static let storeCap = 6000

    static func remember(_ el: AXUIElement) -> Int {
        // Re-use the id for an element we already know (CFEqual identity).
        if let hit = store.first(where: { CFEqual($0.value, el) }) { return hit.key }
        let id = nextId
        nextId += 1
        store[id] = el
        order.append(id)
        if order.count > storeCap {
            let drop = order.prefix(order.count - storeCap)
            for d in drop { store.removeValue(forKey: d) }
            order.removeFirst(drop.count)
        }
        return id
    }

    static func element(_ id: Int) throws -> AXUIElement {
        guard let el = store[id] else {
            throw CuaError("stale_element", "Element [\(id)] is unknown or expired. Take a new ui snapshot.")
        }
        var role: CFTypeRef?
        if AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role) == .invalidUIElement {
            store.removeValue(forKey: id)
            throw CuaError("stale_element", "Element [\(id)] no longer exists. Take a new ui snapshot.")
        }
        return el
    }

    // MARK: Attributes

    static func copy(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success ? v : nil
    }

    static func string(_ el: AXUIElement, _ attr: String) -> String? {
        guard let v = copy(el, attr) else { return nil }
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        if let a = v as? NSAttributedString { return a.string }
        return nil
    }

    static func bool(_ el: AXUIElement, _ attr: String) -> Bool? {
        (copy(el, attr) as? NSNumber)?.boolValue
    }

    static func frame(_ el: AXUIElement) -> CGRect? {
        guard let pv = copy(el, kAXPositionAttribute), let sv = copy(el, kAXSizeAttribute) else { return nil }
        var p = CGPoint.zero
        var s = CGSize.zero
        guard CFGetTypeID(pv) == AXValueGetTypeID(), CFGetTypeID(sv) == AXValueGetTypeID() else { return nil }
        AXValueGetValue(pv as! AXValue, .cgPoint, &p)
        AXValueGetValue(sv as! AXValue, .cgSize, &s)
        let r = CGRect(origin: p, size: s)
        return r.width.isFinite && r.height.isFinite ? r : nil
    }

    static func children(_ el: AXUIElement, role: String) -> [AXUIElement] {
        // Long lists/tables: only what is visible.
        if role == "AXTable" || role == "AXOutline" || role == "AXList" {
            if let rows = copy(el, "AXVisibleRows") as? [AXUIElement], !rows.isEmpty { return rows }
        }
        if let v = copy(el, "AXVisibleChildren") as? [AXUIElement], !v.isEmpty { return v }
        return copy(el, kAXChildrenAttribute) as? [AXUIElement] ?? []
    }

    static func actions(_ el: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] else { return [] }
        return arr
    }

    static func pid(_ el: AXUIElement) -> pid_t {
        var p: pid_t = 0
        AXUIElementGetPid(el, &p)
        return p
    }

    static func windowId(_ el: AXUIElement) -> CGWindowID? {
        var id: CGWindowID = 0
        return _AXUIElementGetWindow(el, &id) == .success && id != 0 ? id : nil
    }

    static func appElement(_ pid: pid_t) -> AXUIElement {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.5)
        return app
    }

    /// Chromium/Electron apps only build their AX tree when asked to.
    static var enhanced: Set<pid_t> = []
    static func enableRichAccessibility(_ pid: pid_t) {
        guard !enhanced.contains(pid) else { return }
        let app = appElement(pid)
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        enhanced.insert(pid)
    }

    // MARK: Snapshot

    static let interactiveRoles: Set<String> = [
        "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXComboBox",
        "AXTextField", "AXTextArea", "AXSecureTextField", "AXSearchField", "AXSlider", "AXIncrementor",
        "AXLink", "AXMenuItem", "AXMenuBarItem", "AXDisclosureTriangle", "AXColorWell", "AXSwitch",
        "AXStepper", "AXDockItem", "AXTab", "AXToggle", "AXRow", "AXCell", "AXSegment", "AXDateField",
        "AXTimeField", "AXLevelIndicator", "AXScrollBar"
    ]
    static let textRoles: Set<String> = ["AXStaticText", "AXHeading", "AXText"]
    static let expandableRoles: Set<String> = ["AXDisclosureTriangle", "AXRow", "AXComboBox", "AXPopUpButton", "AXMenuButton", "AXOutlineRow"]
    static let containerRoles: Set<String> = [
        "AXWindow", "AXSheet", "AXDialog", "AXToolbar", "AXTabGroup", "AXWebArea", "AXMenuBar", "AXMenu",
        "AXPopover", "AXDrawer", "AXSplitGroup", "AXForm"
    ]

    struct SnapshotOptions {
        var maxNodes = 350
        var maxDepth = 60
        var includeText = true
        var interactiveOnly = false
        var query: String?
        var bounds: CGRect?     // only elements intersecting this global rect
    }

    struct Node {
        let id: Int?
        let depth: Int
        let role: String
        let subrole: String?
        let label: String
        let value: String?
        let frame: CGRect?
        let states: [String]
        let actions: [String]

        var line: String {
            var s = String(repeating: "  ", count: depth)
            if let id = id { s += "[\(id)] " }
            s += shortRole
            if !label.isEmpty { s += " \"\(clip(label, 90))\"" }
            if let v = value, !v.isEmpty, v != label { s += " = \"\(clip(v, 120))\"" }
            if let f = frame {
                s += " @(\(Int(f.midX)),\(Int(f.midY)) \(Int(f.width))x\(Int(f.height)))"
            }
            if !states.isEmpty { s += " {\(states.joined(separator: ","))}" }
            return s
        }

        var shortRole: String {
            var r = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
            if let sub = subrole, sub == "AXSearchField" { r = "SearchField" }
            if let sub = subrole, sub == "AXCloseButton" || sub == "AXMinimizeButton" || sub == "AXZoomButton" || sub == "AXFullScreenButton" {
                r = String(sub.dropFirst(2))
            }
            return r.lowercased()
        }

        var json: JSON {
            var j: JSON = ["role": role, "label": label, "depth": depth]
            if let id = id { j["id"] = id }
            if let s = subrole { j["subrole"] = s }
            if let v = value { j["value"] = v }
            if let f = frame { j["frame"] = rectJSON(f); j["center"] = ["x": num(f.midX), "y": num(f.midY)] }
            if !states.isEmpty { j["states"] = states }
            if !actions.isEmpty { j["actions"] = actions }
            return j
        }
    }

    static func clip(_ s: String, _ n: Int) -> String {
        let one = s.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
        return one.count > n ? String(one.prefix(n - 1)) + "…" : one
    }

    static let batchAttrs = [
        kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
        kAXPositionAttribute, kAXSizeAttribute, kAXEnabledAttribute, kAXFocusedAttribute, kAXChildrenAttribute,
        kAXPlaceholderValueAttribute, kAXIdentifierAttribute, kAXSelectedAttribute, kAXHelpAttribute,
        "AXExpanded", kAXRoleDescriptionAttribute
    ] as [CFString]

    static func describe(_ el: AXUIElement) -> (role: String, subrole: String?, label: String, value: String?, frame: CGRect?, states: [String], children: [AXUIElement]?) {
        var values: CFArray?
        AXUIElementCopyMultipleAttributeValues(el, batchAttrs as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
        let arr = (values as? [Any]) ?? []
        func at(_ i: Int) -> Any? {
            guard i < arr.count else { return nil }
            let v = arr[i]
            // Missing attributes come back as AXValue(kAXValueAXErrorType)
            if CFGetTypeID(v as CFTypeRef) == AXValueGetTypeID(), AXValueGetType(v as! AXValue) == .axError { return nil }
            return v
        }
        func str(_ i: Int) -> String? {
            let v = at(i)
            if let s = v as? String { return s.isEmpty ? nil : s }
            if let a = v as? NSAttributedString { return a.string.isEmpty ? nil : a.string }
            return nil
        }
        let role = str(0) ?? "AXUnknown"
        let subrole = str(1)
        var frame: CGRect?
        if let pv = at(5), let sv = at(6) {
            var p = CGPoint.zero
            var s = CGSize.zero
            if CFGetTypeID(pv as CFTypeRef) == AXValueGetTypeID(), CFGetTypeID(sv as CFTypeRef) == AXValueGetTypeID() {
                AXValueGetValue(pv as! AXValue, .cgPoint, &p)
                AXValueGetValue(sv as! AXValue, .cgSize, &s)
                frame = CGRect(origin: p, size: s)
            }
        }
        var valueStr: String?
        let rawValue = at(4)
        var states: [String] = []
        if let n = rawValue as? NSNumber {
            if role == "AXCheckBox" || role == "AXRadioButton" || role == "AXSwitch" || role == "AXToggle" {
                if n.intValue == 1 { states.append("checked") } else if n.intValue == 2 { states.append("mixed") }
            } else {
                valueStr = n.stringValue
            }
        } else if let s = rawValue as? String {
            valueStr = s
        } else if let a = rawValue as? NSAttributedString {
            valueStr = a.string
        }
        if role == "AXSecureTextField", let v = valueStr, !v.isEmpty { valueStr = String(repeating: "•", count: min(v.count, 12)) }
        if (at(7) as? NSNumber)?.boolValue == false { states.append("disabled") }
        if (at(8) as? NSNumber)?.boolValue == true { states.append("focused") }
        if (at(12) as? NSNumber)?.boolValue == true { states.append("selected") }
        if let ex = (at(14) as? NSNumber)?.boolValue, expandableRoles.contains(role) { states.append(ex ? "expanded" : "collapsed") }
        // Identifiers like "_NS:405" are AppKit noise, not labels.
        let ident = str(11).flatMap { id -> String? in
            id.count < 40 && !id.hasPrefix("_NS:") && id.rangeOfCharacter(from: .letters) != nil && !id.contains("-") ? id : nil
        }
        let label = [str(2), str(3), str(10), ident, str(13)]
            .compactMap { $0 }
            .first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) ?? ""
        let children = at(9) as? [AXUIElement]
        return (role, subrole, label, valueStr, frame, states, children)
    }

    /// Walk an element subtree into outline nodes.
    static func walk(_ root: AXUIElement, options o: SnapshotOptions) -> (nodes: [Node], truncated: Bool) {
        var nodes: [Node] = []
        var visited = 0
        var truncated = false
        let q = o.query?.lowercased()
        let screenBounds = Capture.displays().reduce(CGRect.null) { $0.union($1.frame) }

        func visit(_ el: AXUIElement, depth: Int, outDepth: Int, clip: CGRect?) {
            if nodes.count >= o.maxNodes { truncated = true; return }
            visited += 1
            if visited > o.maxNodes * 40 { truncated = true; return }
            let d = describe(el)
            let role = d.role
            // Prune what is not on screen (scrolled-out rows, hidden panes).
            if let f = d.frame, role != "AXApplication", role != "AXMenuBar", role != "AXMenu" {
                if f.width <= 0 || f.height <= 0 {
                    if !containerRoles.contains(role) && role != "AXGroup" { return }
                } else if !f.intersects(screenBounds) {
                    return
                } else if let c = clip, !f.intersects(c) {
                    return
                }
                if let b = o.bounds, !f.intersects(b) { return }
            }
            let isInteractive = interactiveRoles.contains(role) || (d.subrole == "AXTabButton")
            let acts = isInteractive || role == "AXGroup" || role == "AXImage" || role == "AXStaticText" ? actions(el) : []
            let actionable = isInteractive || acts.contains("AXPress")
            let isText = textRoles.contains(role) && (d.value?.isEmpty == false || !d.label.isEmpty)
            let hasArea = (d.frame?.width ?? 1) > 0 && (d.frame?.height ?? 1) > 0
            let isContainer = containerRoles.contains(role) && hasArea && (!d.label.isEmpty || role == "AXWindow" || role == "AXSheet" || role == "AXDialog")
            let text = (d.label + " " + (d.value ?? "")).lowercased()
            let matchesQuery = q == nil || text.contains(q!)
            var include = false
            if actionable && matchesQuery { include = true }
            else if isText && o.includeText && !o.interactiveOnly && matchesQuery { include = true }
            else if isContainer && q == nil && !o.interactiveOnly { include = true }
            var nextOut = outDepth
            if include {
                let id: Int? = actionable ? remember(el) : nil
                var value = d.value
                if isText, d.label.isEmpty { value = nil }
                let label = isText && d.label.isEmpty ? (d.value ?? "") : d.label
                nodes.append(Node(id: id, depth: outDepth, role: role, subrole: d.subrole, label: label,
                                  value: value, frame: d.frame, states: d.states,
                                  actions: acts.filter { $0 != "AXShowDefaultUI" && $0 != "AXShowAlternateUI" }))
                nextOut = outDepth + 1
            }
            guard depth < o.maxDepth else { return }
            // Text fields and leaf controls rarely have useful children.
            if role == "AXTextArea" || role == "AXTextField" || role == "AXStaticText" || role == "AXSecureTextField" { return }
            let nextClip: CGRect? = (role == "AXScrollArea" || role == "AXWindow") ? (d.frame ?? clip) : clip
            let kids = (role == "AXTable" || role == "AXOutline" || role == "AXList") ? children(el, role: role) : (d.children ?? children(el, role: role))
            for k in kids {
                if nodes.count >= o.maxNodes { truncated = true; break }
                visit(k, depth: depth + 1, outDepth: nextOut, clip: nextClip)
            }
        }
        visit(root, depth: 0, outDepth: 0, clip: nil)
        return (nodes, truncated)
    }

    static func frontmostPid() -> pid_t? {
        NSWorkspace.shared.frontmostApplication?.processIdentifier
    }

    static func snapshot(pid requested: pid_t?, scope: String, options: SnapshotOptions) throws -> JSON {
        guard AXIsProcessTrusted() else {
            throw CuaError("no_accessibility", "Accessibility permission is required. System Settings → Privacy & Security → Accessibility → enable Pawn.")
        }
        guard let pid = requested ?? frontmostPid() else { throw CuaError("no_app", "No frontmost application") }
        enableRichAccessibility(pid)
        let app = appElement(pid)
        let runApp = NSRunningApplication(processIdentifier: pid)
        var roots: [AXUIElement] = []
        switch scope {
        case "app":
            roots = [app]
        case "menubar":
            if let mb = copy(app, kAXMenuBarAttribute) { roots = [mb as! AXUIElement] }
        default: // "window": focused window (+ any sheet/dialog it owns)
            if let w = copy(app, kAXFocusedWindowAttribute) { roots = [w as! AXUIElement] }
            else if let w = copy(app, kAXMainWindowAttribute) { roots = [w as! AXUIElement] }
            else if let ws = copy(app, kAXWindowsAttribute) as? [AXUIElement], let first = ws.first { roots = [first] }
            else { roots = [app] }
        }
        var nodes: [Node] = []
        var truncated = false
        var o = options
        for r in roots {
            let res = walk(r, options: o)
            nodes.append(contentsOf: res.nodes)
            truncated = truncated || res.truncated
            o.maxNodes = max(0, options.maxNodes - nodes.count)
            if o.maxNodes == 0 { break }
        }
        let windowTitle = roots.first.flatMap { string($0, kAXTitleAttribute) } ?? ""
        let windowFrame = roots.first.flatMap { frame($0) }
        var header = "App: \(runApp?.localizedName ?? "pid \(pid)") (pid \(pid))"
        if !windowTitle.isEmpty { header += " — window \"\(clip(windowTitle, 80))\"" }
        if let f = windowFrame { header += " @(\(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height)))" }
        let text = ([header] + nodes.map { $0.line } + (truncated ? ["… (truncated: narrow with query/scope, or scroll)"] : [])).joined(separator: "\n")
        let interactive = nodes.filter { $0.id != nil }.count
        return [
            "pid": Int(pid),
            "app": runApp?.localizedName ?? "",
            "bundleId": runApp?.bundleIdentifier ?? "",
            "window": windowTitle,
            "windowFrame": windowFrame.map(rectJSON) ?? NSNull(),
            "text": text,
            "nodes": nodes.map { $0.json },
            "interactive": interactive,
            "truncated": truncated
        ]
    }

    // MARK: Actions

    static func perform(_ id: Int, action: String, value: String?) throws -> JSON {
        let el = try element(id)
        let d = describe(el)
        let acts = actions(el)
        func doAction(_ name: String) -> Bool { AXUIElementPerformAction(el, name as CFString) == .success }
        var performed = ""
        switch action.lowercased() {
        case "press", "click", "activate":
            for candidate in ["AXPress", "AXConfirm", "AXPick", "AXOpen"] where acts.contains(candidate) {
                if doAction(candidate) { performed = candidate; break }
            }
            if performed.isEmpty, let f = d.frame, f.width > 0 {
                Input.click(at: CGPoint(x: f.midX, y: f.midY), button: "left", count: 1, flags: [])
                performed = "click@center"
            }
        case "focus":
            if AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success { performed = "AXFocused" }
            else if let f = d.frame { Input.click(at: CGPoint(x: f.midX, y: f.midY), button: "left", count: 1, flags: []); performed = "click@center" }
        case "set_value", "setvalue", "fill":
            guard let v = value else { throw CuaError("bad_args", "value is required for set_value") }
            AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue)
            if AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, v as CFString) == .success {
                performed = "AXValue"
                // Verify: web views sometimes accept the call but ignore it.
                if let now = string(el, kAXValueAttribute), now != v, let f = d.frame {
                    Input.click(at: CGPoint(x: f.midX, y: f.midY), button: "left", count: 1, flags: [])
                    try Input.keyCombo("cmd+a", repeatCount: 1, pid: nil)
                    Input.typeText(v, pid: nil, delayMs: 2)
                    performed = "typed"
                }
            } else if let f = d.frame {
                Input.click(at: CGPoint(x: f.midX, y: f.midY), button: "left", count: 1, flags: [])
                sleepMs(60)
                try Input.keyCombo("cmd+a", repeatCount: 1, pid: nil)
                Input.typeText(v, pid: nil, delayMs: 2)
                performed = "typed"
            }
        case "select":
            if AXUIElementSetAttributeValue(el, kAXSelectedAttribute as CFString, kCFBooleanTrue) == .success { performed = "AXSelected" }
            else if doAction("AXPress") { performed = "AXPress" }
        case "increment": if doAction("AXIncrement") { performed = "AXIncrement" }
        case "decrement": if doAction("AXDecrement") { performed = "AXDecrement" }
        case "show_menu", "menu", "context_menu":
            if doAction("AXShowMenu") { performed = "AXShowMenu" }
            else if let f = d.frame { Input.click(at: CGPoint(x: f.midX, y: f.midY), button: "right", count: 1, flags: []); performed = "right-click" }
        case "scroll_to_visible", "reveal":
            if doAction("AXScrollToVisible") { performed = "AXScrollToVisible" }
        case "raise":
            if doAction("AXRaise") { performed = "AXRaise" }
        case "cancel": if doAction("AXCancel") { performed = "AXCancel" }
        case "confirm": if doAction("AXConfirm") { performed = "AXConfirm" }
        case "expand":
            if AXUIElementSetAttributeValue(el, "AXExpanded" as CFString, kCFBooleanTrue) == .success { performed = "AXExpanded" }
            else if doAction("AXPress") { performed = "AXPress" }
        case "collapse":
            if AXUIElementSetAttributeValue(el, "AXExpanded" as CFString, kCFBooleanFalse) == .success { performed = "AXExpanded" }
        default:
            if doAction(action) { performed = action }
            else { throw CuaError("bad_action", "Unknown action \"\(action)\". Available: \(acts.joined(separator: ", "))") }
        }
        guard !performed.isEmpty else {
            throw CuaError("action_failed", "Could not \(action) [\(id)] \(d.role) \"\(d.label)\". Available actions: \(acts.joined(separator: ", "))")
        }
        return ["ok": true, "element": id, "performed": performed, "role": d.role, "label": d.label,
                "frame": d.frame.map(rectJSON) ?? NSNull()]
    }

    static func info(_ id: Int) throws -> JSON {
        let el = try element(id)
        let d = describe(el)
        var j = Node(id: id, depth: 0, role: d.role, subrole: d.subrole, label: d.label, value: d.value, frame: d.frame,
                     states: d.states, actions: actions(el)).json
        if let sel = string(el, kAXSelectedTextAttribute) { j["selectedText"] = sel }
        j["pid"] = Int(pid(el))
        return j
    }

    static func elementAt(_ p: CGPoint) throws -> JSON {
        var el: AXUIElement?
        guard AXUIElementCopyElementAtPosition(systemWide, Float(p.x), Float(p.y), &el) == .success, let hit = el else {
            throw CuaError("not_found", "No accessibility element at (\(Int(p.x)), \(Int(p.y)))")
        }
        var chain: [String] = []
        var cur: AXUIElement? = hit
        var hops = 0
        while let c = cur, hops < 8 {
            let d = describe(c)
            chain.append("\(d.role)\(d.label.isEmpty ? "" : " \"\(clip(d.label, 40))\"")")
            cur = copy(c, kAXParentAttribute).map { $0 as! AXUIElement }
            hops += 1
        }
        var j = try info(remember(hit))
        j["ancestors"] = chain
        return j
    }

    static func focused() -> JSON {
        var j: JSON = [:]
        if let app = NSWorkspace.shared.frontmostApplication {
            j["app"] = app.localizedName ?? ""
            j["bundleId"] = app.bundleIdentifier ?? ""
            j["pid"] = Int(app.processIdentifier)
            let ae = appElement(app.processIdentifier)
            if let w = copy(ae, kAXFocusedWindowAttribute) {
                let we = w as! AXUIElement
                j["window"] = string(we, kAXTitleAttribute) ?? ""
                j["windowFrame"] = frame(we).map(rectJSON) ?? NSNull()
                if let wid = windowId(we) { j["windowId"] = Int(wid) }
            }
            if let f = copy(ae, kAXFocusedUIElementAttribute) {
                let fe = f as! AXUIElement
                let id = remember(fe)
                let d = describe(fe)
                j["element"] = Node(id: id, depth: 0, role: d.role, subrole: d.subrole, label: d.label, value: d.value,
                                    frame: d.frame, states: d.states, actions: actions(fe)).json
                if let sel = string(fe, kAXSelectedTextAttribute), !sel.isEmpty { j["selectedText"] = sel }
            }
        }
        return j
    }

    // MARK: Menus

    static func menuTitle(_ el: AXUIElement) -> String {
        string(el, kAXTitleAttribute) ?? ""
    }

    static func normalizeMenu(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: "…", with: "").replacingOccurrences(of: "...", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    static func menuChildren(_ el: AXUIElement) -> [AXUIElement] {
        var out: [AXUIElement] = []
        for c in copy(el, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
            if string(c, kAXRoleAttribute) == "AXMenu" {
                out.append(contentsOf: copy(c, kAXChildrenAttribute) as? [AXUIElement] ?? [])
            } else {
                out.append(c)
            }
        }
        return out
    }

    static func findMenuItem(_ items: [AXUIElement], _ name: String) -> AXUIElement? {
        let want = normalizeMenu(name)
        return items.first { normalizeMenu(menuTitle($0)) == want }
            ?? items.first { normalizeMenu(menuTitle($0)).hasPrefix(want) }
            ?? items.first { normalizeMenu(menuTitle($0)).contains(want) }
    }

    static func menuBar(_ pid: pid_t) throws -> AXUIElement {
        let app = appElement(pid)
        guard let mb = copy(app, kAXMenuBarAttribute) else { throw CuaError("no_menu", "App has no menu bar") }
        return mb as! AXUIElement
    }

    static func listMenu(pid: pid_t, path: [String]) throws -> JSON {
        var items = menuChildren(try menuBar(pid))
        for name in path {
            guard let hit = findMenuItem(items, name) else {
                throw CuaError("not_found", "Menu \"\(name)\" not found. Available: \(items.map(menuTitle).filter { !$0.isEmpty }.joined(separator: ", "))")
            }
            items = menuChildren(hit)
        }
        let list: [JSON] = items.compactMap { el in
            let t = menuTitle(el)
            guard !t.isEmpty else { return nil }
            var j: JSON = ["title": t, "enabled": bool(el, kAXEnabledAttribute) ?? true]
            if let key = string(el, kAXMenuItemCmdCharAttribute), !key.isEmpty {
                var mods = ""
                let m = (copy(el, kAXMenuItemCmdModifiersAttribute) as? NSNumber)?.intValue ?? 0
                if m & 4 != 0 { mods += "⌃" }
                if m & 2 != 0 { mods += "⌥" }
                if m & 1 != 0 { mods += "⇧" }
                if m & 8 == 0 { mods += "⌘" }
                j["shortcut"] = mods + key
            }
            if !(copy(el, kAXChildrenAttribute) as? [AXUIElement] ?? []).isEmpty { j["submenu"] = true }
            return j
        }
        return ["path": path, "items": list]
    }

    static func selectMenu(pid: pid_t, path: [String]) throws -> JSON {
        guard !path.isEmpty else { throw CuaError("bad_args", "path is required, e.g. [\"File\", \"Save As…\"]") }
        var items = menuChildren(try menuBar(pid))
        var target: AXUIElement?
        for (i, name) in path.enumerated() {
            guard let hit = findMenuItem(items, name) else {
                throw CuaError("not_found", "Menu item \"\(name)\" not found. Available: \(items.map(menuTitle).filter { !$0.isEmpty }.joined(separator: ", "))")
            }
            if i == path.count - 1 { target = hit } else { items = menuChildren(hit) }
        }
        guard let t = target else { throw CuaError("not_found", "Menu path not found") }
        if bool(t, kAXEnabledAttribute) == false {
            throw CuaError("disabled", "Menu item \"\(path.joined(separator: " > "))\" is disabled")
        }
        guard AXUIElementPerformAction(t, kAXPressAction as CFString) == .success else {
            throw CuaError("action_failed", "Could not press menu item \(path.joined(separator: " > "))")
        }
        return ["ok": true, "path": path]
    }
}
