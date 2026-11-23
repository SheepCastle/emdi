import AppKit
import CryptoKit
import UniformTypeIdentifiers
import WebKit

// MARK: - File Fingerprint

struct FileMeta: Equatable {
    let mtime: Date?
    let size: UInt64
    let inode: UInt64
}

// MARK: - Drag & Drop Aware WKWebView

final class EmdiWebView: WKWebView {
    var onFilesDropped: (([URL]) -> Void)?
    var isActiveTabMarkdownProvider: (() -> Bool)?

    private func droppableDocumentURLs(from sender: NSDraggingInfo) -> [URL] {
        let pb = sender.draggingPasteboard
        guard let urls = pb.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL] else {
            return []
        }
        let isActiveMd = isActiveTabMarkdownProvider?() ?? true
        return urls.filter { url in
            let kind = LocalFileResolver.shared.fileKind(for: url)
            if kind == "external" { return false }
            // Keep image drop -> paste into markdown document when editing a markdown tab
            if kind == "image" && isActiveMd { return false }
            return true
        }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if !droppableDocumentURLs(from: sender).isEmpty {
            return .copy
        }
        return super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        if !droppableDocumentURLs(from: sender).isEmpty {
            return .copy
        }
        return super.draggingUpdated(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = droppableDocumentURLs(from: sender)
        if !urls.isEmpty {
            onFilesDropped?(urls)
            return true
        }
        return super.performDragOperation(sender)
    }
}

// MARK: - Tab Session

final class TabSession {
    let id: String
    var fileURL: URL?
    var fileKind: String = "markdown"
    var isDirty = false
    var fileMonitor: DispatchSourceFileSystemObject?
    var monitoredFD: Int32 = -1
    var lastSelfSaveDate: Date = .distantPast
    var lastKnownMeta: FileMeta?
    var lastKnownContentHash: String?
    var dismissedExternalHash: String?
    var pendingExternalContent: String?
    var pendingExternalHash: String?

    init(id: String = UUID().uuidString, fileURL: URL? = nil) {
        self.id = id
        self.fileURL = fileURL
        if let u = fileURL {
            self.fileKind = LocalFileResolver.shared.fileKind(for: u)
        }
    }

    deinit {
        stopDispatchSource()
    }

    var displayName: String {
        fileURL?.lastPathComponent ?? "제목 없음.md"
    }

    var isTextEditableKind: Bool {
        ["markdown", "html", "code", "text"].contains(fileKind)
    }

    func stopDispatchSource() {
        fileMonitor?.cancel()
        fileMonitor = nil
        if monitoredFD >= 0 {
            Darwin.close(monitoredFD)
            monitoredFD = -1
        }
    }
}

// MARK: - Window Controller (Multi-Tab + Multi-Format)

final class EditorWindowController: NSWindowController, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let webView: EmdiWebView
    private(set) var tabs: [TabSession] = []
    private(set) var activeTabId: String?
    private var isWebReady = false
    private var pendingCalls: [(method: String, payload: [String: Any])] = []
    private var pollTimer: Timer?
    private var closedTabURLs: [URL] = []
    private var pendingSaveAsTabId: String?
    private var pendingCloseAfterSaveTabId: String?

    private static let maxTextReadBytes: UInt64 = 4 * 1024 * 1024

    var activeTab: TabSession? {
        guard let id = activeTabId else { return tabs.first }
        return tabs.first { $0.id == id }
    }

    init(initialURLs: [URL?]) {
        let config = WKWebViewConfiguration()
        let userContent = WKUserContentController()
        config.userContentController = userContent
        let enableDevTools = ProcessInfo.processInfo.environment["EMDI_DEVTOOLS"] == "1"
        config.preferences.setValue(enableDevTools, forKey: "developerExtrasEnabled")

        var urlProvider: (String?) -> URL? = { _ in nil }
        let schemeHandler = LocalImageSchemeHandler { tabId in
            urlProvider(tabId)
        }
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "emdi-local")

        if let webDir = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) {
            let appSchemeHandler = AppBundleSchemeHandler(webRootURL: webDir)
            config.setURLSchemeHandler(appSchemeHandler, forURLScheme: "emdi-app")
        }

        let webView = EmdiWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        self.webView = webView

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1140, height: 810),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        let savedThemeId = UserDefaults.standard.string(forKey: "emdi.themeId") ?? "lavender"
        let isLightInitial = (savedThemeId == "paper" || savedThemeId == "sepia")
        window.appearance = NSAppearance(named: isLightInitial ? .aqua : .darkAqua)
        window.backgroundColor = isLightInitial
            ? NSColor(srgbRed: 0.98, green: 0.98, blue: 0.976, alpha: 1.0)
            : NSColor(srgbRed: 0.106, green: 0.114, blue: 0.149, alpha: 1.0)
        window.minSize = NSSize(width: 640, height: 460)
        window.center()

        super.init(window: window)

        urlProvider = { [weak self] tabId in
            guard let self = self else { return nil }
            if let tabId = tabId, let found = self.tabs.first(where: { $0.id == tabId }) {
                return found.fileURL
            }
            return self.activeTab?.fileURL
        }

        webView.isActiveTabMarkdownProvider = { [weak self] in
            (self?.activeTab?.fileKind ?? "markdown") == "markdown"
        }

        webView.onFilesDropped = { [weak self] urls in
            guard let self = self else { return }
            for url in urls {
                self.openOrFocusTab(fileURL: url, anchor: nil)
            }
        }

        window.delegate = self
        userContent.add(self, name: "emdi")
        webView.navigationDelegate = self
        window.contentView = webView

        loadWebBundle()
        startPollTimer()

        let targets = initialURLs.isEmpty ? [nil] : initialURLs
        for item in targets {
            openOrFocusTab(fileURL: item, anchor: nil)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        stopAllMonitoring()
    }

    private func loadWebBundle() {
        if let webDir = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
           FileManager.default.fileExists(atPath: webDir.appendingPathComponent("index.html").path),
           let appURL = URL(string: "emdi-app://app/index.html") {
            webView.load(URLRequest(url: appURL))
            return
        }
        guard let htmlURL = Bundle.main.url(forResource: "index", withExtension: "html") else {
            return
        }
        webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
    }

    // MARK: - Helpers

    private func readFileMeta(_ url: URL) -> FileMeta? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return nil
        }
        let mtime = attrs[.modificationDate] as? Date
        let size = (attrs[.size] as? NSNumber)?.uint64Value ?? 0
        let inode = (attrs[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
        return FileMeta(mtime: mtime, size: size, inode: inode)
    }

    private func sha256Hex(_ text: String) -> String {
        let digest = SHA256.hash(data: Data(text.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func updateSnapshot(for tab: TabSession, url: URL, content: String?) {
        tab.lastKnownMeta = readFileMeta(url)
        tab.lastKnownContentHash = content.map { sha256Hex($0) }
        tab.dismissedExternalHash = nil
        tab.pendingExternalContent = nil
        tab.pendingExternalHash = nil
    }

    private func updateWindowTitle() {
        guard let tab = activeTab else {
            window?.title = "엠디"
            window?.representedURL = nil
            window?.isDocumentEdited = false
            return
        }
        window?.title = tab.displayName
        window?.representedURL = tab.fileURL
        window?.isDocumentEdited = tabs.contains(where: { $0.isDirty })
    }

    private func callWebJS(_ method: String, payload: [String: Any]) {
        if !isWebReady {
            pendingCalls.append((method, payload))
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__emdi && window.__emdi.\(method)(\(json));", completionHandler: nil)
    }

    private func callWebAction(_ expr: String) {
        guard isWebReady else { return }
        webView.evaluateJavaScript("window.__emdi && window.__emdi.\(expr);", completionHandler: nil)
    }

    // MARK: - Tab Management

    func containsFile(_ url: URL) -> TabSession? {
        let std = url.standardizedFileURL
        return tabs.first { $0.fileURL?.standardizedFileURL == std }
    }

    func openOrFocusTab(fileURL: URL?, anchor: String? = nil) {
        if let url = fileURL {
            if !LocalFileResolver.shared.canOpenInTab(url) {
                NSWorkspace.shared.open(url)
                return
            }
            if let existing = containsFile(url) {
                activateTab(id: existing.id, anchor: anchor)
                return
            }
        }

        if let url = fileURL,
           tabs.count == 1,
           tabs[0].fileURL == nil,
           !tabs[0].isDirty {
            loadFileIntoTab(tabs[0], url: url, isExternalReload: false, anchor: anchor)
            activeTabId = tabs[0].id
            updateWindowTitle()
            (NSApp.delegate as? AppDelegate)?.recordRecentFile(url)
            (NSApp.delegate as? AppDelegate)?.persistOpenSession()
            return
        }

        let tab = TabSession(fileURL: fileURL)
        tabs.append(tab)
        activeTabId = tab.id

        if let url = fileURL {
            loadFileIntoTab(tab, url: url, isExternalReload: false, anchor: anchor)
            (NSApp.delegate as? AppDelegate)?.recordRecentFile(url)
        } else {
            callWebJS("openTab", payload: [
                "tabId": tab.id,
                "fileName": tab.displayName,
                "filePath": "",
                "fileKind": "markdown",
                "ext": "md",
                "content": "",
                "previewURL": "",
                "fileSize": 0,
                "activate": true
            ])
        }

        updateWindowTitle()
        (NSApp.delegate as? AppDelegate)?.persistOpenSession()
    }

    private func loadFileIntoTab(_ tab: TabSession, url: URL, isExternalReload: Bool, anchor: String?) {
        let kind = LocalFileResolver.shared.fileKind(for: url)
        let ext = url.pathExtension.lowercased()
        let meta = readFileMeta(url)
        let fileSize = meta?.size ?? 0
        let previewURL = LocalFileResolver.shared.localSchemeURL(for: url)

        // Binary preview kinds (PDF / Image): stream via emdi-local:// without reading into JS string
        if kind == "pdf" || kind == "image" {
            let isNewURL = (tab.fileURL?.standardizedFileURL != url.standardizedFileURL)
            tab.fileURL = url
            tab.fileKind = kind
            updateSnapshot(for: tab, url: url, content: nil)
            if isNewURL || tab.monitoredFD < 0 {
                restartDispatchSource(for: tab, url: url)
            }
            let payload: [String: Any] = [
                "tabId": tab.id,
                "fileName": url.lastPathComponent,
                "filePath": url.standardizedFileURL.path,
                "fileKind": kind,
                "ext": ext,
                "content": "",
                "previewURL": previewURL,
                "fileSize": fileSize,
                "activate": (tab.id == activeTabId)
            ]
            if isExternalReload {
                callWebJS("updateTabExternalContent", payload: payload)
            } else {
                callWebJS("openTab", payload: payload)
            }
            return
        }

        // Guard against massive text files (> 4 MB)
        if fileSize > Self.maxTextReadBytes {
            if !isExternalReload {
                if tabs.count > 1, let idx = tabs.firstIndex(where: { $0.id == tab.id }), tab.lastKnownMeta == nil {
                    tabs.remove(at: idx)
                    activeTabId = tabs.last?.id
                }
                NSWorkspace.shared.open(url)
                callWebJS("showToast", payload: ["message": "대용량 파일(4MB 초과)은 기본 앱으로 열었습니다"])
            }
            return
        }

        do {
            let data = try Data(contentsOf: url)
            let content = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .utf16)
                ?? String(data: data, encoding: .isoLatin1)
                ?? ""
            let isNewURL = (tab.fileURL?.standardizedFileURL != url.standardizedFileURL)
            tab.fileURL = url
            tab.fileKind = kind
            updateSnapshot(for: tab, url: url, content: content)
            if isNewURL || tab.monitoredFD < 0 {
                restartDispatchSource(for: tab, url: url)
            }

            var payload: [String: Any] = [
                "tabId": tab.id,
                "fileName": url.lastPathComponent,
                "filePath": url.standardizedFileURL.path,
                "fileKind": kind,
                "ext": ext,
                "content": content,
                "previewURL": previewURL,
                "fileSize": fileSize,
                "activate": (tab.id == activeTabId)
            ]
            if let anchor = anchor, !anchor.isEmpty {
                payload["anchor"] = anchor
            }

            if isExternalReload {
                callWebJS("updateTabExternalContent", payload: payload)
            } else {
                callWebJS("openTab", payload: payload)
            }
        } catch {
            if !isExternalReload {
                if tabs.count > 1, let idx = tabs.firstIndex(where: { $0.id == tab.id }), tab.lastKnownContentHash == nil {
                    tabs.remove(at: idx)
                    activeTabId = tabs.last?.id
                }
                showAlert(title: "파일을 열 수 없습니다", message: error.localizedDescription)
            }
        }
    }

    func activateTab(id: String, anchor: String? = nil) {
        guard let tab = tabs.first(where: { $0.id == id }) else { return }
        activeTabId = id
        updateWindowTitle()
        var payload: [String: Any] = ["tabId": id]
        if let anchor = anchor, !anchor.isEmpty {
            payload["anchor"] = anchor
        }
        callWebJS("activateTab", payload: payload)
        if tab.fileURL != nil {
            checkForExternalChanges(for: tab, forceRead: false)
        }
    }

    func requestCloseTab(id: String) {
        guard let idx = tabs.firstIndex(where: { $0.id == id }) else { return }
        let tab = tabs[idx]

        if tab.isDirty {
            let alert = NSAlert()
            alert.messageText = "변경 사항을 저장하시겠습니까?"
            alert.informativeText = "\(tab.displayName)의 저장되지 않은 변경 사항이 있습니다."
            alert.alertStyle = .warning
            alert.addButton(withTitle: "저장")
            alert.addButton(withTitle: "저장 안 함")
            alert.addButton(withTitle: "취소")

            let response = alert.runModal()
            switch response {
            case .alertFirstButtonReturn:
                pendingCloseAfterSaveTabId = tab.id
                triggerSave(tabId: tab.id)
                return
            case .alertSecondButtonReturn:
                break
            default:
                return
            }
        }

        performCloseTab(id: tab.id)
    }

    private func performCloseTab(id: String) {
        guard let idx = tabs.firstIndex(where: { $0.id == id }) else { return }
        let removed = tabs.remove(at: idx)
        removed.stopDispatchSource()
        if let url = removed.fileURL {
            closedTabURLs.append(url)
            if closedTabURLs.count > 20 {
                closedTabURLs.removeFirst()
            }
        }

        if tabs.isEmpty {
            window?.close()
            return
        }

        let nextIdx = min(idx, tabs.count - 1)
        let nextActiveId = (activeTabId == id) ? tabs[nextIdx].id : (activeTabId ?? tabs[nextIdx].id)
        activeTabId = nextActiveId
        callWebJS("closeTab", payload: [
            "tabId": id,
            "nextActiveTabId": nextActiveId
        ])
        updateWindowTitle()
        (NSApp.delegate as? AppDelegate)?.persistOpenSession()
    }

    func reopenClosedTab() {
        while let lastURL = closedTabURLs.popLast() {
            if FileManager.default.fileExists(atPath: lastURL.path) {
                openOrFocusTab(fileURL: lastURL, anchor: nil)
                return
            }
        }
    }

    func closeOtherTabs(keepingId: String) {
        let toClose = tabs.filter { $0.id != keepingId }.map { $0.id }
        for id in toClose {
            requestCloseTab(id: id)
        }
    }

    func closeTabsToRight(ofId: String) {
        guard let idx = tabs.firstIndex(where: { $0.id == ofId }) else { return }
        let rightIds = tabs[(idx + 1)...].map { $0.id }
        for id in rightIds {
            requestCloseTab(id: id)
        }
    }

    func reorderTabs(orderedIds: [String]) {
        let byId = Dictionary(uniqueKeysWithValues: tabs.map { ($0.id, $0) })
        var nextTabs: [TabSession] = []
        for id in orderedIds {
            if let t = byId[id] {
                nextTabs.append(t)
            }
        }
        for t in tabs where !nextTabs.contains(where: { $0.id == t.id }) {
            nextTabs.append(t)
        }
        tabs = nextTabs
        (NSApp.delegate as? AppDelegate)?.persistOpenSession()
    }

    func detachTabToNewWindow(id: String) {
        guard tabs.count > 1, let tab = tabs.first(where: { $0.id == id }), let url = tab.fileURL else { return }
        if tab.isDirty {
            showAlert(title: "저장 후 분리해 주세요", message: "저장되지 않은 변경 사항이 있는 탭은 먼저 저장한 뒤 새 창으로 분리할 수 있습니다.")
            return
        }
        performCloseTab(id: id)
        (NSApp.delegate as? AppDelegate)?.openNewWindow(fileURL: url)
    }

    func selectAdjacentTab(delta: Int) {
        guard tabs.count > 1, let currentId = activeTabId,
              let idx = tabs.firstIndex(where: { $0.id == currentId }) else { return }
        let nextIdx = (idx + delta + tabs.count) % tabs.count
        activateTab(id: tabs[nextIdx].id)
    }

    func selectTabAtIndex(_ zeroBasedIndex: Int) {
        guard !tabs.isEmpty else { return }
        let idx = min(max(0, zeroBasedIndex), tabs.count - 1)
        activateTab(id: tabs[idx].id)
    }

    // MARK: - Actions from Menu

    func triggerNewTab() { openOrFocusTab(fileURL: nil, anchor: nil) }

    func triggerCloseActiveTab() {
        guard let id = activeTabId else {
            window?.performClose(nil)
            return
        }
        requestCloseTab(id: id)
    }

    func triggerSave(tabId: String? = nil) {
        let targetId = tabId ?? activeTabId ?? ""
        pendingSaveAsTabId = nil
        callWebJS("requestSave", payload: ["tabId": targetId])
    }

    func triggerSaveAs(tabId: String? = nil) {
        let targetId = tabId ?? activeTabId ?? ""
        pendingSaveAsTabId = targetId
        callWebJS("requestSave", payload: ["tabId": targetId])
    }

    func toggleSourceMode() { callWebAction("toggleSourceMode()") }
    func toggleSidebar() { callWebAction("toggleSidebar()") }
    func toggleFileTree() { callWebAction("toggleFileTree()") }
    func toggleOutline() { callWebAction("toggleOutline()") }
    func revealActiveInTree() { callWebAction("revealActiveInTree()") }
    func toggleFocusMode() { callWebAction("toggleFocusMode()") }
    func openQuickOpen() { callWebAction("openQuickOpen()") }
    func openCommandPalette() { callWebAction("openCommandPalette()") }
    func openSettings(tab: String = "appearance") { callWebJS("openSettings", payload: ["tab": tab]) }
    func applySettingsPayload(_ payload: [String: Any]) { callWebJS("applySettings", payload: payload) }
    func applyWindowTheme(mode: String, bgHex: String) {
        let isLight = (mode == "light")
        window?.appearance = NSAppearance(named: isLight ? .aqua : .darkAqua)
        if let color = Self.colorFromHex(bgHex) {
            window?.backgroundColor = color
        }
    }

    private static func colorFromHex(_ hex: String) -> NSColor? {
        let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        guard cleaned.count == 6, let val = UInt64(cleaned, radix: 16) else { return nil }
        let r = CGFloat((val >> 16) & 0xFF) / 255.0
        let g = CGFloat((val >> 8) & 0xFF) / 255.0
        let b = CGFloat(val & 0xFF) / 255.0
        return NSColor(srgbRed: r, green: g, blue: b, alpha: 1.0)
    }
    func toggleWidthMode() { callWebAction("toggleWidthMode()") }
    func openFind(withReplace: Bool) { callWebJS("openFind", payload: ["replace": withReplace]) }
    func navigateHistory(delta: Int) { callWebJS("navigateHistory", payload: ["delta": delta]) }
    func copyRichText() { callWebAction("copyRichText()") }
    func toggleTaskCheckbox() { callWebAction("toggleTaskCheckbox()") }
    func toggleHighlight() { callWebAction("toggleHighlight()") }
    func openLinkEditor() { callWebAction("openLinkEditor()") }
    func moveLine(delta: Int) { callWebJS("moveLine", payload: ["delta": delta]) }
    func adjustFontSize(_ delta: Double) { callWebAction("adjustFontSize(\(delta))") }
    func resetFontSize() { callWebAction("resetFontSize()") }
    func setAutoSaveEnabled(_ enabled: Bool) { callWebJS("setAutoSave", payload: ["enabled": enabled]) }
    func pushUpdateState(_ payload: [String: Any]) { callWebJS("onUpdateState", payload: payload) }

    func copyVaultRelativePath(asWikiLink: Bool) {
        guard let url = activeTab?.fileURL else {
            callWebJS("showToast", payload: ["message": "저장된 파일이 없습니다"])
            return
        }
        let text: String
        let label: String
        if asWikiLink {
            let stem = url.deletingPathExtension().lastPathComponent.precomposedStringWithCanonicalMapping
            text = "[[\(stem)]]"
            label = "위키링크 복사됨: \(text)"
        } else {
            text = LocalFileResolver.shared.vaultRelativePath(for: url)
            label = "상대경로 복사됨: \(text)"
        }
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        callWebJS("showToast", payload: ["message": label])
    }

    func refreshCurrentTabAndTree() {
        callWebAction("refreshFileTree(true)")
        guard let tab = activeTab, let url = tab.fileURL else {
            callWebJS("showToast", payload: ["message": "파일트리 새로고침됨"])
            return
        }
        if tab.isDirty {
            callWebJS("showToast", payload: ["message": "미저장 변경 사항이 있어 파일트리만 새로고침했습니다"])
            return
        }
        loadFileIntoTab(tab, url: url, isExternalReload: true, anchor: nil)
        callWebJS("showToast", payload: ["message": "문서 및 파일트리 새로고침됨"])
    }

    func navigatePeriodicNote(delta: Int) {
        guard let currentURL = activeTab?.fileURL else {
            callWebJS("showToast", payload: ["message": "주기 노트(일간·주간·월간·연간)에서 사용할 수 있습니다"])
            return
        }
        switch LocalFileResolver.shared.adjacentPeriodicNote(from: currentURL, delta: delta) {
        case .found(let kind, let targetURL):
            if let appDelegate = NSApp.delegate as? AppDelegate {
                appDelegate.openFileInExistingOrWindow(url: targetURL, preferredWindow: self, anchor: nil)
            } else {
                openOrFocusTab(fileURL: targetURL, anchor: nil)
            }
            callWebJS("showToast", payload: ["message": "\(kind.koreanTitle): \(targetURL.lastPathComponent)"])
        case .atBoundary(let kind, let dir):
            let edge = dir < 0 ? "더 이전" : "더 이후"
            callWebJS("showToast", payload: ["message": "\(edge) \(kind.koreanTitle)가 없습니다"])
        case .notPeriodic:
            callWebJS("showToast", payload: ["message": "주기 노트(일간·주간·월간·연간)에서 사용할 수 있습니다"])
        }
    }

    func revealInFinder(tabId: String? = nil, path: String? = nil) {
        if let p = path, !p.isEmpty {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)])
            return
        }
        let target = tabId.flatMap { id in tabs.first { $0.id == id } } ?? activeTab
        guard let url = target?.fileURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    func openWithDefaultApp(tabId: String? = nil, path: String? = nil) {
        if let p = path, !p.isEmpty {
            NSWorkspace.shared.open(URL(fileURLWithPath: p))
            return
        }
        let target = tabId.flatMap { id in tabs.first { $0.id == id } } ?? activeTab
        guard let url = target?.fileURL else { return }
        NSWorkspace.shared.open(url)
    }

    func openPeriodicNote(kind: PeriodicNoteKind) {
        var seeds: [URL] = []
        if let activeURL = activeTab?.fileURL {
            seeds.append(activeURL)
        }
        for tab in tabs {
            if let u = tab.fileURL {
                seeds.append(u)
            }
        }
        if let recent = (NSApp.delegate as? AppDelegate)?.recentFileURLs() {
            seeds.append(contentsOf: recent)
        }

        guard let resolved = LocalFileResolver.shared.resolvePeriodicNote(kind: kind, seedURLs: seeds) else {
            callWebJS("showToast", payload: ["message": "볼트(.obsidian) 경로를 찾을 수 없습니다"])
            return
        }

        if resolved.exists {
            if let appDelegate = NSApp.delegate as? AppDelegate {
                appDelegate.openFileInExistingOrWindow(url: resolved.targetURL, preferredWindow: self, anchor: nil)
            } else {
                openOrFocusTab(fileURL: resolved.targetURL, anchor: nil)
            }
            callWebJS("showToast", payload: ["message": "\(kind.koreanTitle): \(resolved.targetURL.lastPathComponent)"])
            return
        }

        let relPath = resolved.targetURL.path.replacingOccurrences(of: resolved.vaultRoot.path + "/", with: "")
        let alert = NSAlert()
        alert.messageText = "\(kind.periodPhrase)가 아직 없습니다"
        alert.informativeText = "\(relPath)\n\n새 노트를 생성해서 열까요?"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "새로 생성")
        if let latest = resolved.latestExistingURL {
            alert.addButton(withTitle: "최근 노트 열기 (\(latest.lastPathComponent))")
        }
        alert.addButton(withTitle: "취소")

        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            do {
                try FileManager.default.createDirectory(at: resolved.folderURL, withIntermediateDirectories: true)
                let content = LocalFileResolver.shared.renderPeriodicNoteContent(resolution: resolved)
                try content.write(to: resolved.targetURL, atomically: true, encoding: .utf8)
                openOrFocusTab(fileURL: resolved.targetURL, anchor: nil)
                callWebJS("showToast", payload: ["message": "\(kind.koreanTitle) 생성됨: \(resolved.targetURL.lastPathComponent)"])
            } catch {
                showAlert(title: "노트 생성 실패", message: error.localizedDescription)
            }
        } else if response == .alertSecondButtonReturn, let latest = resolved.latestExistingURL {
            if let appDelegate = NSApp.delegate as? AppDelegate {
                appDelegate.openFileInExistingOrWindow(url: latest, preferredWindow: self, anchor: nil)
            } else {
                openOrFocusTab(fileURL: latest, anchor: nil)
            }
            callWebJS("showToast", payload: ["message": "최근 \(kind.koreanTitle): \(latest.lastPathComponent)"])
        }
    }

    // MARK: - Print & PDF Export

    func triggerPrint() {
        guard let window = self.window else { return }
        callWebJS("setPrintMode", payload: ["enabled": true])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) { [weak self] in
            guard let self = self else { return }
            let printInfo = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared
            printInfo.horizontalPagination = .fit
            printInfo.verticalPagination = .automatic
            printInfo.isHorizontallyCentered = true
            printInfo.topMargin = 36
            printInfo.bottomMargin = 36
            printInfo.leftMargin = 36
            printInfo.rightMargin = 36

            let op = self.webView.printOperation(with: printInfo)
            op.showsPrintPanel = true
            op.showsProgressPanel = true
            op.runModal(
                for: window,
                delegate: self,
                didRun: #selector(self.printOperationDidRun(_:success:contextInfo:)),
                contextInfo: nil
            )
        }
    }

    func triggerExportPDF() {
        guard let window = self.window else { return }
        let baseName = activeTab?.fileURL?.deletingPathExtension().lastPathComponent ?? "제목 없음"
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "\(baseName).pdf"
        panel.canCreateDirectories = true

        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self, response == .OK, let targetURL = panel.url else { return }
            self.callWebJS("setPrintMode", payload: ["enabled": true])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { [weak self] in
                guard let self = self else { return }
                let printInfo = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared
                printInfo.jobDisposition = .save
                printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = targetURL
                printInfo.horizontalPagination = .fit
                printInfo.verticalPagination = .automatic
                printInfo.isHorizontallyCentered = true
                printInfo.topMargin = 36
                printInfo.bottomMargin = 36
                printInfo.leftMargin = 36
                printInfo.rightMargin = 36

                let op = self.webView.printOperation(with: printInfo)
                op.showsPrintPanel = false
                op.showsProgressPanel = false
                op.runModal(
                    for: window,
                    delegate: self,
                    didRun: #selector(self.pdfExportOperationDidRun(_:success:contextInfo:)),
                    contextInfo: nil
                )
            }
        }
    }

    @objc private func printOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        callWebJS("setPrintMode", payload: ["enabled": false])
    }

    @objc private func pdfExportOperationDidRun(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        callWebJS("setPrintMode", payload: ["enabled": false])
        if success {
            callWebJS("showToast", payload: ["message": "PDF로 내보냈습니다"])
        } else {
            callWebJS("showToast", payload: ["message": "PDF 내보내기에 실패했습니다"])
        }
    }

    // MARK: - File Saving

    private func saveContent(_ content: String, for tabId: String, forceSaveAs: Bool, isAutoSave: Bool) {
        guard let tab = tabs.first(where: { $0.id == tabId }), tab.isTextEditableKind else { return }

        if !forceSaveAs, let url = tab.fileURL {
            writeToDisk(content: content, url: url, tab: tab, isAutoSave: isAutoSave)
            return
        }

        if isAutoSave { return }

        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "md") ?? .plainText, .plainText, .html]
        panel.nameFieldStringValue = tab.fileURL?.lastPathComponent ?? "제목 없음.md"
        panel.canCreateDirectories = true

        guard let window = self.window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self else { return }
            guard response == .OK, let targetURL = panel.url else {
                if self.pendingCloseAfterSaveTabId == tab.id {
                    self.pendingCloseAfterSaveTabId = nil
                }
                return
            }
            self.writeToDisk(content: content, url: targetURL, tab: tab, isAutoSave: false)
        }
    }

    private func writeToDisk(content: String, url: URL, tab: TabSession, isAutoSave: Bool) {
        do {
            tab.lastSelfSaveDate = Date()
            try content.write(to: url, atomically: true, encoding: .utf8)
            let isNewURL = (tab.fileURL?.standardizedFileURL != url.standardizedFileURL)
            tab.fileURL = url
            tab.fileKind = LocalFileResolver.shared.fileKind(for: url)
            tab.isDirty = false
            updateSnapshot(for: tab, url: url, content: content)
            restartDispatchSource(for: tab, url: url)

            if isNewURL {
                (NSApp.delegate as? AppDelegate)?.recordRecentFile(url)
                (NSApp.delegate as? AppDelegate)?.persistOpenSession()
            }
            updateWindowTitle()

            callWebJS("markSaved", payload: [
                "tabId": tab.id,
                "fileName": url.lastPathComponent,
                "filePath": url.standardizedFileURL.path,
                "previewURL": LocalFileResolver.shared.localSchemeURL(for: url),
                "silent": isAutoSave
            ])

            if pendingCloseAfterSaveTabId == tab.id {
                pendingCloseAfterSaveTabId = nil
                performCloseTab(id: tab.id)
            }
        } catch {
            if !isAutoSave {
                showAlert(title: "저장 실패", message: error.localizedDescription)
            }
        }
    }

    // MARK: - Image Saving

    private func pngData(from rawData: Data) -> Data? {
        let pngMagic: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        if rawData.count >= 8 && Array(rawData.prefix(8)) == pngMagic {
            return rawData
        }
        guard let image = NSImage(data: rawData) else { return nil }
        return pngData(from: image)
    }

    private func pngData(from image: NSImage) -> Data? {
        guard let tiffData = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            return nil
        }
        return png
    }

    private func saveImageDataToAssets(_ data: Data, requestId: String, alt: String, tabId: String?) {
        let tab = tabId.flatMap { id in tabs.first { $0.id == id } } ?? activeTab
        guard let docURL = tab?.fileURL else {
            callWebJS("onImageSaveError", payload: [
                "requestId": requestId,
                "message": "이미지를 붙여넣으려면 먼저 문서를 저장해 주세요."
            ])
            return
        }

        guard let png = pngData(from: data) else {
            callWebJS("onImageSaveError", payload: [
                "requestId": requestId,
                "message": "이미지 데이터를 PNG로 변환할 수 없습니다."
            ])
            return
        }

        let assetsDir = docURL.deletingLastPathComponent().appendingPathComponent("assets", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: assetsDir, withIntermediateDirectories: true)
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
            let baseName = "image-\(formatter.string(from: Date()))"
            var fileName = "\(baseName).png"
            var targetURL = assetsDir.appendingPathComponent(fileName)
            var suffix = 1
            while FileManager.default.fileExists(atPath: targetURL.path) {
                fileName = "\(baseName)-\(suffix).png"
                targetURL = assetsDir.appendingPathComponent(fileName)
                suffix += 1
            }

            try png.write(to: targetURL, options: .atomic)
            callWebJS("onImageSaved", payload: [
                "requestId": requestId,
                "relativePath": "assets/\(fileName)",
                "alt": alt
            ])
        } catch {
            callWebJS("onImageSaveError", payload: [
                "requestId": requestId,
                "message": "이미지 저장 실패: \(error.localizedDescription)"
            ])
        }
    }

    private func handlePasteNativeImage(requestId: String, tabId: String?) {
        let pb = NSPasteboard.general
        if let png = pb.data(forType: .png) {
            saveImageDataToAssets(png, requestId: requestId, alt: "", tabId: tabId)
            return
        }
        if let tiff = pb.data(forType: .tiff) {
            saveImageDataToAssets(tiff, requestId: requestId, alt: "", tabId: tabId)
            return
        }
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] {
            for url in urls {
                if let type = UTType(filenameExtension: url.pathExtension.lowercased()),
                   type.conforms(to: .image),
                   let data = try? Data(contentsOf: url) {
                    let alt = url.deletingPathExtension().lastPathComponent
                    saveImageDataToAssets(data, requestId: requestId, alt: alt, tabId: tabId)
                    return
                }
            }
        }
        callWebJS("onImageSaveError", payload: [
            "requestId": requestId,
            "silent": true,
            "message": ""
        ])
    }

    // MARK: - Link Opening

    private func handleOpenLink(rawTarget: String, isWikiLink: Bool, tabId: String?) {
        let trimmed = rawTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("mailto:") {
            if let url = URL(string: trimmed) {
                NSWorkspace.shared.open(url)
            }
            return
        }

        let tab = tabId.flatMap { id in tabs.first { $0.id == id } } ?? activeTab
        guard let resolved = LocalFileResolver.shared.resolveLink(
            rawTarget: trimmed,
            isWikiLink: isWikiLink,
            baseFileURL: tab?.fileURL
        ) else {
            callWebJS("showToast", payload: [
                "message": "연결된 파일을 찾을 수 없습니다: \(trimmed)"
            ])
            return
        }

        if resolved.fileKind != "external" {
            if let appDelegate = NSApp.delegate as? AppDelegate {
                appDelegate.openFileInExistingOrWindow(url: resolved.url, preferredWindow: self, anchor: resolved.anchor)
            } else {
                openOrFocusTab(fileURL: resolved.url, anchor: resolved.anchor)
            }
        } else {
            NSWorkspace.shared.open(resolved.url)
        }
    }

    // MARK: - File Monitoring (Background Power-Saving Poll)

    private func startPollTimer() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            guard let self = self, NSApp.isActive else { return }
            for tab in self.tabs {
                self.checkForExternalChanges(for: tab, forceRead: false)
            }
        }
        if let timer = pollTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private func pausePollTimer() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func stopAllMonitoring() {
        pollTimer?.invalidate()
        pollTimer = nil
        for tab in tabs {
            tab.stopDispatchSource()
        }
    }

    private func restartDispatchSource(for tab: TabSession, url: URL) {
        tab.stopDispatchSource()
        let fd = open(url.path, O_EVTONLY)
        guard fd >= 0 else { return }
        tab.monitoredFD = fd

        let tabId = tab.id
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete, .attrib],
            queue: .main
        )
        source.setEventHandler { [weak self] in
            guard let self = self,
                  let targetTab = self.tabs.first(where: { $0.id == tabId }),
                  let currentURL = targetTab.fileURL else { return }
            let flags = source.data
            if flags.contains(.rename) || flags.contains(.delete) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    if FileManager.default.fileExists(atPath: currentURL.path) {
                        self.restartDispatchSource(for: targetTab, url: currentURL)
                        self.checkForExternalChanges(for: targetTab, forceRead: true)
                    }
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    self.checkForExternalChanges(for: targetTab, forceRead: true)
                }
            }
        }
        source.resume()
        tab.fileMonitor = source
    }

    private func checkForExternalChanges(for tab: TabSession, forceRead: Bool) {
        guard let currentURL = tab.fileURL else { return }
        if Date().timeIntervalSince(tab.lastSelfSaveDate) < 0.6 {
            return
        }
        guard let currentMeta = readFileMeta(currentURL) else { return }

        if !forceRead, let knownMeta = tab.lastKnownMeta, currentMeta == knownMeta {
            return
        }

        // For binary preview tabs (PDF / Image), reload viewer on metadata change
        if !tab.isTextEditableKind {
            tab.lastKnownMeta = currentMeta
            callWebJS("updateTabExternalContent", payload: [
                "tabId": tab.id,
                "fileName": currentURL.lastPathComponent,
                "filePath": currentURL.standardizedFileURL.path,
                "fileKind": tab.fileKind,
                "ext": currentURL.pathExtension.lowercased(),
                "content": "",
                "previewURL": LocalFileResolver.shared.localSchemeURL(for: currentURL),
                "fileSize": currentMeta.size
            ])
            return
        }

        guard let diskContent = try? String(contentsOf: currentURL, encoding: .utf8) else {
            return
        }
        let diskHash = sha256Hex(diskContent)
        tab.lastKnownMeta = currentMeta

        if diskHash == tab.lastKnownContentHash {
            return
        }

        if tab.monitoredFD < 0 {
            restartDispatchSource(for: tab, url: currentURL)
        }

        if !tab.isDirty {
            tab.lastKnownContentHash = diskHash
            tab.dismissedExternalHash = nil
            tab.pendingExternalContent = nil
            tab.pendingExternalHash = nil
            callWebJS("updateTabExternalContent", payload: [
                "tabId": tab.id,
                "fileName": currentURL.lastPathComponent,
                "filePath": currentURL.standardizedFileURL.path,
                "fileKind": tab.fileKind,
                "ext": currentURL.pathExtension.lowercased(),
                "content": diskContent,
                "previewURL": LocalFileResolver.shared.localSchemeURL(for: currentURL),
                "fileSize": currentMeta.size
            ])
        } else {
            if diskHash == tab.dismissedExternalHash || diskHash == tab.pendingExternalHash {
                return
            }
            tab.pendingExternalContent = diskContent
            tab.pendingExternalHash = diskHash
            callWebJS("notifyExternalConflict", payload: [
                "tabId": tab.id,
                "fileName": currentURL.lastPathComponent,
                "filePath": currentURL.standardizedFileURL.path
            ])
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "emdi",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }

        switch type {
        case "ready":
            isWebReady = true
            let queued = pendingCalls
            pendingCalls.removeAll()
            for item in queued {
                callWebJS(item.method, payload: item.payload)
            }
            let isFull = window?.styleMask.contains(.fullScreen) ?? false
            callWebJS("setFullScreen", payload: ["fullScreen": isFull])
            let autoSave = (NSApp.delegate as? AppDelegate)?.autoSaveEnabled ?? false
            callWebJS("setAutoSave", payload: ["enabled": autoSave])
            if let appDelegate = NSApp.delegate as? AppDelegate {
                callWebJS("applySettings", payload: appDelegate.currentSettingsPayload())
                callWebJS("setChangelog", payload: ["markdown": appDelegate.bundledChangelogMarkdown()])
            }
            callWebJS("onUpdateState", payload: UpdateManager.shared.currentStatePayload())

        case "dirtyChanged":
            let tabId = (body["tabId"] as? String) ?? activeTabId ?? ""
            let dirty = (body["dirty"] as? Bool) ?? false
            if let tab = tabs.first(where: { $0.id == tabId }) {
                tab.isDirty = dirty
            }
            updateWindowTitle()

        case "save":
            let tabId = (body["tabId"] as? String) ?? activeTabId ?? ""
            let content = (body["content"] as? String) ?? ""
            let isAutoSave = (body["autoSave"] as? Bool) ?? false
            let forceAs = (!isAutoSave && pendingSaveAsTabId == tabId)
            if forceAs { pendingSaveAsTabId = nil }
            saveContent(content, for: tabId, forceSaveAs: forceAs, isAutoSave: isAutoSave)

        case "newTab":
            openOrFocusTab(fileURL: nil, anchor: nil)

        case "switchTab":
            if let tabId = body["tabId"] as? String {
                activateTab(id: tabId)
            }

        case "closeTab":
            if let tabId = body["tabId"] as? String {
                requestCloseTab(id: tabId)
            }

        case "closeOtherTabs":
            if let tabId = body["tabId"] as? String {
                closeOtherTabs(keepingId: tabId)
            }

        case "closeRightTabs":
            if let tabId = body["tabId"] as? String {
                closeTabsToRight(ofId: tabId)
            }

        case "detachTab":
            if let tabId = body["tabId"] as? String {
                detachTabToNewWindow(id: tabId)
            }

        case "reorderTabs":
            if let ordered = body["orderedIds"] as? [String] {
                reorderTabs(orderedIds: ordered)
            }

        case "reopenClosedTab":
            reopenClosedTab()

        case "revealInFinder":
            let tabId = body["tabId"] as? String
            let path = body["path"] as? String
            revealInFinder(tabId: tabId, path: path)

        case "openWithDefaultApp":
            let tabId = body["tabId"] as? String
            let path = body["path"] as? String
            openWithDefaultApp(tabId: tabId, path: path)

        case "copyText":
            if let text = body["text"] as? String {
                let pb = NSPasteboard.general
                pb.clearContents()
                pb.setString(text, forType: .string)
            }

        case "copyRich":
            let html = (body["html"] as? String) ?? ""
            let plain = (body["plain"] as? String) ?? ""
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(html, forType: .html)
            pb.setString(plain, forType: .string)

        case "openLink":
            let target = (body["target"] as? String) ?? ""
            let isWiki = (body["isWiki"] as? Bool) ?? false
            let tabId = body["tabId"] as? String
            handleOpenLink(rawTarget: target, isWikiLink: isWiki, tabId: tabId)

        case "openFilePath":
            if let path = body["path"] as? String, !path.isEmpty {
                let url = URL(fileURLWithPath: path)
                if LocalFileResolver.shared.canOpenInTab(url) {
                    if let appDelegate = NSApp.delegate as? AppDelegate {
                        appDelegate.openFileInExistingOrWindow(url: url, preferredWindow: self, anchor: nil)
                    } else {
                        openOrFocusTab(fileURL: url, anchor: nil)
                    }
                } else {
                    NSWorkspace.shared.open(url)
                }
            }

        case "listTreeChildren":
            if let path = body["path"] as? String, !path.isEmpty {
                let requestId = (body["requestId"] as? String) ?? ""
                let onlyMarkdown = (body["onlyMarkdown"] as? Bool) ?? false
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    var result = LocalFileResolver.shared.listTreeChildren(dirPath: path, onlyMarkdown: onlyMarkdown)
                    result["requestId"] = requestId
                    DispatchQueue.main.async {
                        self?.callWebJS("onTreeChildrenLoaded", payload: result)
                    }
                }
            }

        case "searchTreeFiles":
            let rootPath = (body["rootPath"] as? String) ?? ""
            let query = (body["query"] as? String) ?? ""
            let target = (body["target"] as? String) ?? "tree"
            let onlyMarkdown = (body["onlyMarkdown"] as? Bool) ?? false
            let requestId = (body["requestId"] as? String) ?? ""
            guard !rootPath.isEmpty else { return }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let items = LocalFileResolver.shared.searchFiles(in: rootPath, query: query, onlyMarkdown: onlyMarkdown)
                DispatchQueue.main.async {
                    self?.callWebJS("onTreeSearchResults", payload: [
                        "requestId": requestId,
                        "target": target,
                        "query": query,
                        "items": items
                    ])
                }
            }

        case "saveImage":
            let requestId = (body["requestId"] as? String) ?? UUID().uuidString
            let alt = (body["alt"] as? String) ?? ""
            let tabId = body["tabId"] as? String
            guard let base64Str = body["dataBase64"] as? String,
                  let data = Data(base64Encoded: base64Str, options: .ignoreUnknownCharacters) else {
                callWebJS("onImageSaveError", payload: [
                    "requestId": requestId,
                    "message": "잘못된 이미지 데이터입니다."
                ])
                return
            }
            saveImageDataToAssets(data, requestId: requestId, alt: alt, tabId: tabId)

        case "pasteNativeImage":
            let requestId = (body["requestId"] as? String) ?? UUID().uuidString
            let tabId = body["tabId"] as? String
            handlePasteNativeImage(requestId: requestId, tabId: tabId)

        case "resolveExternalConflict":
            let tabId = (body["tabId"] as? String) ?? activeTabId ?? ""
            let action = (body["action"] as? String) ?? "keep"
            guard let tab = tabs.first(where: { $0.id == tabId }) else { return }
            if action == "reload", let url = tab.fileURL {
                if let pendingContent = tab.pendingExternalContent, let pendingHash = tab.pendingExternalHash {
                    tab.lastKnownContentHash = pendingHash
                    tab.lastKnownMeta = readFileMeta(url)
                    tab.dismissedExternalHash = nil
                    tab.pendingExternalContent = nil
                    tab.pendingExternalHash = nil
                    tab.isDirty = false
                    updateWindowTitle()
                    callWebJS("updateTabExternalContent", payload: [
                        "tabId": tab.id,
                        "fileName": url.lastPathComponent,
                        "filePath": url.standardizedFileURL.path,
                        "fileKind": tab.fileKind,
                        "ext": url.pathExtension.lowercased(),
                        "content": pendingContent,
                        "previewURL": LocalFileResolver.shared.localSchemeURL(for: url),
                        "fileSize": tab.lastKnownMeta?.size ?? 0,
                        "force": true
                    ])
                } else {
                    loadFileIntoTab(tab, url: url, isExternalReload: true, anchor: nil)
                }
            } else if action == "keep" {
                tab.dismissedExternalHash = tab.pendingExternalHash
                tab.pendingExternalContent = nil
                tab.pendingExternalHash = nil
            }

        case "toggleAutoSave":
            if let enabled = body["enabled"] as? Bool {
                (NSApp.delegate as? AppDelegate)?.setAutoSaveEnabled(enabled)
            }

        case "openExternal":
            if let urlStr = body["url"] as? String, let url = URL(string: urlStr) {
                NSWorkspace.shared.open(url)
            }

        case "startDrag":
            if let event = NSApp.currentEvent {
                window?.performDrag(with: event)
            }

        case "openPeriodicNote":
            if let rawKind = body["kind"] as? String,
               let kind = PeriodicNoteKind(rawValue: rawKind) {
                openPeriodicNote(kind: kind)
            }

        case "navigatePeriodicNote":
            if let delta = body["delta"] as? Int {
                navigatePeriodicNote(delta: delta)
            }

        case "copyRelativePath":
            let wikiLink = (body["wikiLink"] as? Bool) ?? false
            copyVaultRelativePath(asWikiLink: wikiLink)

        case "refreshAll":
            refreshCurrentTabAndTree()

        case "exportPDF":
            triggerExportPDF()

        case "printDoc":
            triggerPrint()

        case "saveAs":
            triggerSaveAs()

        case "newWindow":
            (NSApp.delegate as? AppDelegate)?.openNewWindow(fileURL: nil)

        case "closeOtherActiveTabs":
            if let id = activeTabId {
                closeOtherTabs(keepingId: id)
            }

        case "checkForUpdates":
            UpdateManager.shared.checkForUpdates(interactive: true)

        case "installUpdate":
            (NSApp.delegate as? AppDelegate)?.requestInstallUpdate()

        case "openReleaseNotes":
            if let urlStr = UpdateManager.shared.latestRelease?.releaseURL, let url = URL(string: urlStr) {
                NSWorkspace.shared.open(url)
            }

        case "dismissUpdateBanner":
            UpdateManager.shared.dismissBannerForCurrentRelease()

        case "saveSettings":
            (NSApp.delegate as? AppDelegate)?.updateSettings(from: body)

        case "openFolder":
            (NSApp.delegate as? AppDelegate)?.openFolderAction()

        case "openFile":
            (NSApp.delegate as? AppDelegate)?.openDocumentAction()

        case "pickDefaultVault":
            (NSApp.delegate as? AppDelegate)?.pickDefaultVaultFolder(for: window)

        case "clearDefaultVault":
            (NSApp.delegate as? AppDelegate)?.clearDefaultVaultFolder()

        default:
            break
        }
    }

    // MARK: - NSWindowDelegate

    func openFolder(url: URL) {
        let std = url.standardizedFileURL
        callWebJS("openFolder", payload: ["path": std.path])
    }

    func windowDidBecomeKey(_ notification: Notification) {
        startPollTimer()
        if let tab = activeTab {
            checkForExternalChanges(for: tab, forceRead: false)
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        pausePollTimer()
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        callWebJS("setFullScreen", payload: ["fullScreen": true])
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        callWebJS("setFullScreen", payload: ["fullScreen": false])
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        let dirtyTabs = tabs.filter { $0.isDirty }
        guard !dirtyTabs.isEmpty else { return true }

        let names = dirtyTabs.map { $0.displayName }.joined(separator: ", ")
        let alert = NSAlert()
        alert.messageText = "저장되지 않은 탭이 있습니다"
        alert.informativeText = "\(names)의 변경 사항을 저장하지 않고 창을 닫으시겠습니까?"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "취소")
        alert.addButton(withTitle: "저장 안 하고 닫기")

        let response = alert.runModal()
        if response == .alertSecondButtonReturn {
            for tab in dirtyTabs {
                tab.isDirty = false
            }
            window?.isDocumentEdited = false
            return true
        }
        return false
    }

    func windowWillClose(_ notification: Notification) {
        stopAllMonitoring()
        (NSApp.delegate as? AppDelegate)?.removeController(self)
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controllers: [EditorWindowController] = []
    private var openedFileAtLaunch = false
    private var recentFilesMenu: NSMenu?
    private var autoSaveMenuItem: NSMenuItem?

    private let recentFilesKey = "emdi.recentFiles"
    private let sessionTabsKey = "emdi.lastSessionTabs"
    private let autoSaveKey = "emdi.autoSaveEnabled"
    private let themeIdKey = "emdi.themeId"
    private let accentIdKey = "emdi.accentId"
    private let fontSizeKey = "emdi.fontSize"
    private let narrowWidthKey = "emdi.narrowWidth"
    private let defaultVaultPathKey = "emdi.defaultVaultPath"

    var autoSaveEnabled: Bool {
        UserDefaults.standard.bool(forKey: autoSaveKey)
    }

    func currentSettingsPayload() -> [String: Any] {
        let ud = UserDefaults.standard
        let fontSize = ud.object(forKey: fontSizeKey) as? Double ?? 15.5
        return [
            "themeId": ud.string(forKey: themeIdKey) ?? "catppuccin-mocha",
            "accentId": ud.string(forKey: accentIdKey) ?? "auto",
            "fontSize": fontSize,
            "narrowWidth": ud.bool(forKey: narrowWidthKey),
            "autoSave": autoSaveEnabled,
            "defaultVaultPath": ud.string(forKey: defaultVaultPathKey) ?? ""
        ]
    }

    func bundledChangelogMarkdown() -> String {
        if let url = Bundle.main.url(forResource: "CHANGELOG", withExtension: "md"),
           let text = try? String(contentsOf: url, encoding: .utf8) {
            return text
        }
        return ""
    }

    func updateSettings(from body: [String: Any]) {
        let ud = UserDefaults.standard
        if let themeId = body["themeId"] as? String {
            ud.set(themeId, forKey: themeIdKey)
        }
        if let accentId = body["accentId"] as? String {
            ud.set(accentId, forKey: accentIdKey)
        }
        if let fontSize = body["fontSize"] as? Double {
            ud.set(fontSize, forKey: fontSizeKey)
        }
        if let narrow = body["narrowWidth"] as? Bool {
            ud.set(narrow, forKey: narrowWidthKey)
        }
        if let autoSave = body["autoSave"] as? Bool {
            setAutoSaveEnabled(autoSave)
        }
        if let mode = body["themeMode"] as? String, let bgHex = body["windowBgHex"] as? String {
            NSApp.appearance = NSAppearance(named: mode == "light" ? .aqua : .darkAqua)
            for c in controllers {
                c.applyWindowTheme(mode: mode, bgHex: bgHex)
            }
        }
        let snapshot = currentSettingsPayload()
        for c in controllers {
            c.applySettingsPayload(snapshot)
        }
    }

    func pickDefaultVaultFolder(for window: NSWindow?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "주기 노트(⌥1~4)에서 사용할 기본 볼트 폴더를 선택하세요."
        let handleOK: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            UserDefaults.standard.set(url.standardizedFileURL.path, forKey: self.defaultVaultPathKey)
            let snapshot = self.currentSettingsPayload()
            for c in self.controllers {
                c.applySettingsPayload(snapshot)
            }
        }
        if let win = window {
            panel.beginSheetModal(for: win, completionHandler: handleOK)
        } else {
            handleOK(panel.runModal())
        }
    }

    func clearDefaultVaultFolder() {
        UserDefaults.standard.removeObject(forKey: defaultVaultPathKey)
        let snapshot = currentSettingsPayload()
        for c in controllers {
            c.applySettingsPayload(snapshot)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        setupMenuBar()
        refreshRecentFilesMenu()

        UpdateManager.shared.onStateChanged = { [weak self] payload in
            guard let self = self else { return }
            for c in self.controllers {
                c.pushUpdateState(payload)
            }
        }
        UpdateManager.shared.startAutoCheck()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self = self else { return }
            if !self.openedFileAtLaunch && self.controllers.isEmpty {
                let restored = self.loadSavedSessionURLs()
                if !restored.isEmpty {
                    let controller = EditorWindowController(initialURLs: restored.map { Optional($0) })
                    self.registerAndShow(controller: controller)
                } else {
                    self.openNewWindow(fileURL: nil)
                }
            }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        openedFileAtLaunch = true
        for url in urls {
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
                openFolderInExistingOrWindow(url: url, preferredWindow: activeController)
            } else {
                openFileInExistingOrWindow(url: url, preferredWindow: activeController, anchor: nil)
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            openNewWindow(fileURL: nil)
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        persistOpenSession()
    }

    func openFileInExistingOrWindow(url: URL, preferredWindow: EditorWindowController?, anchor: String?) {
        if !LocalFileResolver.shared.canOpenInTab(url) {
            NSWorkspace.shared.open(url)
            return
        }

        for controller in controllers {
            if let existing = controller.containsFile(url) {
                controller.activateTab(id: existing.id, anchor: anchor)
                controller.showWindow(nil)
                controller.window?.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
                return
            }
        }

        if let targetWindow = preferredWindow ?? activeController ?? controllers.last {
            targetWindow.openOrFocusTab(fileURL: url, anchor: anchor)
            targetWindow.showWindow(nil)
            targetWindow.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let controller = EditorWindowController(initialURLs: [url])
        registerAndShow(controller: controller)
    }

    func openFolderInExistingOrWindow(url: URL, preferredWindow: EditorWindowController?) {
        if let targetWindow = preferredWindow ?? activeController ?? controllers.last {
            targetWindow.openFolder(url: url)
            targetWindow.showWindow(nil)
            targetWindow.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let controller = EditorWindowController(initialURLs: [nil])
        registerAndShow(controller: controller)
        controller.openFolder(url: url)
    }

    func openNewWindow(fileURL: URL?) {
        let controller = EditorWindowController(initialURLs: [fileURL])
        registerAndShow(controller: controller)
    }

    private func registerAndShow(controller: EditorWindowController) {
        if let lastWindow = controllers.last?.window {
            var frame = lastWindow.frame
            frame.origin.x += 26
            frame.origin.y -= 26
            controller.window?.setFrame(frame, display: true)
        }
        controllers.append(controller)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func removeController(_ controller: EditorWindowController) {
        persistOpenSession()
        controllers.removeAll { $0 === controller }
    }

    private var activeController: EditorWindowController? {
        guard let keyWindow = NSApp.keyWindow else { return controllers.last }
        return controllers.first { $0.window === keyWindow }
    }

    // MARK: - Persistence

    func recentFileURLs() -> [URL] {
        let list = UserDefaults.standard.stringArray(forKey: recentFilesKey) ?? []
        return list.map { URL(fileURLWithPath: $0) }
    }

    func recordRecentFile(_ url: URL) {
        let path = url.standardizedFileURL.path
        var list = UserDefaults.standard.stringArray(forKey: recentFilesKey) ?? []
        list.removeAll { $0 == path }
        list.insert(path, at: 0)
        if list.count > 15 {
            list = Array(list.prefix(15))
        }
        UserDefaults.standard.set(list, forKey: recentFilesKey)
        refreshRecentFilesMenu()
    }

    func persistOpenSession() {
        let paths = controllers.flatMap { $0.tabs.compactMap { $0.fileURL?.standardizedFileURL.path } }
        var seen = Set<String>()
        let unique = paths.filter { seen.insert($0).inserted }
        UserDefaults.standard.set(unique, forKey: sessionTabsKey)
    }

    private func loadSavedSessionURLs() -> [URL] {
        let paths = UserDefaults.standard.stringArray(forKey: sessionTabsKey) ?? []
        return paths
            .filter { FileManager.default.fileExists(atPath: $0) }
            .map { URL(fileURLWithPath: $0) }
    }

    private func refreshRecentFilesMenu() {
        guard let menu = recentFilesMenu else { return }
        menu.removeAllItems()
        let list = (UserDefaults.standard.stringArray(forKey: recentFilesKey) ?? [])
            .filter { FileManager.default.fileExists(atPath: $0) }

        if list.isEmpty {
            let empty = NSMenuItem(title: "최근 연 파일 없음", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
            return
        }

        for path in list {
            let url = URL(fileURLWithPath: path)
            let parentName = url.deletingLastPathComponent().lastPathComponent
            let title = parentName.isEmpty ? url.lastPathComponent : "\(url.lastPathComponent)  (\(parentName))"
            let item = NSMenuItem(title: title, action: #selector(openRecentFileAction(_:)), keyEquivalent: "")
            item.representedObject = path
            item.target = self
            menu.addItem(item)
        }
        menu.addItem(.separator())
        let clear = NSMenuItem(title: "목록 지우기", action: #selector(clearRecentFilesAction), keyEquivalent: "")
        clear.target = self
        menu.addItem(clear)
    }

    func setAutoSaveEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: autoSaveKey)
        autoSaveMenuItem?.state = enabled ? .on : .off
        for c in controllers {
            c.setAutoSaveEnabled(enabled)
        }
    }

    // MARK: - Menu Actions

    @objc private func checkForUpdatesAction() {
        UpdateManager.shared.checkForUpdates(interactive: true)
    }

    @objc private func openSettingsAction() {
        if let active = activeController {
            active.openSettings(tab: "appearance")
        } else {
            openNewWindow(fileURL: nil)
            activeController?.openSettings(tab: "appearance")
        }
    }

    @objc private func openReleaseNotesModalAction() {
        if let active = activeController {
            active.openSettings(tab: "releases")
        } else {
            openNewWindow(fileURL: nil)
            activeController?.openSettings(tab: "releases")
        }
    }

    func requestInstallUpdate() {
        let dirtyTabs = controllers.flatMap { $0.tabs.filter { $0.isDirty } }
        if !dirtyTabs.isEmpty {
            let names = dirtyTabs.map { $0.displayName }.joined(separator: ", ")
            let alert = NSAlert()
            alert.messageText = "저장되지 않은 탭이 있습니다"
            alert.informativeText = "\(names)의 변경 사항을 먼저 저장한 뒤 업데이트하는 것을 권장합니다. 저장하지 않고 업데이트를 진행할까요?"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "취소")
            alert.addButton(withTitle: "저장 안 하고 업데이트")
            if alert.runModal() != .alertSecondButtonReturn {
                return
            }
            for tab in dirtyTabs {
                tab.isDirty = false
            }
            for c in controllers {
                c.window?.isDocumentEdited = false
            }
        }

        UpdateManager.shared.performUpdate { [weak self] in
            self?.persistOpenSession()
            NSApp.terminate(nil)
        }
    }

    @objc private func newTabAction() {
        if let active = activeController {
            active.triggerNewTab()
        } else {
            openNewWindow(fileURL: nil)
        }
    }

    @objc private func newWindowAction() { openNewWindow(fileURL: nil) }

    @objc func openDocumentAction() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.item]
        if panel.runModal() == .OK {
            for url in panel.urls {
                openFileInExistingOrWindow(url: url, preferredWindow: activeController, anchor: nil)
            }
        }
    }

    @objc func openFolderAction() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.message = "탐색기에서 열 폴더를 선택하세요."
        if panel.runModal() == .OK, let url = panel.url {
            openFolderInExistingOrWindow(url: url, preferredWindow: activeController)
        }
    }

    @objc private func openRecentFileAction(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        openFileInExistingOrWindow(url: URL(fileURLWithPath: path), preferredWindow: activeController, anchor: nil)
    }

    @objc private func clearRecentFilesAction() {
        UserDefaults.standard.removeObject(forKey: recentFilesKey)
        refreshRecentFilesMenu()
    }

    @objc private func quickOpenAction() { activeController?.openQuickOpen() }
    @objc private func commandPaletteAction() { activeController?.openCommandPalette() }
    @objc private func closeTabAction() { activeController?.triggerCloseActiveTab() }
    @objc private func closeOtherTabsAction() {
        if let active = activeController, let id = active.activeTabId {
            active.closeOtherTabs(keepingId: id)
        }
    }
    @objc private func reopenClosedTabAction() { activeController?.reopenClosedTab() }
    @objc private func refreshAllAction() { activeController?.refreshCurrentTabAndTree() }
    @objc private func saveDocumentAction() { activeController?.triggerSave() }
    @objc private func saveAsDocumentAction() { activeController?.triggerSaveAs() }
    @objc private func toggleAutoSaveAction() { setAutoSaveEnabled(!autoSaveEnabled) }
    @objc private func exportPDFAction() { activeController?.triggerExportPDF() }
    @objc private func printDocumentAction() { activeController?.triggerPrint() }
    @objc private func revealInFinderAction() { activeController?.revealInFinder() }
    @objc private func openWithDefaultAppAction() { activeController?.openWithDefaultApp() }
    @objc private func findAction() { activeController?.openFind(withReplace: false) }
    @objc private func findAndReplaceAction() { activeController?.openFind(withReplace: true) }
    @objc private func copyRichTextAction() { activeController?.copyRichText() }
    @objc private func copyRelativePathAction() { activeController?.copyVaultRelativePath(asWikiLink: false) }
    @objc private func copyWikiLinkAction() { activeController?.copyVaultRelativePath(asWikiLink: true) }
    @objc private func toggleTaskCheckboxAction() { activeController?.toggleTaskCheckbox() }
    @objc private func toggleHighlightAction() { activeController?.toggleHighlight() }
    @objc private func openLinkEditorAction() { activeController?.openLinkEditor() }
    @objc private func moveLineUpAction() { activeController?.moveLine(delta: -1) }
    @objc private func moveLineDownAction() { activeController?.moveLine(delta: 1) }
    @objc private func toggleSidebarAction() { activeController?.toggleSidebar() }
    @objc private func toggleFileTreeAction() { activeController?.toggleFileTree() }
    @objc private func toggleOutlineAction() { activeController?.toggleOutline() }
    @objc private func revealActiveInTreeAction() { activeController?.revealActiveInTree() }
    @objc private func toggleFocusModeAction() { activeController?.toggleFocusMode() }
    @objc private func toggleSourceAction() { activeController?.toggleSourceMode() }
    @objc private func toggleWidthAction() { activeController?.toggleWidthMode() }
    @objc private func zoomInAction() { activeController?.adjustFontSize(1) }
    @objc private func zoomOutAction() { activeController?.adjustFontSize(-1) }
    @objc private func zoomResetAction() { activeController?.resetFontSize() }
    @objc private func prevTabAction() { activeController?.selectAdjacentTab(delta: -1) }
    @objc private func nextTabAction() { activeController?.selectAdjacentTab(delta: 1) }
    @objc private func goBackAction() { activeController?.navigateHistory(delta: -1) }
    @objc private func goForwardAction() { activeController?.navigateHistory(delta: 1) }
    @objc private func prevPeriodicNoteAction() { activeController?.navigatePeriodicNote(delta: -1) }
    @objc private func nextPeriodicNoteAction() { activeController?.navigatePeriodicNote(delta: 1) }

    @objc private func selectTabByNumberAction(_ sender: NSMenuItem) {
        activeController?.selectTabAtIndex(sender.tag)
    }

    @objc private func openPeriodicNoteAction(_ sender: NSMenuItem) {
        let kind: PeriodicNoteKind
        switch sender.tag {
        case 1: kind = .daily
        case 2: kind = .weekly
        case 3: kind = .monthly
        case 4: kind = .yearly
        default: return
        }
        if let active = activeController {
            active.openPeriodicNote(kind: kind)
        } else {
            openNewWindow(fileURL: nil)
            activeController?.openPeriodicNote(kind: kind)
        }
    }

    private func setupMenuBar() {
        let mainMenu = NSMenu()

        // App Menu
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "엠디에 관하여", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(withTitle: "릴리즈 노트...", action: #selector(openReleaseNotesModalAction), keyEquivalent: "")
        appMenu.addItem(withTitle: "업데이트 확인...", action: #selector(checkForUpdatesAction), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "설정...", action: #selector(openSettingsAction), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "엠디 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "기타 가리기", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "모두 보기", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "엠디 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // File Menu
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "파일")
        fileMenu.addItem(withTitle: "새 탭", action: #selector(newTabAction), keyEquivalent: "t")
        let newWin = fileMenu.addItem(withTitle: "새로운 창", action: #selector(newWindowAction), keyEquivalent: "N")
        newWin.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "열기...", action: #selector(openDocumentAction), keyEquivalent: "o")
        let openFolderItem = fileMenu.addItem(withTitle: "폴더 열기...", action: #selector(openFolderAction), keyEquivalent: "o")
        openFolderItem.keyEquivalentModifierMask = [.command, .option]
        fileMenu.addItem(withTitle: "빠른 파일 열기...", action: #selector(quickOpenAction), keyEquivalent: "k")

        let recentItem = NSMenuItem(title: "최근 항목 열기", action: nil, keyEquivalent: "")
        let recentSub = NSMenu(title: "최근 항목 열기")
        recentItem.submenu = recentSub
        self.recentFilesMenu = recentSub
        fileMenu.addItem(recentItem)

        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "저장", action: #selector(saveDocumentAction), keyEquivalent: "s")
        let saveAs = fileMenu.addItem(withTitle: "다른 이름으로 저장...", action: #selector(saveAsDocumentAction), keyEquivalent: "S")
        saveAs.keyEquivalentModifierMask = [.command, .shift]
        let autoSaveItem = fileMenu.addItem(withTitle: "자동 저장", action: #selector(toggleAutoSaveAction), keyEquivalent: "")
        autoSaveItem.state = autoSaveEnabled ? .on : .off
        self.autoSaveMenuItem = autoSaveItem

        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "문서 및 파일트리 새로고침", action: #selector(refreshAllAction), keyEquivalent: "r")
        let exportPDF = fileMenu.addItem(withTitle: "PDF로 내보내기...", action: #selector(exportPDFAction), keyEquivalent: "E")
        exportPDF.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(withTitle: "인쇄...", action: #selector(printDocumentAction), keyEquivalent: "p")
        fileMenu.addItem(withTitle: "기본 앱으로 열기", action: #selector(openWithDefaultAppAction), keyEquivalent: "")
        let reveal = fileMenu.addItem(withTitle: "Finder에서 보기", action: #selector(revealInFinderAction), keyEquivalent: "R")
        reveal.keyEquivalentModifierMask = [.command, .shift]

        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "탭 닫기", action: #selector(closeTabAction), keyEquivalent: "w")
        let closeOthers = fileMenu.addItem(withTitle: "다른 탭 모두 닫기", action: #selector(closeOtherTabsAction), keyEquivalent: "w")
        closeOthers.keyEquivalentModifierMask = [.command, .option]
        let reopenTab = fileMenu.addItem(withTitle: "닫은 탭 다시 열기", action: #selector(reopenClosedTabAction), keyEquivalent: "T")
        reopenTab.keyEquivalentModifierMask = [.command, .shift]
        let closeWin = fileMenu.addItem(withTitle: "창 닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "W")
        closeWin.keyEquivalentModifierMask = [.command, .shift]
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // Edit Menu
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "편집")
        editMenu.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "실행 복귀", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "복사하기", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        let copyRich = editMenu.addItem(withTitle: "서식 유지 복사", action: #selector(copyRichTextAction), keyEquivalent: "c")
        copyRich.keyEquivalentModifierMask = [.command, .option]
        let copyRel = editMenu.addItem(withTitle: "볼트 상대경로 복사", action: #selector(copyRelativePathAction), keyEquivalent: "C")
        copyRel.keyEquivalentModifierMask = [.command, .shift]
        let copyWiki = editMenu.addItem(withTitle: "위키링크 복사", action: #selector(copyWikiLinkAction), keyEquivalent: "C")
        copyWiki.keyEquivalentModifierMask = [.command, .option, .shift]
        editMenu.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenu.addItem(.separator())
        let toggleTask = editMenu.addItem(withTitle: "체크박스 토글", action: #selector(toggleTaskCheckboxAction), keyEquivalent: "\r")
        toggleTask.keyEquivalentModifierMask = [.command]
        let toggleHl = editMenu.addItem(withTitle: "하이라이트 토글", action: #selector(toggleHighlightAction), keyEquivalent: "H")
        toggleHl.keyEquivalentModifierMask = [.command, .shift]
        let openLinkEd = editMenu.addItem(withTitle: "링크 삽입/편집", action: #selector(openLinkEditorAction), keyEquivalent: "K")
        openLinkEd.keyEquivalentModifierMask = [.command, .shift]
        let moveUp = editMenu.addItem(withTitle: "줄 위로 이동", action: #selector(moveLineUpAction), keyEquivalent: String(UnicodeScalar(NSUpArrowFunctionKey)!))
        moveUp.keyEquivalentModifierMask = [.option]
        let moveDown = editMenu.addItem(withTitle: "줄 아래로 이동", action: #selector(moveLineDownAction), keyEquivalent: String(UnicodeScalar(NSDownArrowFunctionKey)!))
        moveDown.keyEquivalentModifierMask = [.option]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "찾기...", action: #selector(findAction), keyEquivalent: "f")
        let replace = editMenu.addItem(withTitle: "찾기 및 바꾸기...", action: #selector(findAndReplaceAction), keyEquivalent: "f")
        replace.keyEquivalentModifierMask = [.command, .option]
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // View Menu
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "보기")
        let cmdPalette = viewMenu.addItem(withTitle: "커맨드 팔레트...", action: #selector(commandPaletteAction), keyEquivalent: "P")
        cmdPalette.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "사이드바 토글", action: #selector(toggleSidebarAction), keyEquivalent: "b")
        viewMenu.addItem(withTitle: "파일 탐색기 토글", action: #selector(toggleFileTreeAction), keyEquivalent: "e")
        let outlineItem = viewMenu.addItem(withTitle: "문서 목차 토글", action: #selector(toggleOutlineAction), keyEquivalent: "O")
        outlineItem.keyEquivalentModifierMask = [.command, .shift]
        let revealTreeItem = viewMenu.addItem(withTitle: "파일트리에서 현재 파일 보기", action: #selector(revealActiveInTreeAction), keyEquivalent: "L")
        revealTreeItem.keyEquivalentModifierMask = [.command, .shift]
        let focusItem = viewMenu.addItem(withTitle: "집중 모드 토글", action: #selector(toggleFocusModeAction), keyEquivalent: "F")
        focusItem.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(withTitle: "원문/미리보기 전환", action: #selector(toggleSourceAction), keyEquivalent: "/")
        viewMenu.addItem(withTitle: "본문 폭 전환", action: #selector(toggleWidthAction), keyEquivalent: "")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "글자 크게", action: #selector(zoomInAction), keyEquivalent: "=")
        viewMenu.addItem(withTitle: "글자 작게", action: #selector(zoomOutAction), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "기본 크기", action: #selector(zoomResetAction), keyEquivalent: "0")
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(
            withTitle: "전체 화면 전환",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreen.keyEquivalentModifierMask = [.control, .command]
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Navigation Menu
        let navItem = NSMenuItem()
        let navMenu = NSMenu(title: "이동")
        let prevTab = navMenu.addItem(withTitle: "이전 탭", action: #selector(prevTabAction), keyEquivalent: "[")
        prevTab.keyEquivalentModifierMask = [.command, .shift]
        let nextTab = navMenu.addItem(withTitle: "다음 탭", action: #selector(nextTabAction), keyEquivalent: "]")
        nextTab.keyEquivalentModifierMask = [.command, .shift]
        navMenu.addItem(.separator())
        navMenu.addItem(withTitle: "뒤로", action: #selector(goBackAction), keyEquivalent: "[")
        navMenu.addItem(withTitle: "앞으로", action: #selector(goForwardAction), keyEquivalent: "]")
        navMenu.addItem(.separator())
        let periodicItems: [(String, String, Int)] = [
            ("오늘 일간 노트", "1", 1),
            ("이번 주 주간 노트", "2", 2),
            ("이번 달 월간 노트", "3", 3),
            ("올해 연간 노트", "4", 4),
        ]
        for (title, key, tag) in periodicItems {
            let item = navMenu.addItem(
                withTitle: title,
                action: #selector(openPeriodicNoteAction(_:)),
                keyEquivalent: key
            )
            item.keyEquivalentModifierMask = [.option]
            item.tag = tag
        }
        let prevPeriodic = navMenu.addItem(
            withTitle: "이전 주기 노트",
            action: #selector(prevPeriodicNoteAction),
            keyEquivalent: String(UnicodeScalar(NSLeftArrowFunctionKey)!)
        )
        prevPeriodic.keyEquivalentModifierMask = [.command, .option]
        let nextPeriodic = navMenu.addItem(
            withTitle: "다음 주기 노트",
            action: #selector(nextPeriodicNoteAction),
            keyEquivalent: String(UnicodeScalar(NSRightArrowFunctionKey)!)
        )
        nextPeriodic.keyEquivalentModifierMask = [.command, .option]
        navMenu.addItem(.separator())
        for i in 1...9 {
            let tabNum = navMenu.addItem(
                withTitle: "\(i)번 탭으로 이동",
                action: #selector(selectTabByNumberAction(_:)),
                keyEquivalent: "\(i)"
            )
            tabNum.keyEquivalentModifierMask = [.command, .option]
            tabNum.tag = i - 1
        }
        navItem.submenu = navMenu
        mainMenu.addItem(navItem)

        // Window Menu
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "윈도우")
        winMenu.addItem(withTitle: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "확대/축소", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)
        NSApp.windowsMenu = winMenu

        NSApp.mainMenu = mainMenu
    }
}

// MARK: - Entry Point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
