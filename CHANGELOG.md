# Changelog

엠디(emdi)의 모든 주요 변경 이력을 Semantic Versioning 규칙에 따라 기록합니다.

## [2.7.1] - 2026-11-23

### Added
- **경량 Dataview 표/리스트 미리보기**: `dataview` 코드블록의 기본 쿼리(`TABLE` / `TABLE WITHOUT ID` / `LIST` + `FROM` + `WHERE` + `SORT` + `LIMIT`)를 상시 인덱싱 없이 온디맨드로 렌더링하며, `file.link` 클릭 시 해당 문서로 바로 이동하고 `쿼리 편집 / 표 보기` 전환을 지원합니다.

### Fixed
- **체크박스(`TaskList`) 수직 줄맞춤 수정**: 글자 크기를 바꿔도 체크박스가 항상 첫 줄 텍스트 중앙에 정확히 정렬되도록 보정했습니다.
- **외부 링크 및 백틱 인라인 코드 URL 클릭 열기**: 일반 외부 링크(`https://...`)와 백틱으로 감싼 URL(`` `https://...` ``) 모두 클릭 시 기본 브라우저로 바로 열립니다.
- **한국어 괄호·조사 인접 `**볼드**` / `~~취소선~~` 렌더링 수정**: `**한국딥러닝(KDL)**은`처럼 구두점 뒤에 한글 조사가 붙을 때 볼드가 풀리던 CommonMark 파싱 문제를 해결했습니다.

## [2.7.0] - 2026-11-23

### Added
- **우측 인스펙터 패널 (`Cmd/Ctrl + E`)**: 문서 본문과 파일 탐색기를 함께 보면서 우측에서 **문서 목차(요약 통계 포함) · 할 일 모아보기(즉시 체크/이동) · 연결된 링크 및 볼트 백링크**를 한 번에 확인할 수 있습니다.
- **좌측 사이드바 하단 고정 푸터**: Paseo 스타일의 상시 업데이트 카드(`지금 업데이트` / `변경 내역` / `×` 닫기)와 **설정 · 단축키** 바로가기 버튼을 좌측 하단에 배치했습니다.

### Changed
- `Cmd/Ctrl + E` 단축키를 우측 인스펙터 열기/닫기로 변경했습니다.
- Windows에서도 저장되지 않은 새 파일(`제목 없음.md`)을 닫을 때 저장 확인 대화상자를 표시하며, 경로가 없는 새 파일은 자동 저장되지 않도록 보장합니다.

## [2.6.0] - 2026-11-23

### Added
- **Windows 네이티브 지원 (WebView2 + Rust/Tauri v2)**: `windows/` 네이티브 쉘, GitHub Actions 자동 빌드(`.github/workflows/release-windows.yml`), PowerShell 1줄 설치 스크립트(`scripts/install-release.ps1`)를 추가했습니다.
- **설정 모달 내 `단축키` 안내 탭 (`Cmd/Ctrl + ,`)**: OS에 맞춰 macOS(`⌘/⌥/⇧`)와 Windows(`Ctrl/Alt/Shift`) 단축키를 카테고리별로 바로 확인할 수 있습니다.
- **크로스플랫폼 단축키 및 UI 대응**: Windows 환경에서 `Ctrl` 기반 단축키, `Ctrl+클릭` 링크 열기, 타이틀바 좌측 여백 자동 조정을 지원합니다.

## [2.5.1] - 2026-11-23

### Changed
- **표준 에디터 테마 6종 전면 개편**: 검증된 공식 팔레트(Catppuccin Mocha, Tokyo Night, Nord, Gruvbox Dark, GitHub Light, Catppuccin Latte)로 교체하고, 하드코딩되어 있던 헤딩·링크·인라인 코드·테이블·구문 강조·팝업 메뉴 색상을 모두 시맨틱 CSS 변수로 통일했습니다.
- **새 앱 아이콘(로고) 리디자인**: 깊은 미드나이트 스퀴클 위에 입체 종이접기(Origami Ribbon) `M` 모노그램과 마크다운 다이아몬드 포인트를 적용했습니다.

### Added
- **초기 실행 폴더/파일 열기 UX 개선**: 열린 폴더가 없을 때 사이드바에 `폴더 열기` / `파일 열기` 버튼을 표시하고, `파일 > 폴더 열기... (Cmd + Option + O)` 메뉴·커맨드 팔레트·폴더 드래그 열기 및 빈 에디터 1줄 플레이스홀더를 추가했습니다.
- **터미널 1줄 설치 스크립트 (`scripts/install-release.sh`)**: `curl -fsSL ... | bash` 한 줄로 최신 macOS 릴리즈를 브라우저 quarantine 경고 없이 `/Applications/엠디.app`에 바로 설치할 수 있습니다.

## [2.5.0] - 2026-11-23

### Added
- **설정 및 색상 테마 (`Cmd + ,`)**: 6종 내장 테마(다크 4종: Lavender Dusk, Midnight Slate, Forest Moss, Warm Graphite / 라이트 2종: Paper Light, Warm Sepia)와 6종 포인트 컬러 커스텀, 글자 크기, 본문 폭, 자동 저장, 기본 볼트 경로 지정 기능을 추가했습니다.
- **앱 내 릴리즈 노트 뷰어**: 배포본(`.app`) 내부에 `CHANGELOG.md`를 포함해 `엠디 > 릴리즈 노트...` 또는 `Cmd + ,` 모달에서 오프라인으로도 변경 이력과 업데이트 상태를 바로 확인할 수 있습니다.
- **오픈소스 공개 문서 및 MIT 라이선스**: 프로젝트 목적·철학·설치 가이드를 담은 영문 `README.md`와 `LICENSE`(MIT)를 추가했습니다.

### Performance
- **Mermaid 동적 지연 로딩 (Lazy Load)**: 커스텀 앱 번들 스킴(`emdi-app://`)과 Vite 코드 스플리팅을 적용해 Mermaid 다이어그램이 없는 일반 문서 열람 시 초기 로딩 번들을 대폭 경량화했습니다.
- **외부 파일 변경 감시 백그라운드 절전**: 보조 폴링 주기를 3초로 완화하고 앱이 백그라운드에 있을 때 타이머를 일시 정지해 유휴 CPU·배터리 소모를 최소화했습니다.

### Security
- Mermaid `securityLevel`을 `strict`로 상향하고 에러 출력을 `textContent`로 안전 처리했습니다.
- 로컬 HTML 미리보기 `iframe`에 `sandbox` 속성을 적용하고 불필요한 CORS 와일드카드 및 기본 `developerExtrasEnabled`를 제거했습니다.
- 코드 내 개인 경로·이메일 하드코딩을 완전히 제거하고 사용자 지정 볼트 경로 설정으로 일반화했습니다.

## [2.4.0] - 2026-11-23

### Added
- **Paseo 스타일 앱 내 자동 업데이트**: 실행 시 및 4시간 주기로 GitHub Releases 최신 버전을 자동 확인하고, 새 버전이 있으면 상단 알림 배너와 하단 상태바 업데이트 뱃지(`↑ vX.Y.Z 업데이트`)를 표시합니다.
- **원클릭 다운로드·교체·재실행**: `지금 업데이트` 클릭 시 GitHub Release의 Universal macOS 앱 번들(`.zip`)을 자동 다운로드·검증·교체한 뒤 열린 탭 세션을 유지한 채 새 버전으로 재실행합니다 (`gh` CLI -> Public API -> 로컬 git 저장소 3단 폴백 지원).
- **원스톱 릴리즈 스크립트 (`scripts/release.sh`)**: 버전 범프, Universal Binary(`arm64` + `x86_64`) 빌드, `.app` ZIP 패키징, git 태그·푸시, GitHub Release 에셋 업로드를 한 번에 처리합니다.
- 하단 상태바 버전 표시(클릭 시 즉시 업데이트 확인), `엠디 > 업데이트 확인...` 메뉴, 커맨드 팔레트 업데이트 명령을 추가했습니다.

## [2.3.1] - 2026-11-23

### Fixed
- 리치 에디터에서 표(Table) 셀이나 본문 텍스트를 `Cmd + C`로 복사할 때 `<div class="tableWrapper"><table>...</table></div>` HTML 마크업이 일반 텍스트(`text/plain`)로 복사되던 문제를 수정했습니다.
  - `tiptap-markdown`의 `transformCopiedText`를 비활성화하고 커스텀 `clipboardTextSerializer`를 적용해 단일 셀은 순수 텍스트로, 다중 셀/행은 탭(`\t`)과 줄바꿈(`\n`)으로 깔끔하게 복사됩니다.

### Chore
- 정식 버전 관리 체계(`VERSION`, `VERSIONING.md`, `CHANGELOG.md`, `scripts/bump-version.sh`)를 도입하고 `v2.3.1` 정식 태그 및 GitHub Release를 발행했습니다.

## [2.3.0] - 2026-11-23

### Added
- Obsidian Periodic Notes 설정(`.obsidian/plugins/periodic-notes/data.json`)과 볼트 템플릿을 연동한 주기 노트 탐색(`Option + 1 / 2 / 3 / 4`, 미존재 시 생성 또는 최근 노트 열기 선택)
- 주기 노트 기준 이전/다음 노트 이동(`Option + Left / Right`, `Cmd + Option + Left / Right`, 월별 아카이브 하위 폴더 포함)
- 통합 커맨드 팔레트(`Cmd + Shift + P`)
- 문서 목차 토글(`Cmd + Shift + O`), 파일트리에서 현재 파일 보기(`Cmd + Shift + L`)
- 편집 생산성 단축키: 체크박스 토글(`Cmd + Enter`), 줄/리스트 항목 이동(`Option + Up / Down`), 하이라이트 토글(`Cmd + Shift + H`), 링크 삽입/편집(`Cmd + Shift + K`)
- 볼트 상대경로 복사(`Cmd + Shift + C`), `[[위키링크]]` 복사(`Cmd + Option + Shift + C`), 문서·파일트리 새로고침(`Cmd + R`), 다른 탭 모두 닫기(`Cmd + Option + W`)

## [2.2.0] - 2026-11-23

### Added
- 전체 파일 형식 계층형 파일트리(`전체`/`MD` 토글) 및 내장 HTML 라이브 프리뷰, PDF 뷰어, 이미지 뷰어, 코드/JSON/YAML/CSV 뷰어

## [2.1.0] - 2026-11-23

### Added
- Paseo 스타일 풀하이트 사이드바, 40px 플로팅 필 탭바, 안정적인 재귀 파일트리, 단축키 정렬

## [2.0.0] - 2026-11-23

### Added
- 멀티 탭바, `Cmd + 클릭` 로컬 링크·Obsidian 위키링크 이동, 플로팅 서식 툴바, 슬래시 커맨드, PDF 내보내기
