#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing web dependencies..."
cd "$ROOT/web"
npm install

echo "==> Building and installing /Applications/엠디.app..."
cd "$ROOT"
chmod +x "$ROOT/build.sh"
"$ROOT/build.sh"

echo "==> Registering /Applications/엠디.app with LaunchServices..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/엠디.app"

echo "==> Setting 엠디 as default handler for .md and .markdown..."
swift -e '
import AppKit
import UniformTypeIdentifiers

let appURL = URL(fileURLWithPath: "/Applications/엠디.app")
let types: [UTType] = [
    UTType(filenameExtension: "md"),
    UTType(filenameExtension: "markdown"),
    UTType("net.daringfireball.markdown")
].compactMap { $0 }

let group = DispatchGroup()
for t in Set(types) {
    group.enter()
    NSWorkspace.shared.setDefaultApplication(at: appURL, toOpen: t) { err in
        if let err = err { print("ERR \(t.identifier): \(err)") }
        else { print("OK \(t.identifier)") }
        group.leave()
    }
}
group.wait()

if let mdType = UTType(filenameExtension: "md"),
   let resolved = NSWorkspace.shared.urlForApplication(toOpen: mdType) {
    print("Default for .md -> \(resolved.path)")
}
'

echo "Done! 엠디 is installed and set as default for .md files."
