# VoiceNote

회의를 녹음하고 AI로 회의록·핵심 요약·업무 정리를 만드는 Windows·Android 앱의 소스입니다.

## 자기 OpenAI API 키가 필요합니다

이 저장소에는 체험용 공용 키와 체험 해제 코드가 들어 있지 않습니다. 앱을 실행한 뒤 `AI 설정`에서 자신의 OpenAI API 키를 등록해야 녹음을 분석할 수 있습니다. 분석 요청 비용은 등록한 키의 계정에 청구됩니다.

## 폴더

| 폴더 | 내용 | 빌드 안내 |
|---|---|---|
| `desktop/` | Windows 앱(WebView2 창과 로컬 Node 서버) | `desktop/소스안내.txt` |
| `mobile/안드로이드/` | Android 앱 | `mobile/안드로이드/빌드안내.txt` |
| `브랜드/` | 앱 아이콘 원본 | `브랜드/아이콘-안내.md` |

루트의 `배포준비.ps1`은 빌드한 두 설치파일을 배포 폴더와 zip으로 묶는 스크립트입니다.

## 시험

```powershell
cd desktop
node --test 앱/*.test.cjs tests/*.test.cjs

cd ../mobile/안드로이드
node --test tests/*.test.cjs
```

모바일 시험 일부는 JDK가 필요합니다. `VOICENOTE_TOOLS` 환경변수에 `도구/JDK/<JDK 폴더>`가 들어 있는 폴더를 지정합니다.
