# native/macos/pawn-cua - Swift computer-use helper

## OVERVIEW
This is a macOS-only helper binary (9 Swift files, about 3.1k LOC) spawned by `src/main/computer/cuaHelper.ts`. `scripts/build-native.sh` builds it (`npm run build:native`) with swiftc as a universal arm64 + x86_64 binary into `native/macos/build/pawn-cua`, and skips on non-Darwin. `dist:mac` and release run it first.

## STRUCTURE
```
main.swift           entry + method dispatch (hotspot, 539)
Protocol.swift       JSON Lines over stdio, CuaError, Output
Accessibility.swift  AX tree queries (591)
Apps.swift Capture.swift Input.swift OCR.swift Overlay.swift Recorder.swift
```

## PROTOCOL
- Request: `{"id":1,"method":"click","params":{...}}`
- Response: `{"id":1,"result":{...}}` or `{"id":1,"error":{"code","message"}}`
- Coordinates are macOS global display points in CoreGraphics space: origin at the top-left of the primary display, y grows downward. Mapping to screenshot pixels happens in `src/main/computer/engine.ts`.
- If you add a method, update the dispatcher in `main.swift` and the TS caller in `src/main/computer/` together.

## ANTI-PATTERNS
- Never call the sync bridge on the main thread (`Capture.swift`).
- Long actions must never block read-only methods (`main.swift`).
- Never silently act on an app that does not resolve; return an error instead.
- The recorder never records or reads secure fields, and it ignores Pawn's own input.
- There is no Swift test target. Verify via the `PAWN_CUA_E2E=1` tests in `src/main/computer/__tests__` and `src/headless/__tests__/computer.test.ts`.
