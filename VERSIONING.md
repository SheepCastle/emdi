# 엠디 (emdi) 버전 관리 규칙

엠디는 [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`) 규칙을 따릅니다.

## 버전 증가 기준

- **MAJOR (`X.0.0`)**: 에디터 엔진 교체, 앱 아키텍처 전면 개편, 기존 단축키·설정 호환성이 깨지는 대규모 변경
- **MINOR (`x.Y.0`)**: 하위 호환을 유지하는 새 기능 추가 (새 파일 포맷 뷰어, 주기 노트 탐색, 커맨드 팔레트, 단축키 세트 등)
- **PATCH (`x.y.Z`)**: 버그 수정, 복사·렌더링 패치, 안정성 및 미세 UX 개선

## 단일 버전 원천과 동기화 대상

루트의 `VERSION` 파일이 버전의 단일 기준이며, 아래 파일은 `./scripts/bump-version.sh`를 통해 항상 함께 동기화합니다.

| 파일 | 동기화 필드 |
| :--- | :--- |
| `VERSION` | `X.Y.Z` |
| `macos/Info.plist` | `CFBundleShortVersionString` (`X.Y.Z`), `CFBundleVersion` (빌드 번호 +1 자동 증가) |
| `web/package.json` | `"version": "X.Y.Z"` |
| `README.md` | 상단 `# 엠디 (emdi) vX.Y.Z` |
| `CHANGELOG.md` | 해당 버전 변경 이력 기록 |

## 정식 릴리즈 절차

원스톱 스크립트로 버전 상승, Universal Binary 빌드, `.app` ZIP 패키징, 태그 푸시, GitHub Release 에셋 업로드를 한 번에 실행합니다.

```bash
cd ~/Sources/emdi
# CHANGELOG.md 갱신 후
./scripts/release.sh patch   # 또는 minor / major / 2.4.0
```

다른 PC에서 실행 중인 엠디 앱은 다음 자동 체크 또는 `엠디 > 업데이트 확인...`(하단 상태바 버전 클릭) 시 새 릴리즈를 감지하며, `지금 업데이트` 버튼으로 즉시 교체·재실행됩니다.
