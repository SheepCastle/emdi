import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

struct ResolvedLocalLink {
    let url: URL
    let anchor: String?
    let fileKind: String
}

enum PeriodicNoteKind: String {
    case daily
    case weekly
    case monthly
    case yearly

    var koreanTitle: String {
        switch self {
        case .daily: return "일간 노트"
        case .weekly: return "주간 노트"
        case .monthly: return "월간 노트"
        case .yearly: return "연간 노트"
        }
    }

    var periodPhrase: String {
        switch self {
        case .daily: return "오늘 일간 노트"
        case .weekly: return "이번 주 주간 노트"
        case .monthly: return "이번 달 월간 노트"
        case .yearly: return "올해 연간 노트"
        }
    }

    var defaultFolder: String {
        switch self {
        case .daily: return "2. Area/Work/1. 일간"
        case .weekly: return "2. Area/Work/2. 주간"
        case .monthly: return "2. Area/Work/3. 월간"
        case .yearly: return "2. Area/Work/4. 연간"
        }
    }

    var defaultFormat: String {
        switch self {
        case .daily: return "YYYY-MM-DD"
        case .weekly: return "GGGG-[W]WW"
        case .monthly: return "YYYY-MM"
        case .yearly: return "YYYY"
        }
    }
}

struct PeriodicNoteResolution {
    let kind: PeriodicNoteKind
    let vaultRoot: URL
    let folderURL: URL
    let targetURL: URL
    let title: String
    let exists: Bool
    let latestExistingURL: URL?
    let templateURL: URL?
}

enum AdjacentPeriodicResult {
    case notPeriodic
    case atBoundary(PeriodicNoteKind, Int)
    case found(PeriodicNoteKind, URL)
}

final class LocalFileResolver {
    static let shared = LocalFileResolver()

    static let markdownExtensions: Set<String> = [
        "md", "markdown", "mdown", "mkd", "mdx"
    ]

    static let htmlExtensions: Set<String> = [
        "html", "htm"
    ]

    static let pdfExtensions: Set<String> = [
        "pdf"
    ]

    static let imageExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "heic", "avif", "ico"
    ]

    static let codeExtensions: Set<String> = [
        "json", "jsonl", "yaml", "yml", "toml", "xml", "plist", "canvas",
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "swift", "py", "rb", "go", "rs",
        "java", "kt", "c", "cc", "cpp", "h", "hpp", "cs", "php",
        "css", "scss", "less", "sql", "sh", "bash", "zsh", "fish", "makefile",
        "dockerfile", "diff", "patch", "graphql"
    ]

    static let textExtensions: Set<String> = [
        "txt", "text", "csv", "tsv", "log", "ini", "cfg", "conf", "env", "properties", "rtf"
    ]

    private static let excludedDirNames: Set<String> = [
        ".git", ".obsidian", "node_modules", ".Trash", "dist", "build", ".build"
    ]

    private struct VaultCacheEntry {
        let builtAt: Date
        let byName: [String: [URL]]
        let byStem: [String: [URL]]
    }

    private let cacheLock = NSLock()
    private var vaultCache: [String: VaultCacheEntry] = [:]
    private let cacheTTL: TimeInterval = 60

    func fileKind(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        if Self.markdownExtensions.contains(ext) { return "markdown" }
        if Self.htmlExtensions.contains(ext) { return "html" }
        if Self.pdfExtensions.contains(ext) { return "pdf" }
        if Self.imageExtensions.contains(ext) { return "image" }
        if Self.codeExtensions.contains(ext) { return "code" }
        if Self.textExtensions.contains(ext) { return "text" }

        // Handle extensionless known text files (Makefile, Dockerfile, LICENSE, etc.)
        let upperName = url.lastPathComponent.uppercased()
        if ["MAKEFILE", "DOCKERFILE", "LICENSE", "README", "CHANGELOG", "PROCFILE"].contains(upperName) {
            return "text"
        }
        return "external"
    }

    func canOpenInTab(_ url: URL) -> Bool {
        fileKind(for: url) != "external"
    }

    func isMarkdownURL(_ url: URL) -> Bool {
        fileKind(for: url) == "markdown"
    }

    func existingFile(_ url: URL) -> URL? {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue {
            return url
        }
        let nfcPath = url.path.precomposedStringWithCanonicalMapping
        if nfcPath != url.path, fm.fileExists(atPath: nfcPath, isDirectory: &isDir), !isDir.boolValue {
            return URL(fileURLWithPath: nfcPath)
        }
        let nfdPath = url.path.decomposedStringWithCanonicalMapping
        if nfdPath != url.path, fm.fileExists(atPath: nfdPath, isDirectory: &isDir), !isDir.boolValue {
            return URL(fileURLWithPath: nfdPath)
        }
        return nil
    }

    private func existingFileOrMarkdown(_ url: URL) -> URL? {
        if let direct = existingFile(url) {
            return direct
        }
        if url.pathExtension.isEmpty {
            let mdURL = url.appendingPathExtension("md")
            if let found = existingFile(mdURL) {
                return found
            }
            let markdownURL = url.appendingPathExtension("markdown")
            if let found = existingFile(markdownURL) {
                return found
            }
        }
        return nil
    }

    func findVaultRoot(from dir: URL) -> URL? {
        let fm = FileManager.default
        var cursor = dir.standardizedFileURL
        for _ in 0..<14 {
            let obsidianDir = cursor.appendingPathComponent(".obsidian")
            if fm.fileExists(atPath: obsidianDir.path) {
                return cursor
            }
            let parent = cursor.deletingLastPathComponent()
            if parent.path == cursor.path { break }
            cursor = parent
        }
        return nil
    }

    private func normalizeKey(_ text: String) -> String {
        text.precomposedStringWithCanonicalMapping.lowercased()
    }

    private func shouldSkipFile(name: String) -> Bool {
        if name.hasPrefix(".") || name.hasPrefix("~$") { return true }
        return false
    }

    private func buildVaultIndex(root: URL) -> VaultCacheEntry {
        let fm = FileManager.default
        var byName: [String: [URL]] = [:]
        var byStem: [String: [URL]] = [:]

        var queue: [URL] = [root]
        var visited = 0
        let maxVisited = 20000

        while !queue.isEmpty && visited < maxVisited {
            let dir = queue.removeFirst()
            guard let items = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for item in items {
                visited += 1
                if visited >= maxVisited { break }
                let name = item.lastPathComponent
                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if !Self.excludedDirNames.contains(name) {
                        queue.append(item)
                    }
                } else {
                    let normName = normalizeKey(name)
                    byName[normName, default: []].append(item)
                    if isMarkdownURL(item) {
                        let stem = item.deletingPathExtension().lastPathComponent
                        let normStem = normalizeKey(stem)
                        byStem[normStem, default: []].append(item)
                    }
                }
            }
        }

        return VaultCacheEntry(builtAt: Date(), byName: byName, byStem: byStem)
    }

    private func vaultIndex(for root: URL, forceRefresh: Bool = false) -> VaultCacheEntry {
        let key = root.standardizedFileURL.path
        cacheLock.lock()
        if !forceRefresh, let cached = vaultCache[key], Date().timeIntervalSince(cached.builtAt) < cacheTTL {
            cacheLock.unlock()
            return cached
        }
        cacheLock.unlock()

        let fresh = buildVaultIndex(root: root)
        cacheLock.lock()
        vaultCache[key] = fresh
        cacheLock.unlock()
        return fresh
    }

    private func pickClosest(candidates: [URL], to baseDir: URL) -> URL? {
        guard !candidates.isEmpty else { return nil }
        if candidates.count == 1 { return candidates[0] }
        let baseComps = baseDir.standardizedFileURL.pathComponents
        return candidates.min { a, b in
            let aComps = a.standardizedFileURL.pathComponents
            let bComps = b.standardizedFileURL.pathComponents
            let aCommon = zip(baseComps, aComps).prefix(while: { $0 == $1 }).count
            let bCommon = zip(baseComps, bComps).prefix(while: { $0 == $1 }).count
            if aCommon != bCommon {
                return aCommon > bCommon
            }
            return a.path.count < b.path.count
        }
    }

    private func searchFilename(
        _ targetName: String,
        allowMarkdownStem: Bool,
        in rootDir: URL,
        maxDepth: Int,
        maxVisited: Int
    ) -> URL? {
        let fm = FileManager.default
        let targetNorm = normalizeKey(targetName)
        var queue: [(URL, Int)] = [(rootDir, 0)]
        var visited = 0

        while !queue.isEmpty && visited < maxVisited {
            let (dir, depth) = queue.removeFirst()
            guard let items = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for item in items {
                visited += 1
                if visited >= maxVisited { break }
                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if depth < maxDepth && !Self.excludedDirNames.contains(item.lastPathComponent) {
                        queue.append((item, depth + 1))
                    }
                } else {
                    let itemNameNorm = normalizeKey(item.lastPathComponent)
                    if itemNameNorm == targetNorm {
                        return item
                    }
                    if allowMarkdownStem && isMarkdownURL(item) {
                        let stemNorm = normalizeKey(item.deletingPathExtension().lastPathComponent)
                        if stemNorm == targetNorm {
                            return item
                        }
                    }
                }
            }
        }
        return nil
    }

    func resolveLocalFile(rawPath: String, baseFileURL: URL?) -> URL? {
        let trimmed = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let decoded = trimmed.removingPercentEncoding ?? trimmed

        if decoded.hasPrefix("file://"), let fileURL = URL(string: trimmed) ?? URL(string: decoded) {
            if let found = existingFile(fileURL) { return found }
        }

        if decoded.hasPrefix("/") {
            if let found = existingFile(URL(fileURLWithPath: decoded)) { return found }
        }

        guard let baseDir = baseFileURL?.deletingLastPathComponent() else {
            return nil
        }

        let relativeCandidate = baseDir.appendingPathComponent(decoded).standardizedFileURL
        if let found = existingFile(relativeCandidate) {
            return found
        }

        let vaultRoot = findVaultRoot(from: baseDir)
        if let vaultRoot = vaultRoot {
            let vaultCandidate = vaultRoot.appendingPathComponent(decoded).standardizedFileURL
            if let found = existingFile(vaultCandidate) {
                return found
            }
        }

        let fileName = (decoded as NSString).lastPathComponent
        if !fileName.isEmpty {
            if let found = searchFilename(fileName, allowMarkdownStem: false, in: baseDir, maxDepth: 2, maxVisited: 500) {
                return found
            }
            let parentDir = baseDir.deletingLastPathComponent()
            if parentDir.path != baseDir.path,
               let found = searchFilename(fileName, allowMarkdownStem: false, in: parentDir, maxDepth: 3, maxVisited: 800) {
                return found
            }
            if let vaultRoot = vaultRoot {
                for commonFolder in ["attachments", "Attachments", "assets", "Assets", "99. Attachments", "3. Resource"] {
                    let candidate = vaultRoot.appendingPathComponent(commonFolder).appendingPathComponent(fileName)
                    if let found = existingFile(candidate) {
                        return found
                    }
                }
                let index = vaultIndex(for: vaultRoot)
                if let candidates = index.byName[normalizeKey(fileName)],
                   let best = pickClosest(candidates: candidates, to: baseDir) {
                    return best
                }
            }
        }

        return nil
    }

    func resolveLink(rawTarget: String, isWikiLink: Bool, baseFileURL: URL?) -> ResolvedLocalLink? {
        let trimmed = rawTarget.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        var targetPart = trimmed
        var anchorPart: String?
        if let hashIdx = trimmed.firstIndex(of: "#") {
            targetPart = String(trimmed[..<hashIdx]).trimmingCharacters(in: .whitespacesAndNewlines)
            let rawAnchor = String(trimmed[trimmed.index(after: hashIdx)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !rawAnchor.isEmpty {
                anchorPart = rawAnchor.removingPercentEncoding ?? rawAnchor
            }
        }

        if targetPart.isEmpty {
            guard let base = baseFileURL else { return nil }
            return ResolvedLocalLink(url: base, anchor: anchorPart, fileKind: fileKind(for: base))
        }

        let decoded = targetPart.removingPercentEncoding ?? targetPart

        if decoded.hasPrefix("file://") {
            let urlCandidate: URL?
            if let u = URL(string: targetPart) {
                urlCandidate = u
            } else {
                let path = String(decoded.dropFirst("file://".count))
                urlCandidate = URL(fileURLWithPath: path)
            }
            if let u = urlCandidate, let found = existingFileOrMarkdown(u) {
                return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
            }
        }

        if decoded.hasPrefix("/") {
            if let found = existingFileOrMarkdown(URL(fileURLWithPath: decoded)) {
                return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
            }
        }

        guard let baseDir = baseFileURL?.deletingLastPathComponent() else {
            return nil
        }

        let relativeCandidate = baseDir.appendingPathComponent(decoded).standardizedFileURL
        if let found = existingFileOrMarkdown(relativeCandidate) {
            return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
        }

        let vaultRoot = findVaultRoot(from: baseDir)
        if let vaultRoot = vaultRoot {
            let vaultCandidate = vaultRoot.appendingPathComponent(decoded).standardizedFileURL
            if let found = existingFileOrMarkdown(vaultCandidate) {
                return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
            }
        }

        let fileName = (decoded as NSString).lastPathComponent
        let allowStem = isWikiLink || (fileName as NSString).pathExtension.isEmpty
        if !fileName.isEmpty {
            if let found = searchFilename(fileName, allowMarkdownStem: allowStem, in: baseDir, maxDepth: 2, maxVisited: 500) {
                return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
            }
            let parentDir = baseDir.deletingLastPathComponent()
            if parentDir.path != baseDir.path,
               let found = searchFilename(fileName, allowMarkdownStem: allowStem, in: parentDir, maxDepth: 3, maxVisited: 800) {
                return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
            }
            if let vaultRoot = vaultRoot {
                let norm = normalizeKey(fileName)
                let lookupInIndex = { (index: VaultCacheEntry) -> URL? in
                    if let byName = index.byName[norm], let best = self.pickClosest(candidates: byName, to: baseDir) {
                        return best
                    }
                    if allowStem, let byStem = index.byStem[norm], let best = self.pickClosest(candidates: byStem, to: baseDir) {
                        return best
                    }
                    return nil
                }

                let index = vaultIndex(for: vaultRoot)
                if let found = lookupInIndex(index) {
                    return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
                }
                let refreshed = vaultIndex(for: vaultRoot, forceRefresh: true)
                if let found = lookupInIndex(refreshed) {
                    return ResolvedLocalLink(url: found, anchor: anchorPart, fileKind: fileKind(for: found))
                }
            }
        }

        return nil
    }

    // MARK: - Hierarchical File Tree Support (All File Formats)

    func listTreeChildren(dirPath: String, onlyMarkdown: Bool = false) -> [String: Any] {
        let targetDir = URL(fileURLWithPath: dirPath).standardizedFileURL
        let fm = FileManager.default
        let vaultRoot = findVaultRoot(from: targetDir)?.standardizedFileURL.path ?? ""
        let parent = targetDir.deletingLastPathComponent()
        let parentPath = parent.path == targetDir.path ? "" : parent.path

        guard let rawItems = try? fm.contentsOfDirectory(
            at: targetDir,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return [
                "dirName": targetDir.lastPathComponent,
                "dirPath": targetDir.path,
                "parentPath": parentPath,
                "vaultRootPath": vaultRoot,
                "items": []
            ]
        }

        var dirs: [(name: String, path: String)] = []
        var files: [(name: String, path: String, kind: String, ext: String)] = []

        for item in rawItems {
            let name = item.lastPathComponent
            if shouldSkipFile(name: name) { continue }
            let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                if !Self.excludedDirNames.contains(name) {
                    dirs.append((name, item.standardizedFileURL.path))
                }
            } else {
                let kind = fileKind(for: item)
                if onlyMarkdown && kind != "markdown" { continue }
                files.append((name, item.standardizedFileURL.path, kind, item.pathExtension.lowercased()))
            }
        }

        dirs.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        files.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

        var payloadItems: [[String: Any]] = []
        for d in dirs {
            payloadItems.append([
                "name": d.name,
                "path": d.path,
                "isDir": true,
                "isMarkdown": false,
                "fileKind": "dir",
                "ext": ""
            ])
        }
        for f in files {
            payloadItems.append([
                "name": f.name,
                "path": f.path,
                "isDir": false,
                "isMarkdown": f.kind == "markdown",
                "fileKind": f.kind,
                "ext": f.ext
            ])
        }

        return [
            "dirName": targetDir.lastPathComponent,
            "dirPath": targetDir.path,
            "parentPath": parentPath,
            "vaultRootPath": vaultRoot,
            "items": payloadItems
        ]
    }

    func searchFiles(in rootPath: String, query: String, onlyMarkdown: Bool = false, limit: Int = 55) -> [[String: Any]] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let rootURL = URL(fileURLWithPath: rootPath).standardizedFileURL
        let rootPrefix = rootURL.path.hasSuffix("/") ? rootURL.path : rootURL.path + "/"
        let normQuery = normalizeKey(trimmed)

        let fm = FileManager.default
        var queue: [(URL, Int)] = [(rootURL, 0)]
        var visited = 0
        let maxVisited = 14000
        var results: [(score: Int, name: String, relPath: String, fullPath: String, kind: String, ext: String)] = []

        while !queue.isEmpty && visited < maxVisited {
            let (dir, depth) = queue.removeFirst()
            guard let items = try? fm.contentsOfDirectory(
                at: dir,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else { continue }

            for item in items {
                visited += 1
                if visited >= maxVisited { break }
                let name = item.lastPathComponent
                if shouldSkipFile(name: name) { continue }
                let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                if isDir {
                    if depth < 8 && !Self.excludedDirNames.contains(name) {
                        queue.append((item, depth + 1))
                    }
                } else {
                    let kind = fileKind(for: item)
                    if onlyMarkdown && kind != "markdown" { continue }
                    let fullPath = item.standardizedFileURL.path
                    let relPath = fullPath.hasPrefix(rootPrefix) ? String(fullPath.dropFirst(rootPrefix.count)) : name
                    let ext = item.pathExtension.lowercased()
                    let kindBias = (kind == "markdown") ? 0 : (kind == "external" ? 2 : 1)

                    if normQuery.isEmpty {
                        results.append((depth * 3 + kindBias, name, relPath, fullPath, kind, ext))
                    } else {
                        let normName = normalizeKey(name)
                        let normRel = normalizeKey(relPath)
                        if normName.hasPrefix(normQuery) {
                            results.append((kindBias, name, relPath, fullPath, kind, ext))
                        } else if normName.contains(normQuery) {
                            results.append((10 + kindBias, name, relPath, fullPath, kind, ext))
                        } else if normRel.contains(normQuery) {
                            results.append((20 + kindBias, name, relPath, fullPath, kind, ext))
                        }
                    }
                }
            }
        }

        results.sort {
            if $0.score != $1.score { return $0.score < $1.score }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }

        return results.prefix(limit).map { item in
            [
                "name": item.name,
                "relPath": item.relPath,
                "path": item.fullPath,
                "isDir": false,
                "isMarkdown": item.kind == "markdown",
                "fileKind": item.kind,
                "ext": item.ext
            ]
        }
    }

    func localSchemeURL(for fileURL: URL) -> String {
        var comps = URLComponents()
        comps.scheme = "emdi-local"
        comps.host = "local"
        comps.path = fileURL.standardizedFileURL.path
        return comps.string ?? "emdi-local://file?path=\(fileURL.standardizedFileURL.path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
    }

    // MARK: - Obsidian Periodic Notes Support (Option + 1/2/3/4)

    func resolveDefaultVaultRoot(seedURLs: [URL]) -> URL? {
        for seed in seedURLs {
            var isDir: ObjCBool = false
            let fm = FileManager.default
            let startDir: URL
            if fm.fileExists(atPath: seed.path, isDirectory: &isDir), isDir.boolValue {
                startDir = seed
            } else {
                startDir = seed.deletingLastPathComponent()
            }
            if let root = findVaultRoot(from: startDir) {
                return root
            }
        }

        let fm = FileManager.default
        if let saved = UserDefaults.standard.string(forKey: "emdi.defaultVaultPath"),
           !saved.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let trimmed = saved.trimmingCharacters(in: .whitespacesAndNewlines)
            var isDir: ObjCBool = false
            for p in [trimmed, trimmed.precomposedStringWithCanonicalMapping, trimmed.decomposedStringWithCanonicalMapping] {
                if fm.fileExists(atPath: p, isDirectory: &isDir), isDir.boolValue {
                    return URL(fileURLWithPath: p).standardizedFileURL
                }
            }
        }
        return nil
    }

    private func formatMomentPattern(_ pattern: String, date: Date) -> String {
        let greg = Calendar(identifier: .gregorian)
        let iso = Calendar(identifier: .iso8601)
        let gComps = greg.dateComponents([.year, .month, .day, .weekday], from: date)
        let iComps = iso.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)

        let year = String(format: "%04d", gComps.year ?? 2026)
        let isoYear = String(format: "%04d", iComps.yearForWeekOfYear ?? (gComps.year ?? 2026))
        let month = String(format: "%02d", gComps.month ?? 1)
        let day = String(format: "%02d", gComps.day ?? 1)
        let isoWeek = String(format: "%02d", iComps.weekOfYear ?? 1)
        let weekdaysKo = ["일", "월", "화", "수", "목", "금", "토"]
        let weekdayIdx = max(0, min(6, (gComps.weekday ?? 1) - 1))
        let dddKo = weekdaysKo[weekdayIdx]

        var result = ""
        var idx = pattern.startIndex
        while idx < pattern.endIndex {
            let ch = pattern[idx]
            if ch == "[" {
                if let close = pattern[pattern.index(after: idx)...].firstIndex(of: "]") {
                    result.append(contentsOf: pattern[pattern.index(after: idx)..<close])
                    idx = pattern.index(after: close)
                    continue
                }
            }

            let rem = pattern[idx...]
            if rem.hasPrefix("YYYY") {
                result.append(year)
                idx = pattern.index(idx, offsetBy: 4)
            } else if rem.hasPrefix("GGGG") || rem.hasPrefix("gggg") {
                result.append(isoYear)
                idx = pattern.index(idx, offsetBy: 4)
            } else if rem.hasPrefix("ddd") {
                result.append(dddKo)
                idx = pattern.index(idx, offsetBy: 3)
            } else if rem.hasPrefix("MM") {
                result.append(month)
                idx = pattern.index(idx, offsetBy: 2)
            } else if rem.hasPrefix("DD") {
                result.append(day)
                idx = pattern.index(idx, offsetBy: 2)
            } else if rem.hasPrefix("WW") || rem.hasPrefix("ww") {
                result.append(isoWeek)
                idx = pattern.index(idx, offsetBy: 2)
            } else {
                result.append(ch)
                idx = pattern.index(after: idx)
            }
        }
        return result
    }

    private func existingDirectory(_ url: URL) -> URL {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue {
            return url
        }
        let nfc = url.path.precomposedStringWithCanonicalMapping
        if fm.fileExists(atPath: nfc, isDirectory: &isDir), isDir.boolValue {
            return URL(fileURLWithPath: nfc)
        }
        let nfd = url.path.decomposedStringWithCanonicalMapping
        if fm.fileExists(atPath: nfd, isDirectory: &isDir), isDir.boolValue {
            return URL(fileURLWithPath: nfd)
        }
        return url
    }

    private func findLatestMarkdownInFolder(_ folderURL: URL) -> URL? {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(
            at: folderURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        let mdFiles = items.filter { item in
            let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            return !isDir && isMarkdownURL(item)
        }
        return mdFiles.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedDescending
        }.first
    }

    func resolvePeriodicNote(kind: PeriodicNoteKind, seedURLs: [URL], date: Date = Date()) -> PeriodicNoteResolution? {
        guard let vaultRoot = resolveDefaultVaultRoot(seedURLs: seedURLs) else {
            return nil
        }

        var folderRel = kind.defaultFolder
        var formatStr = kind.defaultFormat
        var templateRel = ""

        let periodicConfigURL = vaultRoot.appendingPathComponent(".obsidian/plugins/periodic-notes/data.json")
        if let data = try? Data(contentsOf: periodicConfigURL),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let section = json[kind.rawValue] as? [String: Any] {
            if let f = section["folder"] as? String, !f.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                folderRel = f.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if let fmt = section["format"] as? String, !fmt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                formatStr = fmt.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            if let tpl = section["template"] as? String, !tpl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                templateRel = tpl.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        } else if kind == .daily {
            let dailyConfigURL = vaultRoot.appendingPathComponent(".obsidian/daily-notes.json")
            if let data = try? Data(contentsOf: dailyConfigURL),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let f = json["folder"] as? String, !f.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    folderRel = f.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                if let fmt = json["format"] as? String, !fmt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    formatStr = fmt.trimmingCharacters(in: .whitespacesAndNewlines)
                }
                if let tpl = json["template"] as? String, !tpl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    templateRel = tpl.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
        }

        let folderURL = existingDirectory(vaultRoot.appendingPathComponent(folderRel))
        let noteTitle = formatMomentPattern(formatStr, date: date)
        let expectedURL = folderURL.appendingPathComponent("\(noteTitle).md")
        let foundExisting = existingFile(expectedURL)

        var templateURL: URL? = nil
        if !templateRel.isEmpty {
            let rawTpl = vaultRoot.appendingPathComponent(templateRel)
            templateURL = existingFileOrMarkdown(rawTpl)
        }

        let latestExisting = foundExisting == nil ? findLatestMarkdownInFolder(folderURL) : nil

        return PeriodicNoteResolution(
            kind: kind,
            vaultRoot: vaultRoot,
            folderURL: folderURL,
            targetURL: foundExisting ?? expectedURL,
            title: noteTitle,
            exists: foundExisting != nil,
            latestExistingURL: latestExisting,
            templateURL: templateURL
        )
    }

    func renderPeriodicNoteContent(resolution: PeriodicNoteResolution, date: Date = Date()) -> String {
        if let tplURL = resolution.templateURL,
           let raw = try? String(contentsOf: tplURL, encoding: .utf8) {
            var output = raw.replacingOccurrences(of: "{{title}}", with: resolution.title)
            output = output.replacingOccurrences(of: "{{date}}", with: formatMomentPattern("YYYY-MM-DD", date: date))
            if let regex = try? NSRegularExpression(pattern: #"\{\{date:([^}]+)\}\}"#, options: []) {
                let nsRange = NSRange(output.startIndex..<output.endIndex, in: output)
                let matches = regex.matches(in: output, options: [], range: nsRange)
                for match in matches.reversed() {
                    guard let fullRange = Range(match.range, in: output),
                          let fmtRange = Range(match.range(at: 1), in: output) else { continue }
                    let fmt = String(output[fmtRange])
                    let formatted = formatMomentPattern(fmt, date: date)
                    output.replaceSubrange(fullRange, with: formatted)
                }
            }
            return output
        }

        let isoDate = formatMomentPattern("YYYY-MM-DD", date: date)
        return """
        ---
        title: "\(resolution.title)"
        date: \(isoDate)
        type: \(resolution.kind.rawValue)
        ---
        # \(resolution.title)

        """
    }

    private func collectPeriodicFiles(in folderURL: URL) -> [URL] {
        let fm = FileManager.default
        var results: [URL] = []
        guard let topItems = try? fm.contentsOfDirectory(
            at: folderURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        for item in topItems {
            let name = item.lastPathComponent
            if shouldSkipFile(name: name) { continue }
            let isDir = (try? item.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                if !Self.excludedDirNames.contains(name),
                   let subItems = try? fm.contentsOfDirectory(
                       at: item,
                       includingPropertiesForKeys: [.isDirectoryKey],
                       options: [.skipsHiddenFiles]
                   ) {
                    for sub in subItems {
                        let subIsDir = (try? sub.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                        if !subIsDir && isMarkdownURL(sub) {
                            results.append(sub)
                        }
                    }
                }
            } else if isMarkdownURL(item) {
                results.append(item)
            }
        }

        return results.sorted { a, b in
            let aStem = a.deletingPathExtension().lastPathComponent.precomposedStringWithCanonicalMapping
            let bStem = b.deletingPathExtension().lastPathComponent.precomposedStringWithCanonicalMapping
            let cmp = aStem.localizedStandardCompare(bStem)
            if cmp != .orderedSame { return cmp == .orderedAscending }
            return a.path < b.path
        }
    }

    private func canonicalPath(_ url: URL) -> String {
        url.resolvingSymlinksInPath().standardizedFileURL.path.precomposedStringWithCanonicalMapping
    }

    func adjacentPeriodicNote(from currentURL: URL, delta: Int) -> AdjacentPeriodicResult {
        let stdCurrent = currentURL.standardizedFileURL
        let currentNormPath = canonicalPath(stdCurrent)
        guard let vaultRoot = findVaultRoot(from: stdCurrent.deletingLastPathComponent()) else {
            return .notPeriodic
        }

        let kinds: [PeriodicNoteKind] = [.daily, .weekly, .monthly, .yearly]
        for kind in kinds {
            guard let res = resolvePeriodicNote(kind: kind, seedURLs: [vaultRoot]) else { continue }
            let folderNorm = canonicalPath(res.folderURL)
            let prefix = folderNorm.hasSuffix("/") ? folderNorm : folderNorm + "/"
            guard currentNormPath.hasPrefix(prefix) else { continue }

            let files = collectPeriodicFiles(in: res.folderURL)
            guard let idx = files.firstIndex(where: {
                canonicalPath($0) == currentNormPath
            }) else {
                return .notPeriodic
            }

            let nextIdx = idx + delta
            if nextIdx < 0 || nextIdx >= files.count {
                return .atBoundary(kind, delta)
            }
            return .found(kind, files[nextIdx])
        }

        return .notPeriodic
    }

    private func parseSimpleYAMLFrontmatter(_ content: String) -> [String: Any] {
        guard content.hasPrefix("---\n") || content.hasPrefix("---\r\n") else { return [:] }
        let lines = content.components(separatedBy: .newlines)
        guard lines.count > 2 else { return [:] }

        var props: [String: Any] = [:]
        var currentArrayKey: String? = nil
        var currentArray: [String] = []

        func flushArray() {
            if let k = currentArrayKey {
                props[k] = currentArray
                currentArrayKey = nil
                currentArray = []
            }
        }

        for i in 1..<min(lines.count, 120) {
            let rawLine = lines[i]
            let trimmed = rawLine.trimmingCharacters(in: .whitespaces)
            if trimmed == "---" || trimmed == "..." {
                flushArray()
                break
            }
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }

            if trimmed.hasPrefix("- "), let _ = currentArrayKey {
                var item = String(trimmed.dropFirst(2)).trimmingCharacters(in: .whitespaces)
                if (item.hasPrefix("\"") && item.hasSuffix("\"")) || (item.hasPrefix("'") && item.hasSuffix("'")) {
                    item = String(item.dropFirst().dropLast())
                }
                if !item.isEmpty { currentArray.append(item) }
                continue
            }

            guard let colonIdx = rawLine.firstIndex(of: ":") else { continue }
            flushArray()

            let key = String(rawLine[..<colonIdx]).trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            let valPart = String(rawLine[rawLine.index(after: colonIdx)...]).trimmingCharacters(in: .whitespaces)

            if valPart.isEmpty {
                currentArrayKey = key
                currentArray = []
            } else if valPart.hasPrefix("[") && valPart.hasSuffix("]") {
                let inner = String(valPart.dropFirst().dropLast())
                let items = inner.split(separator: ",").map { s -> String in
                    var t = s.trimmingCharacters(in: .whitespaces)
                    if (t.hasPrefix("\"") && t.hasSuffix("\"")) || (t.hasPrefix("'") && t.hasSuffix("'")) {
                        t = String(t.dropFirst().dropLast())
                    }
                    return t
                }.filter { !$0.isEmpty }
                props[key] = items
            } else {
                var val = valPart
                if (val.hasPrefix("\"") && val.hasSuffix("\"")) || (val.hasPrefix("'") && val.hasSuffix("'")) {
                    val = String(val.dropFirst().dropLast())
                }
                props[key] = val
            }
        }
        flushArray()
        return props
    }

    func queryDataviewFolder(from: String, baseFileURL: URL?) -> [[String: Any]] {
        let fm = FileManager.default
        let baseDir = baseFileURL?.deletingLastPathComponent()
        let vaultRoot = baseDir.flatMap { findVaultRoot(from: $0) }
            ?? resolveDefaultVaultRoot(seedURLs: baseFileURL.map { [$0] } ?? [])

        var targetDir: URL?
        let cleanedFrom = from.trimmingCharacters(in: CharacterSet(charactersIn: " \"'/"))
        if !cleanedFrom.isEmpty {
            if let root = vaultRoot {
                let cand = root.appendingPathComponent(cleanedFrom).standardizedFileURL
                if fm.fileExists(atPath: cand.path) { targetDir = cand }
            }
            if targetDir == nil, let bDir = baseDir {
                let cand = bDir.appendingPathComponent(cleanedFrom).standardizedFileURL
                if fm.fileExists(atPath: cand.path) { targetDir = cand }
            }
        } else {
            targetDir = baseDir ?? vaultRoot
        }

        guard let dir = targetDir else { return [] }
        guard let enumerator = fm.enumerator(
            at: dir,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .contentModificationDateKey, .creationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        let skipDirs: Set<String> = ["node_modules", ".git", "target", "dist", "build", "__pycache__"]
        var results: [[String: Any]] = []

        for case let candidate as URL in enumerator {
            let name = candidate.lastPathComponent
            let values = try? candidate.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .contentModificationDateKey, .creationDateKey])
            if values?.isDirectory == true {
                if skipDirs.contains(name) { enumerator.skipDescendants() }
                continue
            }
            guard values?.isRegularFile == true else { continue }
            let ext = candidate.pathExtension.lowercased()
            guard ext == "md" || ext == "markdown" else { continue }

            // Read only first 4 KB for fast frontmatter extraction
            var headText = ""
            if let fh = try? FileHandle(forReadingFrom: candidate) {
                if let data = try? fh.read(upToCount: 4096) {
                    headText = String(data: data, encoding: .utf8) ?? ""
                }
                try? fh.close()
            }

            let props = parseSimpleYAMLFrontmatter(headText)
            let mtime = values?.contentModificationDate.map { df.string(from: $0) } ?? ""
            let ctime = values?.creationDate.map { df.string(from: $0) } ?? ""

            results.append([
                "name": candidate.deletingPathExtension().lastPathComponent,
                "path": candidate.standardizedFileURL.path,
                "folder": candidate.deletingLastPathComponent().lastPathComponent,
                "ctime": ctime,
                "mtime": mtime,
                "props": props
            ])
            if results.count >= 300 { break }
        }

        return results
    }

    func findBacklinks(for fileURL: URL) -> [[String: Any]] {
        let std = fileURL.standardizedFileURL
        let stem = std.deletingPathExtension().lastPathComponent
        guard !stem.isEmpty else { return [] }

        let parentDir = std.deletingLastPathComponent()
        let searchRoot = findVaultRoot(from: parentDir) ?? parentDir
        let rootNorm = canonicalPath(searchRoot)
        let prefix = rootNorm.hasSuffix("/") ? rootNorm : rootNorm + "/"
        let selfPath = canonicalPath(std)
        let needleLower = "[[\(stem.lowercased())"

        let fm = FileManager.default
        guard let enumerator = fm.enumerator(
            at: searchRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        var results: [[String: Any]] = []
        let skipDirs: Set<String> = ["node_modules", ".git", "target", "dist", "build", "__pycache__"]

        for case let candidate as URL in enumerator {
            let name = candidate.lastPathComponent
            let values = try? candidate.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values?.isDirectory == true {
                if skipDirs.contains(name) { enumerator.skipDescendants() }
                continue
            }
            guard values?.isRegularFile == true else { continue }
            let ext = candidate.pathExtension.lowercased()
            guard ext == "md" || ext == "markdown" else { continue }
            let candNorm = canonicalPath(candidate)
            if candNorm == selfPath { continue }

            guard let content = try? String(contentsOf: candidate, encoding: .utf8) else { continue }
            let lower = content.lowercased()
            guard let range = lower.range(of: needleLower) else { continue }

            // Ensure exact wikilink stem match (followed by ]], |, or #)
            let afterIdx = range.upperBound
            if afterIdx < lower.endIndex {
                let nextCh = lower[afterIdx]
                if nextCh != "]" && nextCh != "|" && nextCh != "#" {
                    continue
                }
            }

            let lineRange = content.lineRange(for: range)
            let snippet = String(content[lineRange]).trimmingCharacters(in: .whitespacesAndNewlines)
            let relPath = candNorm.hasPrefix(prefix) ? String(candNorm.dropFirst(prefix.count)) : name

            results.append([
                "name": candidate.deletingPathExtension().lastPathComponent,
                "path": candidate.standardizedFileURL.path,
                "relPath": relPath,
                "snippet": String(snippet.prefix(140))
            ])
            if results.count >= 40 { break }
        }

        return results.sorted {
            (($0["name"] as? String) ?? "").localizedCaseInsensitiveCompare(($1["name"] as? String) ?? "") == .orderedAscending
        }
    }

    func vaultRelativePath(for fileURL: URL) -> String {
        let stdFile = canonicalPath(fileURL)
        if let vaultRoot = findVaultRoot(from: fileURL.deletingLastPathComponent()) {
            let rootNorm = canonicalPath(vaultRoot)
            let prefix = rootNorm.hasSuffix("/") ? rootNorm : rootNorm + "/"
            if stdFile.hasPrefix(prefix) {
                return String(stdFile.dropFirst(prefix.count))
            }
        }
        return stdFile
    }
}

// MARK: - Local Asset URL Scheme Handler (Images, HTML + Relative Assets, PDF)

final class LocalImageSchemeHandler: NSObject, WKURLSchemeHandler {
    private let baseFileURLProvider: (String?) -> URL?

    init(baseFileURLProvider: @escaping (String?) -> URL?) {
        self.baseFileURLProvider = baseFileURLProvider
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "emdi-local", code: 400))
            return
        }

        let resolvedURL: URL?
        if requestURL.host == "local" {
            // Direct local path (preserves relative URL resolution for HTML/CSS/JS/PDF!)
            let rawPath = requestURL.path
            resolvedURL = LocalFileResolver.shared.existingFile(URL(fileURLWithPath: rawPath))
        } else {
            let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false)
            let rawPath = components?.queryItems?.first(where: { $0.name == "path" })?.value ?? ""
            let tabId = components?.queryItems?.first(where: { $0.name == "tabId" })?.value
            if rawPath.isEmpty {
                resolvedURL = nil
            } else {
                resolvedURL = LocalFileResolver.shared.resolveLocalFile(
                    rawPath: rawPath,
                    baseFileURL: baseFileURLProvider(tabId)
                )
            }
        }

        guard let targetURL = resolvedURL,
              let data = try? Data(contentsOf: targetURL) else {
            let notFound = HTTPURLResponse(
                url: requestURL,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/plain; charset=utf-8"]
            )!
            urlSchemeTask.didReceive(notFound)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        let mimeType = mimeTypeFor(url: targetURL)
        let headers: [String: String] = [
            "Content-Type": mimeType,
            "Content-Length": "\(data.count)",
            "Cache-Control": "no-cache"
        ]
        let response = HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Synchronous local read; nothing to cancel.
    }

    private func mimeTypeFor(url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "json", "canvas": return "application/json; charset=utf-8"
        case "pdf": return "application/pdf"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "bmp": return "image/bmp"
        case "heic": return "image/heic"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "txt", "md", "yaml", "yml", "csv", "xml": return "text/plain; charset=utf-8"
        default:
            if let utType = UTType(filenameExtension: ext), let mime = utType.preferredMIMEType {
                return mime
            }
            return "application/octet-stream"
        }
    }
}

// MARK: - App Bundle Scheme Handler (emdi-app://app/...) for Lazy-Loaded ES Modules

final class AppBundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRootURL: URL

    init(webRootURL: URL) {
        self.webRootURL = webRootURL.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(NSError(domain: "emdi-app", code: 400))
            return
        }

        var relPath = requestURL.path
        if relPath.hasPrefix("/") {
            relPath.removeFirst()
        }
        if relPath.isEmpty {
            relPath = "index.html"
        }

        let candidate = webRootURL.appendingPathComponent(relPath).standardizedFileURL
        let rootPrefix = webRootURL.path.hasSuffix("/") ? webRootURL.path : webRootURL.path + "/"
        guard candidate.path == webRootURL.path || candidate.path.hasPrefix(rootPrefix),
              let data = try? Data(contentsOf: candidate) else {
            let notFound = HTTPURLResponse(
                url: requestURL,
                statusCode: 404,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/plain; charset=utf-8"]
            )!
            urlSchemeTask.didReceive(notFound)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        let mime = mimeType(for: candidate.pathExtension.lowercased())
        let response = HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime,
                "Content-Length": "\(data.count)",
                "Cache-Control": "no-cache"
            ]
        )!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func mimeType(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return "application/octet-stream"
        }
    }
}
