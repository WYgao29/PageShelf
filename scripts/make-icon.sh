#!/bin/bash
set -euo pipefail
pageshelf_root="$(cd "$(dirname "$0")/.." && pwd)"
pageshelf_source="$pageshelf_root/build/brand/pageshelf-appicon-light-1024.png"
pageshelf_iconset="$pageshelf_root/build/icon.iconset"
pageshelf_verify="$pageshelf_root/build/icon-verify.iconset"
mkdir -p "$pageshelf_iconset"
for pageshelf_size in 16 32 128 256 512; do
  sips -z "$pageshelf_size" "$pageshelf_size" "$pageshelf_source" --out "$pageshelf_iconset/icon_${pageshelf_size}x${pageshelf_size}.png" >/dev/null
  pageshelf_double=$((pageshelf_size * 2))
  sips -z "$pageshelf_double" "$pageshelf_double" "$pageshelf_source" --out "$pageshelf_iconset/icon_${pageshelf_size}x${pageshelf_size}@2x.png" >/dev/null
done
iconutil -c icns "$pageshelf_iconset" -o "$pageshelf_root/build/icon.icns"
if [ -d "$pageshelf_verify" ]; then rm -rf "$pageshelf_verify"; fi
iconutil -c iconset "$pageshelf_root/build/icon.icns" -o "$pageshelf_verify"
for pageshelf_size in 16 32 128 256 512; do
  for pageshelf_suffix in "" "@2x"; do
    pageshelf_file="$pageshelf_verify/icon_${pageshelf_size}x${pageshelf_size}${pageshelf_suffix}.png"
    test -s "$pageshelf_file"
    pageshelf_expected="$pageshelf_size"
    if [ "$pageshelf_suffix" = "@2x" ]; then pageshelf_expected=$((pageshelf_size * 2)); fi
    pageshelf_width="$(sips -g pixelWidth "$pageshelf_file" | awk '/pixelWidth:/ {print $2}')"
    pageshelf_height="$(sips -g pixelHeight "$pageshelf_file" | awk '/pixelHeight:/ {print $2}')"
    test "$pageshelf_width" = "$pageshelf_expected"
    test "$pageshelf_height" = "$pageshelf_expected"
  done
done
echo "ICON_VERIFIED 10 sizes (16–1024 px)"
