# 맥 세션 전달 문서 — 갤러리 도구(🧹 Tools) 반영 (웹 v0.23.0 예정)

작성: 웹 세션. 읽는 사람: 맥 세션. 변경 기록 전체는 `docs/MAC_SYNC_FROM_WEB.md`, 맥 쪽 진행은 `macos/STATUS.md`.
**커밋 해시·태그는 웹 세션이 커밋한 뒤 `docs/MAC_SYNC_FROM_WEB.md` 맨 위 항목에 채운다.** 아래 "올릴 버전"은 예정값이다.

## 1. 결론 먼저 — 맥 앱은 이번에 다시 빌드할 필요가 없다
- 이번 변경은 **웹 화면(갤러리 🧹 Tools 팝업)** 뿐이다. 맥 앱은 Windows 서버가 내려 주는 화면을 창에 여는 껍데기라서,
  서버가 새 화면을 서빙하면 **맥에서도 바로 새 화면이 나온다.** `macos/` 폴더 변경 없음, 새 dmg·새 `mac-v…` 릴리즈 불필요.
- 억지로 맥 버전을 올려 릴리즈하면 사용자가 받을 새 기능이 없는 릴리즈가 하나 늘 뿐이다(자동 업데이트도 아직 없음). **권장하지 않는다.**
- 그래도 맥 릴리즈를 꼭 만들어야 하는 경우의 절차는 §5에 적어 두었다.

## 2. 변경 내용 (웹 쪽)
- 노드 v1.56.0(커밋 6341603, 태그 v1.56.0)의 **갤러리 도구**를 웹에 옮김: 모든 갤러리 헤더의 `🧹 Tools` 버튼 → 팝업 `Gallery tools — <폴더>`
  - **🧹 Cleanup**: 스캔 → 고아 메타/썸네일, 임시 파일, 누락 썸네일, 빈 폴더, 죽은 즐겨찾기를 휴지통으로/정리, "Rebuild ALL thumbnails".
  - **📁 Merge folder**: output 폴더 트리에서 폴더를 골라 현재 폴더로 병합(미리보기 → 확인 → 병합).
  - **🗑 Trash**: 정리·병합으로 지운 항목을 복원하거나 영구 삭제, "Empty the whole trash".
- 붙은 곳: 이미지 갤러리 9종(Klein, Z-Image, Krea2, SDXL, Qwen 2511, Qwen 2.1, Anima, Moss, H3 이미지), H3 영상, LTX 영상 갤러리(헤더 버튼), Music(재생목록 새로고침 옆 🧹 아이콘).
- 웹 파일: `src/shared/galleryTools.ts`(새 파일) + 위 갤러리 파일들. **맥 폴더 변경 없음.**
- 같은 릴리즈에 들어갈 다른 수정(웹 화면만): LTX 2.5 설정의 OpenRouter 모델 목록(실패한 목록을 기억하던 문제).

## 3. 서버(Windows PC)에 필요한 것 — 맥이 아니라 서버 쪽
- **노드 팩 v1.56.0 이상**(`ComfyUI-TJ_NODE_STUDIO_ONE`)이 설치된 ComfyUI. 도구가 부르는 서버 경로는 `/tj_shared/gallery_tools/*`(노드 팩이 제공, 웹은 포팅하지 않음).
  노드 팩이 v1.56.0 미만이거나 ComfyUI를 재시작하지 않았으면 도구 팝업이 `HTTP 404` 오류를 보여 준다.
- 웹 쪽: Windows PC에서 새 `dist`를 서빙해야 한다 — `npm run build` 후 `serve.mjs`를 다시 시작(`start.bat`이 pull → install → build → serve를 한 번에 한다).
  Windows 데스크톱 앱(Tauri)은 새 설치 파일로 업데이트.
- `serve.mjs`/`comfy_paths.json`은 **바뀌지 않았다.** `/tj_shared`는 이미 프록시 목록에 있다 → 맥 앱이 기대는 서버 약속(`docs/MAC_SYNC_FROM_WEB.md` §3)도 그대로.

## 4. 맥에서 확인할 것 (직접 눌러 보고 `macos/STATUS.md`에 한 것/못 한 것을 구분해 기록)
1. 맥 앱으로 서버에 접속해 아무 갤러리를 연다 → 헤더에 `🧹 Tools`(Music은 🧹 아이콘)가 보인다.
2. 팝업이 뜨고 세 탭(Cleanup / Merge folder / Trash)이 바뀐다. 팝업은 화면 전체를 덮는 오버레이(`z-index` 100000/100001)다.
3. **`confirm()` 대화상자**: Merge 실행, 휴지통 항목 삭제, "Empty the whole trash"가 `window.confirm()`을 쓴다. 이 앱의 `WKUIDelegate`(confirm → `NSAlert`) 경로로 **취소/확인이 실제로 동작하는지** 본다 — 이 변경이 맥 앱에 닿는 **유일한** 지점이다.
4. 폴더 선택 트리(📂 Choose folder…)에서 폴더 선택·더블클릭이 된다.
5. **시험은 임시 폴더나 비어 있는 갤러리로 한다.** 정리·병합은 실제 파일을 옮기고(휴지통으로) 병합은 원본 폴더를 지운다. 사용자의 실제 갤러리에서 병합하지 말 것. 서버 GPU는 이 기능과 무관하지만 서버가 쓰는 중이면 팝업만 열어 보는 정도로 확인한다.

## 5. (필요한 경우에만) 맥 릴리즈를 새로 만드는 정확한 절차
맥 코드(`macos/`)가 바뀌었을 때의 절차다. **이번 변경만으로는 하지 않는다.**
```bash
git pull --rebase origin master
# 1) macos/AIOneStudio.xcodeproj/project.pbxproj 의 MARKETING_VERSION / CURRENT_PROJECT_VERSION 을 올린다 (맥 자체 버전, 예: 1.0.0 -> 1.0.1)
# 2) 빌드 + ad-hoc 서명 + dmg (임시 배포: Developer ID·공증 없음)
bash macos/scripts/release-mac.sh          # 결과: build/AI-ONE-STUDIO_<버전>_macOS.dmg
# 3) 릴리즈 — 반드시 --latest=false (latest가 되면 Windows 자동 업데이트의 latest.json 확인이 깨진다)
gh release create mac-v<버전> build/AI-ONE-STUDIO_<버전>_macOS.dmg --latest=false \
  --title "AI ONE STUDIO macOS <버전>" --notes-file <노트 파일> --repo designloves2/AI-ONE-STUDIO
# 4) macos/STATUS.md 갱신 후 macos/ 안만 커밋·푸시 (git pull --rebase 먼저)
```
- 웹 릴리즈(`vX.Y.Z`)를 만들거나 덮어쓰지 않는다. 서버·웹앱 파일을 고치지 않는다(필요하면 `macos/STATUS.md`의 "웹 세션에 요청").
- Developer ID가 생기면 서명·공증·Sparkle(`macos/appcast.xml`)은 `docs/MACOS_APP_SPEC.md` §8을 따른다.

## 6. 맥 영향 등급 (`docs/MAC_SYNC_FROM_WEB.md` 기준)
**확인** — 맥 코드 변경은 필요 없지만, 새로 쓰는 브라우저 기능(`confirm()`)이 맥 앱에서 동작하는지 한 번 확인한다(§4-3).
