<p align="center">
  <img src="./브랜드/png/VoiceNote-256.png" width="88" height="88" alt="VoiceNote 음성 파형 로고">
</p>

<h1 align="center">VoiceNote</h1>

<p align="center">
  <strong>회의를 녹음하고, 필요한 형식으로 정리하세요.</strong><br>
  Windows와 Android에서 쓰는 AI 회의 기록 앱입니다.
</p>

<p align="center">
  <code>Windows</code> · <code>Android</code> · <code>OpenAI API</code>
</p>

<p align="center">
  <a href="#주요-기능">주요 기능</a> ·
  <a href="#사용-순서">사용 순서</a> ·
  <a href="#api-키와-자료">API 키와 자료</a> ·
  <a href="#개발-안내">개발 안내</a>
</p>

---

녹음을 마치면 음성을 글로 옮기고 회의록을 만듭니다. 지난 회의를 날짜·차수·제목으로 한 목록에 보관하고, 회의 성격에 맞춰 회의록·핵심 요약·업무 정리·내 형식 중 필요한 형식을 고를 수 있습니다.

> **사용 전 준비**
>
> 자신의 **OpenAI API 키**와 인터넷 연결이 필요합니다. 이 저장소는 앱 소스이며, 설치파일·빌드 도구·서명 키는 포함하지 않습니다. 빌드한 앱의 `설정`에서 본인 키를 등록해 사용하세요.

## 주요 기능

### 회의에 맞는 정리 방식

| 형식 | 정리하는 내용 |
| :--- | :--- |
| **회의록** | 논의한 내용, 결정 사항, 다음 할 일과 남은 쟁점 |
| **핵심 요약** | 전체 흐름과 주제별 핵심 내용 |
| **업무 정리** | 할 일, 담당자, 기한과 확인할 사항 |
| **내 형식** | 직접 고른 항목·순서·이름과 추가 정리 지시 |

새 회의의 기본 형식은 `설정`에서 정하고, `회의 준비`에서 회의마다 바꿀 수 있습니다. `예시 보기`로 구성을 먼저 확인할 수 있습니다.

### 회의가 쌓여도 다시 찾기 쉽게

- **지난 회의 한 목록** — 새 회의는 프로젝트 없이 한 목록에 쌓이고, 날짜·차수·제목으로 찾아봅니다. 1.2.0까지 프로젝트에 쌓인 기록도 지우지 않고 `이전 프로젝트` 꼬리표를 붙여 함께 보여 줍니다.
- **원음과 전사 보관** — 음성을 먼저 기기에 저장합니다. 전사와 정리 결과를 함께 보관하고, 분석이 실패하면 저장된 자료로 다시 시도할 수 있습니다.
- **평가와 의견 반영** — 정리 결과에 별점과 의견을 남기고, 의견을 반영해 요약만 다시 정리할 수 있습니다. 앞선 결과는 `결과 버전`에서 다시 봅니다.
- **고른 폴더에 사본 저장** — 분석이 끝나면 전사문·요약본(.md·.txt)·원음 사본을 설정에서 고른 폴더에 씁니다. 앱 안 기록은 그대로 두고, 같은 이름의 다른 파일은 덮어쓰지 않습니다.
- **결과와 사용량 확인** — 정리본·전사문 탭을 나눠 보고 복사합니다. 회의별로 모델이 보고한 입력·출력·합계 토큰도 확인할 수 있습니다.
- **설정 파일로 이동** — 요약 모델·기본 출력 형식·내 형식·저장 위치를 JSON으로 내보내고 Windows·Android에서 같은 형식으로 불러옵니다. 저장 위치는 Windows에서만 적용합니다. 회의 기록과 녹음은 설정 파일에 포함하지 않습니다.

## 사용 순서

<p align="center">
  <strong>준비</strong> → <strong>녹음</strong> → <strong>AI 정리</strong> → <strong>보관</strong>
</p>

1. **API 키를 등록합니다.** `설정`의 `AI 연결`에 본인의 OpenAI API 키를 입력합니다.
2. **필요하면 회의를 준비합니다.** 바로 `회의 시작`을 눌러도 됩니다. 회의명·참석자·안건 메모를 적거나 출력 형식을 바꾸고 싶을 때만 `회의 준비`를 펼칩니다. 회의명은 비워 두면 AI가 회의 내용을 보고 정합니다.
3. **회의를 녹음합니다.** 녹음 전에 참석자에게 녹음과 AI 분석(OpenAI 전송)을 알린 뒤 시작합니다.
4. **회의를 종료합니다.** 음성 저장 후 전사와 정리가 이어집니다. 완료한 결과는 지난 회의 목록에서 다시 열고, 평가하거나 의견을 반영해 다시 정리할 수 있습니다.

결과는 검토가 필요한 초안입니다. 이름·수치·담당자·기한을 확인한 뒤 사용하세요. 발언자를 자동으로 구분하는 기능은 제공하지 않습니다.

## API 키와 자료

| 항목 | 알아둘 내용 |
| :--- | :--- |
| **분석 비용** | 등록한 OpenAI API 키의 계정에 청구됩니다. ChatGPT 구독과 API 사용 요금은 별개이며, 다시 분석하거나 실패한 호출에도 비용이 생길 수 있습니다. |
| **외부 전송** | AI 분석을 실행하면 **원음·전사·회의 안건 메모와 다시 정리할 때 적은 의견을 OpenAI API로 전송**합니다. 인터넷 없이 분석할 수 없습니다. |
| **자료 보관** | 녹음·전사·회의 결과를 기기에 보관합니다. 고른 폴더의 사본은 앱 안 기록과 별도로 남습니다. 여러 기기 사이의 회의 기록 자동 동기화는 제공하지 않습니다. |
| **키 저장** | Windows에서 `이 PC에 키 저장`을 선택하면 로컬 파일에 **평문으로 저장**합니다. 공용 PC에서는 저장하지 않고 사용한 뒤 키를 삭제하세요. |
| **Android 키 보관** | 앱 전용 설정 저장소에 보관하며, 앱 백업 대상에서 제외합니다. |
| **설정 내보내기** | 요약 모델·기본 출력 형식·내 형식만 내보내고, Windows는 저장 위치도 함께 내보냅니다. API 키·녹음·회의 기록은 포함하지 않습니다. |

## 개발 안내

### 구성

```text
VoiceNote/
├─ desktop/
├─ mobile/
│  └─ 안드로이드/
├─ 브랜드/
├─ 배포준비.ps1
└─ README.md
```

Windows 앱은 WebView2와 로컬 Node 서버, Android 앱은 WebView와 Java로 구성합니다. `배포준비.ps1`은 빌드한 두 설치파일을 배포 폴더와 ZIP으로 묶습니다.

| 대상 | 지원 환경 | 빌드 안내 |
| :--- | :--- | :--- |
| **Windows** | Windows 10 2004 이상·Windows 11, x64 | [Windows 소스·빌드 안내](./desktop/소스안내.txt) |
| **Android** | Android 8.0 이상 | [Android 빌드 안내](./mobile/안드로이드/빌드안내.txt) |
| **아이콘** | SVG·PNG·ICO·Android 벡터 | [브랜드 파일 안내](./브랜드/아이콘-안내.md) |

<details>
<summary><strong>빌드 준비물</strong></summary>

빌드 스크립트는 Windows PowerShell 환경을 기준으로 합니다. 기본 도구 경로는 개발 PC에 맞춰져 있으므로, 다른 PC에서는 각 스크립트의 경로 인수를 지정해야 합니다.

**Windows**

- .NET Framework 4.8 컴파일러, Inno Setup 6
- 패키지에 포함할 Node x64 실행 파일
- WebView2 패키지와 설치 부트스트래퍼
- `desktop/설치/빌드.ps1`의 `NodePath`·`DependencyRoot` 지정

Inno Setup 6은 기본 설치 위치에 설치하세요.

필요한 의존성 버전과 폴더 배치는 [Windows 빌드 안내](./desktop/소스안내.txt)에 적혀 있습니다.

**Android**

- Node.js 22 이상, JDK 21
- Android SDK platform `android-36`, build-tools `36.0.0`, platform-tools
- 본인의 앱 서명 키와 암호 파일
- `mobile/안드로이드/빌드.ps1`의 `ToolRoot`·`SigningDir` 지정

SDK·도구·서명 파일은 따로 준비해야 합니다. 서명 키와 암호 파일은 저장소 밖에 보관하세요. 자세한 구성은 [Android 빌드 안내](./mobile/안드로이드/빌드안내.txt)를 참고하세요.

`SigningDir` 폴더 안의 서명 파일 이름은 `회의록서명.p12`와 `서명암호.txt`여야 합니다.

</details>

<details>
<summary><strong>자동 시험 실행</strong></summary>

Node.js 22 이상을 준비하고, 저장소 루트에서 PowerShell로 실행합니다.

```powershell
# Windows 앱
Push-Location desktop
node --test 앱/*.test.cjs tests/*.test.cjs
Pop-Location

# Android 앱의 Node·Java 호환 시험
# 아래 경로는 도구/JDK/<JDK 폴더> 구조를 가진 본인 도구 폴더로 바꾸세요.
$env:VOICENOTE_TOOLS = 'D:\VoiceNote-tools'
Push-Location mobile/안드로이드
node --test tests/*.test.cjs
Pop-Location
```

모바일 일부 시험은 JDK를 호출합니다. `VOICENOTE_TOOLS` 아래의 폴더 구조는 다음과 같습니다.

```text
VoiceNote-tools/
└─ 도구/
   └─ JDK/
      └─ <JDK 폴더>/
         └─ bin/
            ├─ java.exe
            └─ javac.exe
```

모바일 화면은 헤드리스 Chrome으로 검사합니다. 저장소 루트에서 실행합니다.

```powershell
Push-Location mobile/안드로이드
node tests/화면검증-브라우저.cjs ../../산출물/화면검증
Pop-Location
```

Chrome 위치가 기본 설치 경로와 다르면 `CHROME` 환경변수에 실행파일 경로를 지정하세요.

</details>

---

<p align="center">
  <img src="./브랜드/png/VoiceNote-32.png" width="24" height="24" alt=""><br>
  <sub>VoiceNote · 회의 녹음과 AI 기록</sub>
</p>
