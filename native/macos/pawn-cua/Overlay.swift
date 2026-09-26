// Visible agent cursor + status pill + emergency stop.
//
// A click-through overlay on every display shows where the agent is acting
// (an animated cursor ring with a ripple on click) and a pill "Pawn is using
// your computer — press Esc twice to stop". The overlay is excluded from
// screenshots. Pressing Escape twice quickly (a real key press, not one the
// agent synthesized) emits {"event":"user_abort"} so Pawn stops the turn.

import Foundation
import AppKit
import QuartzCore

/// eventSourceUserData stamped on every synthetic event, so our own key
/// presses never trigger the emergency stop.
let PAWN_EVENT_TAG: Int64 = 0x5041_574E // "PAWN"

final class OverlayView: NSView {
    let ring = CAShapeLayer()
    let dot = CAShapeLayer()
    let label = CATextLayer()
    let pill = CALayer()
    let pillText = CATextLayer()
    var hasCursor = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer = CALayer()
        layer?.masksToBounds = false
        let accent = NSColor(calibratedRed: 0.49, green: 0.42, blue: 1.0, alpha: 1).cgColor
        ring.path = CGPath(ellipseIn: CGRect(x: -14, y: -14, width: 28, height: 28), transform: nil)
        ring.fillColor = NSColor(calibratedRed: 0.49, green: 0.42, blue: 1.0, alpha: 0.18).cgColor
        ring.strokeColor = accent
        ring.lineWidth = 2.5
        ring.shadowColor = accent
        ring.shadowOpacity = 0.8
        ring.shadowRadius = 8
        ring.shadowOffset = .zero
        dot.path = CGPath(ellipseIn: CGRect(x: -3.5, y: -3.5, width: 7, height: 7), transform: nil)
        dot.fillColor = NSColor.white.cgColor
        dot.strokeColor = accent
        dot.lineWidth = 1.5
        label.string = "Pawn"
        label.fontSize = 11
        label.font = NSFont.boldSystemFont(ofSize: 11)
        label.foregroundColor = NSColor.white.cgColor
        label.backgroundColor = accent
        label.cornerRadius = 5
        label.alignmentMode = .center
        label.frame = CGRect(x: 14, y: -30, width: 44, height: 17)
        label.contentsScale = 2
        for l in [ring, dot, label] {
            l.opacity = 0
            layer?.addSublayer(l)
        }
        pill.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.86).cgColor
        pill.cornerRadius = 14
        pill.borderColor = accent
        pill.borderWidth = 1.5
        pill.opacity = 0
        pillText.fontSize = 12.5
        pillText.font = NSFont.systemFont(ofSize: 12.5, weight: .medium)
        pillText.foregroundColor = NSColor.white.cgColor
        pillText.alignmentMode = .center
        pillText.contentsScale = 2
        pill.addSublayer(pillText)
        layer?.addSublayer(pill)
    }

    required init?(coder: NSCoder) { fatalError() }

    func setPill(_ text: String?) {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.25)
        if let t = text {
            pillText.string = t
            let w = min(bounds.width - 40, max(260, CGFloat(t.count) * 7.2 + 36))
            pill.frame = CGRect(x: (bounds.width - w) / 2, y: bounds.height - 58, width: w, height: 28)
            pillText.frame = CGRect(x: 0, y: 6, width: w, height: 18)
            pill.opacity = 1
        } else {
            pill.opacity = 0
        }
        CATransaction.commit()
    }

    func moveCursor(to p: CGPoint, animated: Bool) {
        CATransaction.begin()
        CATransaction.setAnimationDuration(animated && hasCursor ? 0.22 : 0)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
        for l in [ring, dot] { l.position = p; l.opacity = 1 }
        label.position = CGPoint(x: p.x + 36, y: p.y - 22)
        label.opacity = 1
        CATransaction.commit()
        hasCursor = true
    }

    func hideCursor() {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.3)
        for l in [ring, dot, label] { l.opacity = 0 }
        CATransaction.commit()
        hasCursor = false
    }

    func ripple(at p: CGPoint, color: CGColor) {
        let r = CAShapeLayer()
        r.path = CGPath(ellipseIn: CGRect(x: -18, y: -18, width: 36, height: 36), transform: nil)
        r.fillColor = NSColor.clear.cgColor
        r.strokeColor = color
        r.lineWidth = 3
        r.position = p
        layer?.addSublayer(r)
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.4
        scale.toValue = 1.8
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = 0.45
        group.isRemovedOnCompletion = true
        r.opacity = 0
        r.add(group, forKey: "ripple")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { r.removeFromSuperlayer() }
    }

    func highlight(_ rect: CGRect) {
        let box = CAShapeLayer()
        box.path = CGPath(roundedRect: rect, cornerWidth: 4, cornerHeight: 4, transform: nil)
        box.fillColor = NSColor(calibratedRed: 0.49, green: 0.42, blue: 1.0, alpha: 0.12).cgColor
        box.strokeColor = NSColor(calibratedRed: 0.49, green: 0.42, blue: 1.0, alpha: 0.9).cgColor
        box.lineWidth = 2
        layer?.addSublayer(box)
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1
        fade.toValue = 0
        fade.beginTime = CACurrentMediaTime() + 0.5
        fade.duration = 0.4
        fade.fillMode = .forwards
        fade.isRemovedOnCompletion = false
        box.add(fade, forKey: "fade")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { box.removeFromSuperlayer() }
    }
}

enum Overlay {
    static var enabled = true
    static var windows: [(NSWindow, OverlayView, NSScreen)] = []
    static var idleTimer: Timer?
    static var pillText = "Pawn is using your computer — press Esc twice to stop"
    static var escTimes: [Date] = []
    static var monitor: Any?
    static var onAbort: (() -> Void)?

    /// CG global point (top-left origin) → (overlay view, local Cocoa point).
    static func locate(_ p: CGPoint) -> (OverlayView, CGPoint)? {
        guard let primary = NSScreen.screens.first else { return nil }
        let cocoa = CGPoint(x: p.x, y: primary.frame.height - p.y)
        for (_, view, screen) in windows where screen.frame.insetBy(dx: -1, dy: -1).contains(cocoa) {
            return (view, CGPoint(x: cocoa.x - screen.frame.minX, y: cocoa.y - screen.frame.minY))
        }
        return nil
    }

    static func localRect(_ r: CGRect) -> (OverlayView, CGRect)? {
        guard let primary = NSScreen.screens.first else { return nil }
        let cocoa = CGRect(x: r.minX, y: primary.frame.height - r.maxY, width: r.width, height: r.height)
        for (_, view, screen) in windows where screen.frame.intersects(cocoa) {
            return (view, cocoa.offsetBy(dx: -screen.frame.minX, dy: -screen.frame.minY))
        }
        return nil
    }

    static func ensureWindows() {
        let screens = NSScreen.screens
        if windows.count == screens.count, zip(windows, screens).allSatisfy({ $0.0.2 == $0.1 && $0.0.0.frame == $0.1.frame }) { return }
        for (w, _, _) in windows { w.orderOut(nil) }
        windows = screens.map { screen in
            let w = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.ignoresMouseEvents = true
            w.level = .screenSaver
            w.sharingType = .none
            w.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
            w.isReleasedWhenClosed = false
            let v = OverlayView(frame: CGRect(origin: .zero, size: screen.frame.size))
            w.contentView = v
            w.setFrame(screen.frame, display: false)
            w.orderFrontRegardless()
            return (w, v, screen)
        }
    }

    static func touch() {
        guard enabled else { return }
        ensureWindows()
        for (_, v, _) in windows { v.setPill(pillText) }
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { _ in
            for (_, v, _) in windows {
                v.setPill(nil)
                v.hideCursor()
            }
        }
    }

    static func action(at p: CGPoint?, kind: String) {
        DispatchQueue.main.async {
            guard enabled else { return }
            touch()
            guard let p = p, let (view, local) = locate(p) else { return }
            for (_, v, _) in windows where v !== view { v.hideCursor() }
            view.moveCursor(to: local, animated: true)
            switch kind {
            case "click":
                view.ripple(at: local, color: NSColor(calibratedRed: 0.49, green: 0.42, blue: 1.0, alpha: 1).cgColor)
            case "right":
                view.ripple(at: local, color: NSColor.systemOrange.cgColor)
            case "type", "key":
                view.ripple(at: local, color: NSColor.systemTeal.cgColor)
            default:
                break
            }
        }
    }

    static func highlight(_ r: CGRect) {
        DispatchQueue.main.async {
            guard enabled else { return }
            touch()
            if let (view, local) = localRect(r) { view.highlight(local) }
        }
    }

    static func setEnabled(_ on: Bool, pill: String?) {
        DispatchQueue.main.async {
            enabled = on
            if let p = pill, !p.isEmpty { pillText = p }
            if !on {
                for (_, v, _) in windows {
                    v.setPill(nil)
                    v.hideCursor()
                }
            }
        }
    }

    static func installEmergencyStop(_ handler: @escaping () -> Void) {
        onAbort = handler
        DispatchQueue.main.async {
            guard monitor == nil else { return }
            monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { e in
                guard e.keyCode == 53 else { return } // Escape
                if let cg = e.cgEvent, cg.getIntegerValueField(.eventSourceUserData) == PAWN_EVENT_TAG { return }
                let now = Date()
                escTimes = escTimes.filter { now.timeIntervalSince($0) < 0.8 } + [now]
                if escTimes.count >= 2 {
                    escTimes.removeAll()
                    onAbort?()
                    for (_, v, _) in windows { v.setPill("Stopped — Pawn released the mouse and keyboard") }
                    idleTimer?.invalidate()
                    idleTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { _ in
                        for (_, v, _) in windows { v.setPill(nil); v.hideCursor() }
                    }
                }
            }
        }
    }
}
