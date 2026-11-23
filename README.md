# 엠디 (emdi) v2.5.1

**엠디 (emdi)** is an ultra-lightweight (~7 MB), native macOS Markdown & vault editor built with Swift (AppKit + `WKWebView`) and TipTap.

---

## Philosophy & Purpose

Modern Markdown editors and PKM tools often bundle an entire Chromium browser and Node.js runtime through Electron, consuming hundreds of megabytes of disk space and memory just to read or edit a plain-text `.md` file.

**엠디 (emdi)** was created to answer a simple question:

> *"What if opening a `.md` file from Finder, Raycast, or an AI coding workflow felt as instant and calm as a native macOS app—while still understanding Obsidian vaults, wikilinks, periodic notes, Mermaid diagrams, and multi-format project assets?"*

### Core Principles
- **Native First, Zero Electron Bloat**: Built on macOS AppKit and the system `WKWebView` (~7 MB Universal binary vs. 400+ MB Electron apps). No background vault indexer, no global file-watcher storms—only open tabs are monitored, and background polling pauses automatically when inactive.
- **Obsidian-Friendly, Never Lock-In**: Works directly on plain local folders or existing Obsidian vaults. Understands `[[wikilinks]]`, `[[note#heading]]` anchors, YAML frontmatter, callouts (`> [!NOTE]`), `==highlights==`, and `.obsidian/plugins/periodic-notes/data.json` without modifying your vault structure.
- **Calm, Keyboard-Driven Workspace**: Paseo-inspired full-height sidebar, compact 40px pill tab bar, Command Palette (`Cmd + Shift + P`), Quick Open (`Cmd + K`), and Focus Mode (`Cmd + Shift + F`).
- **Yours to Style**: Ships with 6 curated dark & light themes plus custom accent colors via `Cmd + ,` (`Preferences`), so anyone can make it feel at home.

---

## Features

- **Multi-Tab & Multi-Format Viewer**: Open `.md`, `.html` (sandboxed live preview + source edit), `.pdf` (built-in viewer), images (zoom & lightbox), and code/JSON/YAML/CSV files (syntax highlighting & table preview) in tabs. Other file types open cleanly with macOS default apps.
- **Smart Markdown Editing**: Rich WYSIWYG + instant raw Markdown toggle (`Cmd + /`), floating selection toolbar, `/` slash commands, table mini-toolbar, Find & Replace (`Cmd + F` / `Cmd + Option + F`), lazy-loaded Mermaid diagrams, and clean plain-text / tab-separated table copy.
- **Periodic Notes (`Option + 1 / 2 / 3 / 4`)**: Jump directly to Today's Daily, Weekly, Monthly, or Yearly note based on your Obsidian Periodic Notes config (or choose a default vault in `Cmd + ,`), and step forward/backward with `Option + Left / Right`.
- **Customizable Themes (`Cmd + ,`)**: 6 palettes (*Lavender Dusk*, *Midnight Slate*, *Forest Moss*, *Warm Graphite*, *Paper Light*, *Warm Sepia*) + 6 accent overrides, font size slider, responsive/narrow reading width, and built-in Release Notes viewer.
- **In-App Auto-Update**: Checks GitHub Releases automatically and offers one-click download, atomic app replacement, and session-preserving relaunch.

---

## Installation (macOS 13+)

### Quick Install (Recommended)

Paste and run this single command in Terminal. It downloads the latest Universal binary (Apple Silicon & Intel) directly into `/Applications/엠디.app` without browser quarantine prompts:

```bash
curl -fsSL https://raw.githubusercontent.com/SheepCastle/emdi/main/scripts/install-release.sh | bash
```

Launch **엠디** from Applications, Spotlight, or Raycast. Future updates can be installed directly inside the app via the update banner or `엠디 > 업데이트 확인...`.

<details>
<summary>Alternative: Build from Source</summary>

Requirements: macOS 13+, Xcode Command Line Tools (`swiftc`), Node.js / npm.

```bash
git clone https://github.com/SheepCastle/emdi.git
cd emdi
./install.sh
```

`./install.sh` builds the app into `/Applications/엠디.app` and registers it as the default handler for `.md` / `.markdown` files.

</details>

---

## Keyboard Shortcuts

| Category | Shortcut | Action |
| :--- | :--- | :--- |
| **App & Settings** | `Cmd + ,` | Open Settings, Themes & Release Notes |
| | `Cmd + Shift + P` | Command Palette |
| | `Cmd + K` | Quick Open File |
| **Layout** | `Cmd + B` / `Cmd + \` | Toggle Left Sidebar |
| | `Cmd + E` / `Cmd + Shift + O` | Toggle File Explorer / Document Outline |
| | `Cmd + Shift + L` | Reveal Active File in File Tree |
| | `Cmd + Shift + F` | Toggle Focus Mode |
| | `Cmd + /` | Toggle Raw Markdown / Preview |
| | `Ctrl + Cmd + F` | Full Screen |
| **Tabs & History** | `Cmd + T` / `Cmd + W` / `Cmd + Shift + T` | New Tab / Close Tab / Reopen Closed Tab |
| | `Cmd + Option + W` | Close Other Tabs |
| | `Cmd + Shift + [` / `]` | Previous / Next Tab (`Ctrl + Tab` also works) |
| | `Cmd + 1~9` or `Cmd + Option + 1~9` | Jump to Tab #1–9 |
| | `Cmd + [` / `]` | Navigate Tab History Back / Forward |
| **Periodic Notes** | `Option + 1 / 2 / 3 / 4` | Daily / Weekly / Monthly / Yearly Note |
| | `Option + Left / Right` | Previous / Next Periodic Note (`Cmd + Option + Left/Right` anywhere) |
| **Editing** | `Cmd + Enter` | Toggle Task Checkbox (`- [ ]` / `- [x]`) |
| | `Option + Up / Down` | Move Current Line or List Item Up / Down |
| | `Cmd + Shift + B` / `H` / `K` | Bold / Highlight (`==text==`) / Insert or Edit Link |
| | `Cmd + F` / `Cmd + Option + F` | Find / Find & Replace |
| | `Cmd + Click` | Open Local Link, `[[Wikilink]]`, or External URL |
| **Copy & Export** | `Cmd + Option + C` | Copy Rich Text (HTML + Plain) |
| | `Cmd + Shift + C` / `Cmd + Option + Shift + C` | Copy Vault-Relative Path / Copy `[[Wikilink]]` |
| | `Cmd + S` / `Cmd + Shift + S` / `Cmd + R` | Save / Save As / Reload Document & File Tree |
| | `Cmd + Shift + E` / `Cmd + P` | Export PDF / Print |
| | `Cmd + Shift + R` | Reveal in Finder |

---

## Security & Privacy

- **100% Local-First**: Your notes never leave your machine. No analytics, no telemetry, no cloud account required.
- **Minimal Network Access**: The only outbound network request is checking GitHub Releases (`api.github.com/repos/SheepCastle/emdi/releases/latest`) for app updates.
- **Sandboxed Previews**: Local HTML previews run inside an `iframe` sandbox, Mermaid renders with `securityLevel: 'strict'`, and the custom bundle scheme strictly restricts file access inside the app bundle.

---

## Versioning & Release Notes

- Follows [Semantic Versioning](VERSIONING.md) (`MAJOR.MINOR.PATCH`).
- Full change history is maintained in [`CHANGELOG.md`](CHANGELOG.md) and bundled directly inside **엠디** (`Cmd + ,` → Release Notes).
- Maintainer release command: `./scripts/release.sh <patch|minor|major>`

---

## License

Released under the [MIT License](LICENSE).
