#!/bin/sh
# 编译菜单栏小程序 → client/DadiMenu.zip（主机把它发给各人的「接入」安装程序）。只要 Mac 自带的命令行开发工具（xcode-select --install）。
set -e
cd "$(dirname "$0")"
HERE="$(pwd)"; OUT="$(mktemp -d)"; APP="$OUT/DadiMenu.app"; mkdir -p "$APP/Contents/MacOS"   # 在临时目录里打包：桌面上的文件夹会带附加属性，签名不认
for ARCH in arm64 x86_64; do xcrun swiftc -O -swift-version 5 -target $ARCH-apple-macos12.0 main.swift -o "$OUT/DadiMenu-$ARCH"; done
lipo -create "$OUT/DadiMenu-arm64" "$OUT/DadiMenu-x86_64" -output "$APP/Contents/MacOS/DadiMenu"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>ai.alaco.dadi-menu</string>
  <key>CFBundleName</key><string>大地工作台</string>
  <key>CFBundleExecutable</key><string>DadiMenu</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
xattr -cr "$APP"; codesign --force -s - "$APP"
rm -f "$HERE/../DadiMenu.zip"; ditto -c -k --norsrc --keepParent "$APP" "$HERE/../DadiMenu.zip"
lipo -archs "$APP/Contents/MacOS/DadiMenu"; codesign -dv "$APP" 2>&1 | grep -E 'Identifier|Signature'; ls -l "$HERE/../DadiMenu.zip" | awk '{print $5" bytes"}'; rm -rf "$OUT"
