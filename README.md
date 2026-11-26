# 엠디 (emdi) v2.7.2

**한국어** | [English](README.en.md)

**엠디 (emdi)** 는 Electron 없이 macOS 네이티브(AppKit + `WKWebView`)와 Windows 네이티브(Rust + `WebView2`)로 만든 **약 3 MB대 초경량 마크다운 & 볼트 에디터**입니다.

---

## 만든 이유

기존 마크다운 에디터나 노트 앱들은 `.md` 파일 하나를 열기 위해 Chromium 브라우저와 Node.js 런타임 전체를 함께 묶어 수백 MB의 용량과 메모리를 사용합니다.

**엠디 (emdi)** 는 Finder나 탐색기에서 `.md` 파일을 더블클릭했을 때 메모장처럼 즉시 열리면서도, Obsidian 볼트·위키링크·주기 노트·Mermaid 다이어그램·다양한 프로젝트 파일까지 깔끔하게 다룰 수 있는 가벼운 네이티브 도구를 목표로 만들었습니다.

### 핵심 특징
- **초경량 네이티브 (Zero Electron)**: macOS Universal 바이너리 ~3.2 MB, Windows x64 바이너리 ~3.0 MB. 상시 백그라운드 인덱싱이나 과도한 파일 감시 없이 가볍게 동작합니다.
- **Obsidian 볼트 호환, 강제 종속 없음**: 일반 폴더나 기존 Obsidian 볼트를 그대로 열어 사용할 수 있습니다. `[[위키링크]]`, `[[노트#제목]]` 앵커, YAML 속성(frontmatter), 콜아웃(`> [!NOTE]`), `==형광펜==`, 주기 노트 설정을 볼트 구조를 건드리지 않고 그대로 지원합니다.
- **3단 집중 레이아웃**: 좌측 파일 탐색기(하단 업데이트 카드 · 설정 · 단축키 바로가기), 중앙 마크다운 에디터, 우측 인스펙터(`Cmd/Ctrl + E` — 목차 · 할 일 · 연결 노트/백링크).
- **검증된 6종 표준 테마 (`Cmd/Ctrl + ,`)**: *Catppuccin Mocha*, *Tokyo Night*, *Nord*, *Gruvbox Dark*, *GitHub Light*, *Catppuccin Latte* + 6종 포인트 컬러.

---

## 설치 방법

터미널(macOS) 또는 PowerShell(Windows)에 아래 한 줄을 붙여넣고 실행하면 최신 버전이 바로 설치됩니다.

### macOS (13 이상, Apple Silicon & Intel)

```bash
curl -fsSL https://raw.githubusercontent.com/SheepCastle/emdi/main/scripts/install-release.sh | bash
```

설치 후 응용 프로그램, Spotlight 또는 Raycast에서 **엠디**를 실행하세요. 이후 업데이트는 좌측 하단 업데이트 카드 또는 `엠디 > 업데이트 확인...`에서 원클릭으로 진행할 수 있습니다.

### Windows (10 / 11, x64)

```powershell
irm https://raw.githubusercontent.com/SheepCastle/emdi/main/scripts/install-release.ps1 | iex
```

관리자 권한 없이 `%LocalAppData%\Programs\emdi\`에 설치되며 시작 메뉴 바로가기와 `.md` / `.markdown` 파일 연결까지 자동으로 등록됩니다.

<details>
<summary>직접 소스에서 빌드하기 (macOS)</summary>

필요 환경: macOS 13+, Xcode Command Line Tools (`swiftc`), Node.js / npm

```bash
git clone https://github.com/SheepCastle/emdi.git
cd emdi
./install.sh
```

`./install.sh`를 실행하면 `/Applications/엠디.app`으로 빌드·설치되고 `.md` / `.markdown` 기본 앱으로 등록됩니다.

</details>

---

## 주요 기능

- **멀티 탭 & 멀티 포맷 뷰어**: `.md`, `.html`(샌드박스 실시간 미리보기 + 소스 편집), `.pdf`(내장 뷰어), 이미지(확대/라이트박스), 코드/JSON/YAML/CSV(구문 강조 및 표 미리보기)를 탭에서 바로 엽니다. 그 외 파일은 OS 기본 앱으로 자연스럽게 연결됩니다.
- **편리한 마크다운 편집**: 리치 WYSIWYG와 원문 전환(`Cmd/Ctrl + /`), 선택 플로팅 툴바, 빈 줄 `/` 슬래시 메뉴, 표 미니 툴바, 찾기 및 바꾸기(`Cmd/Ctrl + F`), 지연 로딩 Mermaid 다이어그램, 깔끔한 표 텍스트 복사.
- **우측 인스펙터 (`Cmd/Ctrl + E`)**: 문서 목차와 요약(글자 수 · 예상 읽기 시간 · 할 일 진행률), 체크박스 할 일 모아보기(즉시 체크/이동), 나가는 링크와 볼트 백링크를 한눈에 확인합니다.
- **주기 노트 (`Option/Alt + 1 / 2 / 3 / 4`)**: 오늘의 일간·주간·월간·연간 노트로 바로 이동하고, `Option/Alt + ← / →`로 이전/다음 주기 노트를 오갑니다.
- **자동 업데이트 알림**: 실행 시 최신 릴리즈를 자동 확인하며, 새 버전이 있으면 좌측 하단에 업데이트 카드가 표시됩니다.

---

## 주요 단축키

Windows에서는 `Cmd` 대신 `Ctrl`, `Option` 대신 `Alt`를 사용합니다. 앱 내 좌측 하단 **단축키** 버튼(`Cmd/Ctrl + ,` → 단축키 탭)에서도 OS에 맞춰 바로 확인할 수 있습니다.

| 분류 | 단축키 (macOS) | 기능 |
| :--- | :--- | :--- |
| **앱 · 설정** | `Cmd + ,` | 설정, 테마, 단축키, 릴리즈 노트 |
| | `Cmd + Shift + P` | 커맨드 팔레트 |
| | `Cmd + K` | 빠른 파일 열기 |
| **파일 · 폴더** | `Cmd + O` / `Cmd + Option + O` | 파일 열기 / 폴더 열기 |
| | `Cmd + S` / `Cmd + Shift + S` | 저장 / 다른 이름으로 저장 |
| | `Cmd + R` | 문서 및 파일트리 새로고침 |
| **화면 구성** | `Cmd + B` / `Cmd + \` | 좌측 사이드바 열기/닫기 |
| | `Cmd + E` | 우측 인스펙터 열기/닫기 (목차 · 할 일 · 연결) |
| | `Cmd + Shift + O` | 문서 목차 바로 열기 |
| | `Cmd + Shift + L` | 파일트리에서 현재 파일 위치 보기 |
| | `Cmd + Shift + F` | 집중 모드 (사이드바 숨김) |
| | `Cmd + /` | 원문 마크다운 / 미리보기 전환 |
| **탭 · 이동** | `Cmd + T` / `Cmd + W` / `Cmd + Shift + T` | 새 탭 / 탭 닫기 / 닫은 탭 다시 열기 |
| | `Cmd + 1~9` | 탭 번호로 바로 이동 |
| | `Cmd + [` / `]` | 탭 히스토리 뒤로 / 앞으로 |
| | `Cmd + 클릭` | 로컬 링크 · `[[위키링크]]` · 외부 URL 열기 |
| **주기 노트** | `Option + 1 / 2 / 3 / 4` | 오늘 일간 / 주간 / 월간 / 연간 노트 |
| | `Option + ← / →` | 이전 / 다음 주기 노트 이동 |
| **편집 · 내보내기** | `Cmd + Enter` | 체크박스 토글 (`- [ ]` / `- [x]`) |
| | `Option + ↑ / ↓` | 현재 줄 또는 목록 위/아래 이동 |
| | `Cmd + F` / `Cmd + Option + F` | 찾기 / 찾기 및 바꾸기 |
| | `Cmd + Shift + E` / `Cmd + P` | PDF 내보내기 / 인쇄 |

---

## 보안 및 개인정보

- **100% 로컬 우선**: 작성한 문서는 기기 밖으로 전송되지 않습니다. 분석 도구, 텔레메트리, 클라우드 계정이 전혀 없습니다.
- **최소 네트워크 통신**: 외부 요청은 GitHub Releases 최신 버전 확인(`api.github.com/repos/SheepCastle/emdi/releases/latest`)뿐입니다.
- **안전한 미리보기**: 로컬 HTML 미리보기는 `iframe` 샌드박스에서 실행되며, Mermaid는 `securityLevel: 'strict'` 모드로 렌더링됩니다.

---

## 버전 관리 및 라이선스

- [Semantic Versioning](VERSIONING.md) 규칙을 따르며, 상세 변경 이력은 [`CHANGELOG.md`](CHANGELOG.md)와 앱 내 릴리즈 노트 뷰어에서 확인할 수 있습니다.
- [MIT License](LICENSE)로 배포됩니다.
