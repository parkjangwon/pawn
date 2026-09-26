// Protocol + shared helpers for pawn-cua (JSON Lines over stdio).
//
// Request:  {"id": 1, "method": "click", "params": {...}}
// Response: {"id": 1, "result": {...}}  |  {"id": 1, "error": {"code": "...", "message": "..."}}
//
// All coordinates are macOS global display points (CoreGraphics space:
// origin at the top-left of the primary display, y grows downward).

import Foundation
import CoreGraphics

typealias JSON = [String: Any]

struct CuaError: Error, CustomStringConvertible {
    let code: String
    let message: String
    init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }
    var description: String { "\(code): \(message)" }
}

final class Output {
    static let shared = Output()
    private let lock = NSLock()
    private let out = FileHandle.standardOutput

    func send(_ obj: JSON) {
        let safe = sanitize(obj)
        guard let data = try? JSONSerialization.data(withJSONObject: safe, options: []) else {
            if let id = obj["id"] {
                send(["id": id, "error": ["code": "encode_failed", "message": "Could not encode result"]])
            }
            return
        }
        lock.lock()
        defer { lock.unlock() }
        out.write(data)
        out.write(Data([0x0A]))
    }

    func reply(_ id: Any, _ result: Result<Any, Error>) {
        switch result {
        case .success(let value):
            send(["id": id, "result": value])
        case .failure(let err):
            if let e = err as? CuaError {
                send(["id": id, "error": ["code": e.code, "message": e.message]])
            } else {
                send(["id": id, "error": ["code": "failed", "message": String(describing: err)]])
            }
        }
    }
}

/// JSONSerialization throws (or crashes) on NaN / Infinity — scrub them.
func sanitize(_ value: Any) -> Any {
    switch value {
    case let d as Double:
        return d.isFinite ? d : 0
    case let f as CGFloat:
        return f.isFinite ? Double(f) : 0
    case let f as Float:
        return f.isFinite ? Double(f) : 0
    case let dict as [String: Any]:
        var out: [String: Any] = [:]
        for (k, v) in dict { out[k] = sanitize(v) }
        return out
    case let arr as [Any]:
        return arr.map(sanitize)
    default:
        return value
    }
}

func num(_ v: CGFloat) -> Double {
    let d = Double(v)
    return d.isFinite ? (d * 100).rounded() / 100 : 0
}

func rectJSON(_ r: CGRect) -> JSON {
    ["x": num(r.origin.x), "y": num(r.origin.y), "width": num(r.size.width), "height": num(r.size.height)]
}

extension Dictionary where Key == String, Value == Any {
    func double(_ k: String) -> Double? {
        if let n = self[k] as? NSNumber { return n.doubleValue }
        if let s = self[k] as? String { return Double(s) }
        return nil
    }
    func int(_ k: String) -> Int? {
        guard let d = double(k), d.isFinite else { return nil }
        return Int(d)
    }
    func string(_ k: String) -> String? {
        if let s = self[k] as? String { return s }
        if let n = self[k] as? NSNumber { return n.stringValue }
        return nil
    }
    func bool(_ k: String) -> Bool? {
        if let b = self[k] as? Bool { return b }
        if let n = self[k] as? NSNumber { return n.boolValue }
        return nil
    }
    func strings(_ k: String) -> [String] {
        if let a = self[k] as? [Any] { return a.compactMap { $0 as? String } }
        if let s = self[k] as? String {
            return s.split(whereSeparator: { $0 == "+" || $0 == "," || $0 == " " }).map(String.init)
        }
        return []
    }
    func point(_ xKey: String = "x", _ yKey: String = "y") -> CGPoint? {
        guard let x = double(xKey), let y = double(yKey), x.isFinite, y.isFinite else { return nil }
        return CGPoint(x: x, y: y)
    }
    func rect(_ k: String) -> CGRect? {
        if let a = self[k] as? [Any], a.count == 4 {
            let n = a.compactMap { ($0 as? NSNumber)?.doubleValue }
            guard n.count == 4 else { return nil }
            return CGRect(x: Swift.min(n[0], n[2]), y: Swift.min(n[1], n[3]), width: abs(n[2] - n[0]), height: abs(n[3] - n[1]))
        }
        if let d = self[k] as? [String: Any], let x = d.double("x"), let y = d.double("y"),
           let w = d.double("width"), let h = d.double("height") {
            return CGRect(x: x, y: y, width: w, height: h)
        }
        return nil
    }
}

func sleepMs(_ ms: Double) {
    guard ms > 0 else { return }
    usleep(useconds_t(min(ms, 300_000) * 1000))
}
