import AppKit
import Foundation

struct UpdateReleaseInfo {
    let version: String
    let tagName: String
    let title: String
    let body: String
    let releaseURL: String
    let assetName: String?
    let assetDownloadURL: String?
    let source: String // "gh", "api", "git"
}

final class UpdateManager {
    static let shared = UpdateManager()

    let repo = "SheepCastle/emdi"
    private let dismissedVersionKey = "emdi.dismissedUpdateVersion"
    private var periodicTimer: Timer?

    private(set) var latestRelease: UpdateReleaseInfo?
    private(set) var status: String = "idle" // idle, checking, available, upToDate, downloading, installing, error
    private(set) var statusMessage: String = ""
    private(set) var bannerDismissed: Bool = false

    var onStateChanged: (([String: Any]) -> Void)?

    var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "0.0.0"
    }

    var currentBuild: String {
        (Bundle.main.infoDictionary?["CFBundleVersion"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "1"
    }

    var osInfo: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        let ver = v.patchVersion > 0
            ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
            : "\(v.majorVersion).\(v.minorVersion)"
        #if arch(arm64)
        let arch = "arm64"
        #elseif arch(x86_64)
        let arch = "x86_64"
        #else
        let arch = "unknown"
        #endif
        return "macOS \(ver) (\(arch))"
    }

    private init() {}

    // MARK: - Lifecycle

    func startAutoCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            self?.checkForUpdates(interactive: false)
        }
        periodicTimer?.invalidate()
        periodicTimer = Timer.scheduledTimer(withTimeInterval: 4 * 60 * 60, repeats: true) { [weak self] _ in
            self?.checkForUpdates(interactive: false)
        }
        if let timer = periodicTimer {
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    func currentStatePayload() -> [String: Any] {
        var payload: [String: Any] = [
            "status": status,
            "currentVersion": currentVersion,
            "currentBuild": currentBuild,
            "osInfo": osInfo,
            "message": statusMessage,
            "bannerDismissed": bannerDismissed,
            "hasUpdate": latestRelease != nil && isVersion(latestRelease!.version, newerThan: currentVersion)
        ]
        if let rel = latestRelease {
            payload["latestVersion"] = rel.version
            payload["tagName"] = rel.tagName
            payload["title"] = rel.title
            payload["body"] = rel.body
            payload["releaseURL"] = rel.releaseURL
            payload["hasBinaryAsset"] = (rel.assetName != nil)
            payload["source"] = rel.source
        }
        return payload
    }

    private func broadcastState(toast: String? = nil) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            var payload = self.currentStatePayload()
            if let t = toast, !t.isEmpty {
                payload["toast"] = t
            }
            self.onStateChanged?(payload)
        }
    }

    func dismissBannerForCurrentRelease() {
        bannerDismissed = true
        if let ver = latestRelease?.version {
            UserDefaults.standard.set(ver, forKey: dismissedVersionKey)
        }
        broadcastState()
    }

    // MARK: - SemVer Comparison

    private func parseSemVer(_ raw: String) -> (Int, Int, Int)? {
        let cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"^[vV]"#, with: "", options: .regularExpression)
            .split(separator: "-").first.map(String.init) ?? ""
        let parts = cleaned.split(separator: ".").compactMap { Int($0) }
        guard !parts.isEmpty else { return nil }
        let major = parts.count > 0 ? parts[0] : 0
        let minor = parts.count > 1 ? parts[1] : 0
        let patch = parts.count > 2 ? parts[2] : 0
        return (major, minor, patch)
    }

    func isVersion(_ remote: String, newerThan local: String) -> Bool {
        guard let r = parseSemVer(remote), let l = parseSemVer(local) else { return false }
        if r.0 != l.0 { return r.0 > l.0 }
        if r.1 != l.1 { return r.1 > l.1 }
        return r.2 > l.2
    }

    // MARK: - Process & Path Helpers

    private func executablePath(named name: String, extraPaths: [String] = []) -> String? {
        let candidates = extraPaths + [
            "/opt/homebrew/bin/\(name)",
            "/usr/local/bin/\(name)",
            "/usr/bin/\(name)",
            "/bin/\(name)"
        ]
        let fm = FileManager.default
        for c in candidates {
            if fm.isExecutableFile(atPath: c) {
                return c
            }
        }
        return nil
    }

    private func runProcess(executable: String, arguments: [String], cwd: String? = nil, timeout: TimeInterval = 25) -> (code: Int32, stdout: String, stderr: String) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: executable)
        proc.arguments = arguments
        if let cwd = cwd {
            proc.currentDirectoryURL = URL(fileURLWithPath: cwd)
        }
        var env = ProcessInfo.processInfo.environment
        let defaultPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        if let existing = env["PATH"], !existing.isEmpty {
            env["PATH"] = "\(defaultPath):\(existing)"
        } else {
            env["PATH"] = defaultPath
        }
        proc.environment = env

        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        do {
            try proc.run()
        } catch {
            return (-1, "", error.localizedDescription)
        }

        let deadline = Date().addingTimeInterval(timeout)
        while proc.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if proc.isRunning {
            proc.terminate()
            return (-2, "", "요청 시간이 초과되었습니다.")
        }

        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        let stdout = String(data: outData, encoding: .utf8) ?? ""
        let stderr = String(data: errData, encoding: .utf8) ?? ""
        return (proc.terminationStatus, stdout, stderr)
    }

    private func localRepoPath() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            home.appendingPathComponent("Sources/emdi"),
            home.appendingPathComponent("Sources/personal/emdi"),
            home.appendingPathComponent("emdi")
        ]
        let fm = FileManager.default
        for dir in candidates {
            if fm.fileExists(atPath: dir.appendingPathComponent(".git").path) &&
               fm.fileExists(atPath: dir.appendingPathComponent("build.sh").path) {
                return dir.path
            }
        }
        return nil
    }

    // MARK: - Check for Updates (3-Tier Fallback: gh CLI -> Public GitHub API -> Local Git Tags)

    func checkForUpdates(interactive: Bool) {
        if status == "checking" || status == "downloading" || status == "installing" {
            return
        }

        status = "checking"
        statusMessage = "업데이트 확인 중..."
        if interactive {
            broadcastState(toast: "최신 버전을 확인하는 중...")
        }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }

            let fetched: UpdateReleaseInfo? =
                self.fetchViaPublicGitHubAPI()
                ?? self.fetchViaGitHubCLI()
                ?? self.fetchViaLocalGitTags()

            DispatchQueue.main.async {
                guard let rel = fetched else {
                    self.status = interactive ? "error" : "idle"
                    self.statusMessage = interactive ? "릴리즈 정보를 불러오지 못했습니다 (gh 로그인 또는 네트워크 확인)" : ""
                    if interactive {
                        self.broadcastState(toast: "업데이트 확인 실패: gh 로그인 또는 네트워크 상태를 확인하세요")
                    }
                    return
                }

                self.latestRelease = rel
                if self.isVersion(rel.version, newerThan: self.currentVersion) {
                    self.status = "available"
                    self.statusMessage = "새 버전 v\(rel.version) 사용 가능 (현재 v\(self.currentVersion))"
                    let dismissed = UserDefaults.standard.string(forKey: self.dismissedVersionKey)
                    self.bannerDismissed = (!interactive && dismissed == rel.version)
                    self.broadcastState(toast: interactive ? "새 버전 v\(rel.version)을 사용할 수 있습니다" : nil)
                } else {
                    self.status = "upToDate"
                    self.statusMessage = "최신 버전입니다 (v\(self.currentVersion))"
                    self.bannerDismissed = true
                    if interactive {
                        self.broadcastState(toast: "이미 최신 버전입니다 (v\(self.currentVersion))")
                    } else {
                        self.broadcastState()
                    }
                }
            }
        }
    }

    private func fetchViaGitHubCLI() -> UpdateReleaseInfo? {
        guard let gh = executablePath(named: "gh") else { return nil }
        let res = runProcess(
            executable: gh,
            arguments: ["release", "view", "--repo", repo, "--json", "tagName,name,body,url,assets"],
            timeout: 15
        )
        guard res.code == 0,
              let data = res.stdout.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tagName"] as? String, !tag.isEmpty else {
            return nil
        }

        let version = tag.replacingOccurrences(of: #"^[vV]"#, with: "", options: .regularExpression)
        let title = (json["name"] as? String) ?? "엠디 \(tag)"
        let body = (json["body"] as? String) ?? ""
        let url = (json["url"] as? String) ?? "https://github.com/\(repo)/releases/tag/\(tag)"

        var assetName: String? = nil
        var assetURL: String? = nil
        if let assets = json["assets"] as? [[String: Any]] {
            if let zipAsset = assets.first(where: { (($0["name"] as? String) ?? "").lowercased().hasSuffix(".zip") }) {
                assetName = zipAsset["name"] as? String
                assetURL = zipAsset["url"] as? String
            }
        }

        return UpdateReleaseInfo(
            version: version,
            tagName: tag,
            title: title,
            body: body,
            releaseURL: url,
            assetName: assetName,
            assetDownloadURL: assetURL,
            source: "gh"
        )
    }

    private func fetchViaPublicGitHubAPI() -> UpdateReleaseInfo? {
        guard let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("emdi/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        let sem = DispatchSemaphore(value: 0)
        var result: UpdateReleaseInfo? = nil

        URLSession.shared.dataTask(with: req) { data, resp, _ in
            defer { sem.signal() }
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200,
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = json["tag_name"] as? String, !tag.isEmpty else {
                return
            }

            let version = tag.replacingOccurrences(of: #"^[vV]"#, with: "", options: .regularExpression)
            let title = (json["name"] as? String) ?? "엠디 \(tag)"
            let body = (json["body"] as? String) ?? ""
            let htmlURL = (json["html_url"] as? String) ?? "https://github.com/\(self.repo)/releases/tag/\(tag)"

            var assetName: String? = nil
            var assetURL: String? = nil
            if let assets = json["assets"] as? [[String: Any]] {
                if let zipAsset = assets.first(where: { (($0["name"] as? String) ?? "").lowercased().hasSuffix(".zip") }) {
                    assetName = zipAsset["name"] as? String
                    assetURL = zipAsset["browser_download_url"] as? String
                }
            }

            result = UpdateReleaseInfo(
                version: version,
                tagName: tag,
                title: title,
                body: body,
                releaseURL: htmlURL,
                assetName: assetName,
                assetDownloadURL: assetURL,
                source: "api"
            )
        }.resume()

        _ = sem.wait(timeout: .now() + 11)
        return result
    }

    private func fetchViaLocalGitTags() -> UpdateReleaseInfo? {
        guard let repoDir = localRepoPath(), let git = executablePath(named: "git") else { return nil }
        let res = runProcess(
            executable: git,
            arguments: ["ls-remote", "--tags", "--refs", "origin"],
            cwd: repoDir,
            timeout: 12
        )
        guard res.code == 0 else { return nil }

        var bestTag: String? = nil
        var bestVer: String = "0.0.0"
        for line in res.stdout.components(separatedBy: .newlines) {
            guard let range = line.range(of: "refs/tags/") else { continue }
            let tag = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            let ver = tag.replacingOccurrences(of: #"^[vV]"#, with: "", options: .regularExpression)
            if parseSemVer(ver) != nil && (bestTag == nil || isVersion(ver, newerThan: bestVer)) {
                bestTag = tag
                bestVer = ver
            }
        }

        guard let tag = bestTag else { return nil }
        return UpdateReleaseInfo(
            version: bestVer,
            tagName: tag,
            title: "엠디 \(tag)",
            body: "",
            releaseURL: "https://github.com/\(repo)/releases/tag/\(tag)",
            assetName: nil,
            assetDownloadURL: nil,
            source: "git"
        )
    }

    // MARK: - One-Click Download, Replace & Relaunch

    func performUpdate(beforeExit: @escaping () -> Void) {
        guard let rel = latestRelease else {
            checkForUpdates(interactive: true)
            return
        }
        guard status != "downloading" && status != "installing" else { return }

        status = "downloading"
        bannerDismissed = false
        statusMessage = "v\(rel.version) 업데이트 준비 중..."
        broadcastState(toast: "v\(rel.version) 업데이트를 시작합니다...")

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            // Strategy 1: Prebuilt .app ZIP from GitHub Release (fast, works on any Mac without dev tools)
            if let assetName = rel.assetName {
                if let extractedApp = self.downloadAndExtractReleaseZip(rel: rel, assetName: assetName) {
                    self.launchSwapAndRelaunch(newAppURL: extractedApp, targetVersion: rel.version, beforeExit: beforeExit)
                    return
                }
            }

            // Strategy 2: Local git pull + ./build.sh fallback
            if let repoDir = self.localRepoPath() {
                DispatchQueue.main.async {
                    self.status = "installing"
                    self.statusMessage = "소스 동기화 및 v\(rel.version) 빌드 중..."
                    self.broadcastState()
                }
                if self.updateFromLocalGitRepo(repoDir: repoDir) {
                    self.launchSimpleRelaunch(targetVersion: rel.version, beforeExit: beforeExit)
                    return
                }
            }

            DispatchQueue.main.async {
                self.status = "available"
                self.statusMessage = "자동 설치 실패 — 릴리즈 페이지를 열었습니다"
                self.broadcastState(toast: "자동 업데이트에 실패했습니다. gh 로그인 또는 로컬 저장소를 확인하세요.")
                if let url = URL(string: rel.releaseURL) {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }

    private func downloadAndExtractReleaseZip(rel: UpdateReleaseInfo, assetName: String) -> URL? {
        let fm = FileManager.default
        let stagingDir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("emdi-update-\(UUID().uuidString)", isDirectory: true)
        do {
            try fm.createDirectory(at: stagingDir, withIntermediateDirectories: true)
        } catch {
            return nil
        }

        let zipPath = stagingDir.appendingPathComponent(assetName)
        var downloaded = false

        DispatchQueue.main.async {
            self.status = "downloading"
            self.statusMessage = "v\(rel.version) 패키지 다운로드 중..."
            self.broadcastState()
        }

        if rel.source == "api", let dlURL = rel.assetDownloadURL, dlURL.hasPrefix("https://"), let curl = executablePath(named: "curl") {
            let res = runProcess(
                executable: curl,
                arguments: ["-fsSL", dlURL, "-o", zipPath.path],
                timeout: 120
            )
            downloaded = (res.code == 0 && fm.fileExists(atPath: zipPath.path))
        }

        if !downloaded, let gh = executablePath(named: "gh") {
            let res = runProcess(
                executable: gh,
                arguments: ["release", "download", rel.tagName, "--repo", repo, "--pattern", assetName, "--dir", stagingDir.path, "--clobber"],
                timeout: 120
            )
            downloaded = (res.code == 0 && fm.fileExists(atPath: zipPath.path))
        }

        if !downloaded, let dlURL = rel.assetDownloadURL, dlURL.hasPrefix("https://"), let curl = executablePath(named: "curl") {
            let res = runProcess(
                executable: curl,
                arguments: ["-fsSL", dlURL, "-o", zipPath.path],
                timeout: 120
            )
            downloaded = (res.code == 0 && fm.fileExists(atPath: zipPath.path))
        }

        guard downloaded else {
            try? fm.removeItem(at: stagingDir)
            return nil
        }

        DispatchQueue.main.async {
            self.status = "installing"
            self.statusMessage = "v\(rel.version) 압축 해제 및 검증 중..."
            self.broadcastState()
        }

        let extractDir = stagingDir.appendingPathComponent("extracted", isDirectory: true)
        try? fm.createDirectory(at: extractDir, withIntermediateDirectories: true)

        guard let ditto = executablePath(named: "ditto") else {
            try? fm.removeItem(at: stagingDir)
            return nil
        }
        let unzip = runProcess(executable: ditto, arguments: ["-x", "-k", zipPath.path, extractDir.path], timeout: 60)
        guard unzip.code == 0 else {
            try? fm.removeItem(at: stagingDir)
            return nil
        }

        // Locate extracted .app bundle
        if let items = try? fm.contentsOfDirectory(at: extractDir, includingPropertiesForKeys: nil),
           let appBundle = items.first(where: { $0.pathExtension.lowercased() == "app" }) {
            let exec = appBundle.appendingPathComponent("Contents/MacOS/emdi")
            if fm.isExecutableFile(atPath: exec.path) {
                return appBundle
            }
        }

        try? fm.removeItem(at: stagingDir)
        return nil
    }

    private func updateFromLocalGitRepo(repoDir: String) -> Bool {
        guard let git = executablePath(named: "git") else { return false }
        let pull = runProcess(executable: git, arguments: ["pull", "--ff-only"], cwd: repoDir, timeout: 60)
        guard pull.code == 0 else { return false }
        let buildScript = URL(fileURLWithPath: repoDir).appendingPathComponent("build.sh").path
        let build = runProcess(executable: "/bin/bash", arguments: [buildScript], cwd: repoDir, timeout: 180)
        return build.code == 0
    }

    private func installTargetAppPath() -> String {
        let bundlePath = Bundle.main.bundlePath
        if bundlePath.hasSuffix(".app") && FileManager.default.isWritableFile(atPath: (bundlePath as NSString).deletingLastPathComponent) {
            return bundlePath
        }
        return "/Applications/엠디.app"
    }

    private func shellQuote(_ str: String) -> String {
        "'" + str.replacingOccurrences(of: "'", with: "'\"'\"'") + "'"
    }

    private func launchSwapAndRelaunch(newAppURL: URL, targetVersion: String, beforeExit: @escaping () -> Void) {
        let targetPath = installTargetAppPath()
        let pid = ProcessInfo.processInfo.processIdentifier
        let stagingRoot = newAppURL.deletingLastPathComponent().deletingLastPathComponent().path

        let script = """
        PID=\(pid)
        for _ in $(seq 1 80); do
          if ! kill -0 "$PID" 2>/dev/null; then break; fi
          sleep 0.1
        done
        TARGET=\(shellQuote(targetPath))
        NEW_APP=\(shellQuote(newAppURL.path))
        STAGING=\(shellQuote(stagingRoot))
        rm -rf "$TARGET"
        mv "$NEW_APP" "$TARGET"
        xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
        /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET" 2>/dev/null || true
        rm -rf "$STAGING"
        open "$TARGET"
        """

        DispatchQueue.main.async {
            self.status = "installing"
            self.statusMessage = "v\(targetVersion) 설치 및 재실행 중..."
            self.broadcastState(toast: "v\(targetVersion) 설치 완료! 엠디를 재실행합니다...")

            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/bin/bash")
            proc.arguments = ["-c", script]
            try? proc.run()

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                beforeExit()
            }
        }
    }

    private func launchSimpleRelaunch(targetVersion: String, beforeExit: @escaping () -> Void) {
        let targetPath = "/Applications/엠디.app"
        let pid = ProcessInfo.processInfo.processIdentifier
        let script = """
        PID=\(pid)
        for _ in $(seq 1 80); do
          if ! kill -0 "$PID" 2>/dev/null; then break; fi
          sleep 0.1
        done
        open \(shellQuote(targetPath))
        """

        DispatchQueue.main.async {
            self.status = "installing"
            self.statusMessage = "v\(targetVersion) 재실행 중..."
            self.broadcastState(toast: "v\(targetVersion) 빌드 완료! 엠디를 재실행합니다...")

            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/bin/bash")
            proc.arguments = ["-c", script]
            try? proc.run()

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                beforeExit()
            }
        }
    }
}
