#!/usr/bin/env bash
# Build the native macOS computer-use helper (pawn-cua) as a universal binary.
# Output: native/macos/build/pawn-cua  (arm64 + x86_64, macOS 12+)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[build-native] skipped: pawn-cua is macOS-only"
  exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[build-native] swiftc not found — install Xcode Command Line Tools (xcode-select --install)" >&2
  exit 1
fi

SRC=native/macos/pawn-cua
OUT=native/macos/build
mkdir -p "$OUT"
FLAGS=(-O -whole-module-optimization -gnone)

for ARCH in arm64 x86_64; do
  echo "[build-native] compiling ${ARCH}"
  swiftc "${FLAGS[@]}" -target "${ARCH}-apple-macos12.0" -o "$OUT/pawn-cua-$ARCH" "$SRC"/*.swift
done

lipo -create -output "$OUT/pawn-cua" "$OUT/pawn-cua-arm64" "$OUT/pawn-cua-x86_64"
rm -f "$OUT/pawn-cua-arm64" "$OUT/pawn-cua-x86_64"
# Ad-hoc sign so macOS runs it; release builds are re-signed by electron-builder.
codesign --force --sign - "$OUT/pawn-cua" >/dev/null 2>&1 || true
lipo -info "$OUT/pawn-cua"
"$OUT/pawn-cua" --version
