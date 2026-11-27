# 엠디 (emdi) v2.7.3

[한국어](README.md) | **English**

**엠디 (emdi)** is an ultra-lightweight (~3 MB), native Markdown & vault editor for **macOS** (Swift AppKit + `WKWebView`) and **Windows** (Rust + `WebView2`), powered by TipTap.

---

## Philosophy & Purpose

Modern Markdown editors and PKM tools often bundle an entire Chromium browser and Node.js runtime through Electron, consuming hundreds of megabytes of disk space and memory just to read or edit a plain-text `.md` file.

**엠디 (emdi)** was created to answer a simple question:

> *"What if opening a `.md` file from Finder, Explorer, Raycast, or an AI coding workflow felt as instant and calm as a native OS app—while still understanding Obsidian vaults, wikilinks, periodic notes, Mermaid diagrams, and multi-format project assets?"*

### Core Principles
- **Native First, Zero Electron Bloat**: ~3.2 MB Universal macOS binary and ~3.0 MB Windows x64 binary using system WebViews (vs. 400+ MB Electron apps). No background vault indexer, no global file-watcher storms.
- **Obsidian-Friendly, Never Lock-In**: Works directly on plain local folders or existing Obsidian vaults. Understands `[[wikilinks]]`, `[[note#heading]]` anchors, YAML frontmatter, callouts (`> [!NOTE]`), `==highlights==`, and `.obsidian/plugins/periodic-notes/data.json` without modifying your vault structure.
- **3-Column Focused Workspace**: Left file explorer (with fixed bottom update card, settings, and shortcuts buttons), center Markdown canvas, and toggleable right inspector (`Cmd/Ctrl + E` — Outline, Tasks, Links & Backlinks).
- **Curated Standard Themes (`Cmd/Ctrl + ,`)**: 6 proven palettes (*Catppuccin Mocha*, *Tokyo Night*, *Nord*, *Gruvbox Dark*, *GitHub Light*, *Catppuccin Latte*) + 6 accent presets.

---

## Installation

### macOS (13+, Apple Silicon & Intel)

Paste and run this single command in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/SheepCastle/emdi/main/scripts/install-release.sh | bash
```

Launch **엠디** from Applications, Spotlight, or Raycast. Future updates can be installed directly inside the app via the bottom-left update card or `엠디 > 업데이트 확인...`.

### Windows (10 / 11, x64)

Paste and run this single command in PowerShell:

```powershell
irm https://raw.githubusercontent.com/SheepCastle/emdi/main/scripts/install-release.ps1 | iex
```

It downloads the lightweight native WebView2 binary (`emdi.exe`) into `%LocalAppData%\Programs\emdi\`, adds a Start Menu shortcut, and registers `.md` / `.markdown` file associations without requiring administrator privileges.

<details>
<summary>Alternative: Build from Source (macOS)</summary>

Requirements: macOS 13+, Xcode Command Line Tools (`swiftc`), Node.js / npm.

```bash
git clone https://github.com/SheepCastle/emdi.git
cd emdi
./install.sh
```

`./install.sh` builds the app into `/Applications/엠디.app` and registers it as the default handler for `.md` / `.markdown` files.

</details>

---

## Features

- **Multi-Tab & Multi-Format Viewer**: Open `.md`, `.html` (sandboxed live preview + source edit), `.pdf` (built-in viewer), images (zoom & lightbox), and code/JSON/YAML/CSV files (syntax highlighting & table preview) in tabs. Other file types open cleanly with OS default apps.
- **Smart Markdown Editing**: Rich WYSIWYG + instant raw Markdown toggle (`Cmd/Ctrl + /`), floating selection toolbar, `/` slash commands, table mini-toolbar, Find & Replace (`Cmd/Ctrl + F`), lazy-loaded Mermaid diagrams, and clean plain-text / tab-separated table copy.
- **Right Inspector Panel (`Cmd/Ctrl + E`)**: View document Outline & summary stats (characters, reading time, task progress), interactive Tasks checklist, and outgoing links + on-demand vault Backlinks.
- **Periodic Notes (`Option/Alt + 1 / 2 / 3 / 4`)**: Jump directly to Today's Daily, Weekly, Monthly, or Yearly note based on your Obsidian Periodic Notes config, and step forward/backward with `Option/Alt + Left / Right`.
- **In-App Auto-Update**: Checks GitHub Releases automatically on launch and displays a calm bottom-left update card until dismissed or installed.

---

## Keyboard Shortcuts

On Windows, use `Ctrl` instead of `Cmd` and `Alt` instead of `Option`. You can also view OS-specific shortcuts anytime inside the app (`Cmd/Ctrl + ,` → Shortcuts).

| Category | Shortcut (macOS) | Action |
| :--- | :--- | :--- |
| **App & Settings** | `Cmd + ,` | Open Settings, Themes, Shortcuts & Release Notes |
| | `Cmd + Shift + P` | Command Palette |
| | `Cmd + K` | Quick Open File |
| **Files** | `Cmd + O` / `Cmd + Option + O` | Open File / Open Folder |
| | `Cmd + S` / `Cmd + Shift + S` | Save / Save As |
| | `Cmd + R` | Reload Document & File Tree |
| **Layout** | `Cmd + B` / `Cmd + \` | Toggle Left Sidebar |
| | `Cmd + E` | Toggle Right Inspector (Outline · Tasks · Links) |
| | `Cmd + Shift + O` | Open Document Outline |
| | `Cmd + Shift + L` | Reveal Active File in File Tree |
| | `Cmd + Shift + F` | Toggle Focus Mode |
| | `Cmd + /` | Toggle Raw Markdown / Preview |
| **Tabs & History** | `Cmd + T` / `Cmd + W` / `Cmd + Shift + T` | New Tab / Close Tab / Reopen Closed Tab |
| | `Cmd + 1~9` | Jump to Tab #1–9 |
| | `Cmd + [` / `]` | Navigate Tab History Back / Forward |
| | `Cmd + Click` | Open Local Link, `[[Wikilink]]`, or External URL |
| **Periodic Notes** | `Option + 1 / 2 / 3 / 4` | Daily / Weekly / Monthly / Yearly Note |
| | `Option + Left / Right` | Previous / Next Periodic Note |
| **Editing & Export** | `Cmd + Enter` | Toggle Task Checkbox (`- [ ]` / `- [x]`) |
| | `Option + Up / Down` | Move Current Line or List Item Up / Down |
| | `Cmd + F` / `Cmd + Option + F` | Find / Find & Replace |
| | `Cmd + Shift + E` / `Cmd + P` | Export PDF / Print |

---

## Security & Privacy

- **100% Local-First**: Your notes never leave your machine. No analytics, no telemetry, no cloud account required.
- **Minimal Network Access**: The only outbound network request is checking GitHub Releases (`api.github.com/repos/SheepCastle/emdi/releases/latest`) for app updates.
- **Sandboxed Previews**: Local HTML previews run inside an `iframe` sandbox, and Mermaid renders with `securityLevel: 'strict'`.

---

## Versioning & License

- Follows [Semantic Versioning](VERSIONING.md) (`MAJOR.MINOR.PATCH`). Full change history is in [`CHANGELOG.md`](CHANGELOG.md).
- Released under the [MIT License](LICENSE).
