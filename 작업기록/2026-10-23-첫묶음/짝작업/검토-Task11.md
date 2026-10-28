# Task 11 교차 검토

- **검토 대상.** 후보 44b2ab8d33fb9eab48efc8c01084932f1f5703a4(브랜치 work/2026-10-23-안드로이드-프로젝트제거, 제목 `feat: 안드로이드 요약 요청에서 배경을 빼고 의견 반영 경로 추가`, 작성자 yeunlee1 GitHub 비공개 메일), 비교 기준 9fdf7e6f767846e0a164568e81810267041a187e, 작성자 보고 `C:\Users\user\AppData\Local\짝작업\VoiceNote\2026-10-23-첫묶음구현\구현-Task11.md`. 변경은 제품 4파일(Ai·MainActivity·MeetingService·Store)과 시험 2파일(AndroidChecks 수정, AiFeedbackTest 새로)이다. 검토 복제본은 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task11`이다(`git clone --no-hardlinks` 뒤 checkout, 추적 파일 변경 0). 짝 작업 폴더는 읽기만 했다. 공유 Task Master는 주작성자가 등록한 5.5·5.9에 해당하며 이 검토에서 목록을 고치지 않았다.
- **판정. 통과(반드시 고칠 것 없음).** 확인한 내용은 다섯 가지다.
  - Android 요약 요청은 같은 입력이면 Windows 서버가 만드는 요청과 본문 전체가 글자까지 같았다(기기에서 뽑은 7개 사례 중 6개). 남은 1개는 입력에 `/`가 있을 때 Android가 user 메시지 안에 `\/`로 적는 차이뿐이고 값은 같다. 이 직렬화는 고치기 전부터 있던 방식이다(S1, 선택).
  - 의견 반영은 저장된 `전사.txt`로 요약만 요청한다. 실패하면 최신 포인터·완료 상태·앞선 결과·평가가 그대로이고, 성공하면 새 결과에 의견이 남는다. 1.2.0 옛 회의와 앞선 버전을 고른 경우도 기기에서 확인했다.
  - 캐시 키에 실제 일반·의견 지시문 자산의 지문과 의견이 들어가, 지시문이나 의견이 바뀌면 다시 요청한다.
  - N1은 닫혔다. 짝의 n1new·n1old·n1meta와 검토에서 더한 `요약.json` 쓰기 실패 경로까지 후보에서 통과하고, 9fdf7e6에서는 같은 시험이 실패한다.
  - 짝이 더한 시험은 위양성이 아니다. 고치기 전 코드에서 기대한 지점에서 실패하고(finish·N1·요청 계약·의견 입력), 결함을 하나씩 넣은 변이 다섯 가지를 모두 잡았다. 시험 숫자는 짝 보고와 같다(Node 19/19, JVM 6종, 검증용 빌드, AndroidChecks 156 PASS).
- **범위.** 변경 6파일 전체 diff와 Ai·Store·MainActivity·MeetingService 현재 전문을 설계('요약 요청', '의견 반영 지시', 'Android가 같은 요청을 보내게 하기', '평가 저장과 다시 정리', '결과 모델', '오류와 경계 상황')와 계획(Task 11, '실행 방식과 교차 검증', Phase 2 머리 문단)에 대조했다. Windows 쪽은 `C:\DEV\VoiceNote`의 `desktop/앱/화면/app.js`(summarize·refineSummary·splitTranscript)와 `desktop/앱/서버.cjs`(summaryInput, 요약 요청 구성)를 읽었고, 서버.cjs 두 판은 요청 대조 때 모의 apiFetch와 임시 dataDir로 실행만 했다(저장소에 쓰지 않음). 아래 서버.cjs 줄 번호는 후보 복제본 판 기준이다. 직접 실행한 것은 Node, JVM 7종, 검증용 빌드 8회(후보, 후보+검토 probe, 9fdf7e6 대조 각 1회와 변이 5회), emulator-5554의 AndroidChecks 전체·회귀 probe·검토 probe, Windows 서버 두 판(후보 복제본 안의 Task 1 병합본과 `C:\DEV\VoiceNote` 현재 HEAD 811f04f)과의 요청 본문 대조다. 짝의 시험 결과를 그대로 재사용한 것은 없다.

## 요청받은 여섯 가지 확인

- **(1) Windows와 같은 입력. 맞다(값 기준 7/7, 글자 기준 6/7).**
  - 코드. Ai.java:121-126이 user JSON을 `notes?, title, date, participants, transcript, previousMinutes?, feedback?` 순서로 만들고 `context`는 넣지 않는다. :140-141이 의견 지시 자산(`summary-feedback.json`)을 user 바로 앞에 넣는다. 의견은 의견 반영(:95)과 길이 한도 재분할(:151) 모든 구간에 같은 값으로 들어가고, 일반 분석은 의견 없이 부른다(:115·:118-119). Windows는 서버.cjs:20047(의견 지시)·20049-20060(user JSON)이 같은 순서다. notes는 두 앱 모두 비어 있지 않을 때만 보내고, notes 지시(참고 자료로만 쓰라는 시스템 메시지)는 늘 들어간다.
  - 시험. 검토 probe `rv-equiv`가 기기에서 실제 Android 요청 본문 7개를 뽑았고, 같은 입력을 후보 복제본 서버.cjs의 `/api/summary`(모의 apiFetch)로 보내 받은 본문과 비교했다(`Task11-요청대조.log`). 사례는 일반 회의록(메모 있음), 의견 첫 구간, 의견 다음 구간(previousMinutes 있음), 업무 정리+메모 없음, 내 형식+의견, 1,000자 의견+핵심 요약, 특수문자다. 앞의 6개는 model·store·max_output_tokens·reasoning·text 스키마·시스템 메시지 4~6개·user 메시지까지 본문 전체가 글자 단위로 같았다. 7번째는 키 순서와 해석한 값이 같고, Android가 `A/B`를 `A\/B`로 적은 것만 다르다(S1). 같은 Android 본문을 `C:\DEV\VoiceNote`의 현재 Windows 서버(브랜치 work/2026-10-23-프로젝트제거-설정화면, HEAD 811f04f, 서버.cjs 마지막 변경 e93550b)와도 대조했고 결과가 같았다(`Task11-요청대조-현재Windows.log`). 그 뒤 Windows 쪽 요약 요청이 바뀌어도 Android 빌드가 자산을 다시 뽑으므로 시스템 메시지는 따라간다.
- **(2) 의견 반영 경로. 맞다(Ai 수준은 기기 실행, 서비스·브리지는 코드 확인).**
  - 전사 요청 없음. Ai.java:84-105는 `전사.txt`만 읽고 전사 API를 부르지 않는다. 짝 시험이 모든 요청 경로가 `/v1/responses`인지 보고, 검토 probe `rv-refineold`·`rv-refinever`·`rv-refinefail`도 같은 확인을 통과했다.
  - 전사 없음. 파일 없음·빈 글·공백만 있는 세 경우 모두 정해진 문구 `저장된 전사가 없어 의견을 반영할 수 없습니다.`로 멈추고 API를 부르지 않는다(짝 시험, Ai.java:87-88, MainActivity.java:99-100).
  - 실패. 모의 HTTP 500에서 회의정보.json의 최신 결과 id·완료 상태, 최신 결과 파일과 앞선 평가 파일 바이트가 그대로였다(짝 시험). 사용량은 회의 메타데이터에만 합쳐지고(Ai.java:162-165), 서비스는 의견 반영 중 상태를 디스크에 쓰지 않는다(MeetingService.java:40). 변이 M6(사용량을 고른 결과 기록으로 저장)을 넣으면 이 시험이 실패한다.
  - 성공. 새 결과와 회의정보.json에 의견 원문이 남고 `refined`로 보인다. 1.2.0 p1 회의(`context`와 평가가 있는 옛 기록)는 배경 없이 저장된 전사·의견·옛 결과 형식(업무 정리)으로 한 번만 요청했다. 결과 버전은 `777`(옛 결과)과 의견 반영본 두 개였고, 새 결과는 location p1·projectName 유지·slot 없음이며, 옛 결과 본문과 평가 바이트는 그대로였다(`rv-refineold` 8건). 앞선 버전을 고르면 그 결과의 제목·형식으로 요청하고 새 결과가 최신이 되며, 건너뛴 최신 결과 파일은 바뀌지 않았다(`rv-refinever` 4건).
  - 서비스·브리지. MainActivity.java:94-103(사전 검사 뒤 dataSync 서비스 시작, `{id}` 응답)과 MeetingService.java:27-30·58-61은 코드로만 확인했다. 시험이 이 경로를 거치지 않는다(S3).
- **(3) 캐시. 맞다.** Ai.java:129-130의 키는 `summary-v2`, 의견이 든 입력 JSON, 모델, 형식, 내 형식 정의, 실제 일반 지시 자산 SHA-256, 의견 지시 자산 SHA-256(일반 분석은 null)을 묶는다. 분할 파일(`-분할.json`)도 같은 키를 쓴다. 짝 시험이 같은 조건 재사용, 일반 지시문 변경, 의견 변경, 의견 지시문 변경(바뀐 지시문이 실제로 전송됨)을 확인한다. 변이 M1(일반 지시 지문 제거)과 M2(의견 지시 지문 제거)를 넣으면 각각 해당 확인에서 실패한다. 다른 의견이나 다른 자산으로 만든 결과를 재사용하는 경로는 찾지 못했다. 1.2.0이 남긴 중간 요약은 새 키와 달라 다시 쓰지 않는다(지시문이 바뀌었으므로 설계 의도대로다).
- **(4) N1. 닫혔다.** Store.java:287-292가 결과 파일 → 회의정보.json(최신 포인터) → 호출자 기록 → 요약.json·회의록.txt 순서로 쓴다. 요청한 재현 순서(회의 폴더에 `회의록.txt.new` 폴더로 쓰기를 막고 finish → 막음 해제 → 실패 상태 저장 → 결과 목록)로 n1new 3건·n1old 3건이 후보에서 통과하고, 9fdf7e6에서는 둘 다 `versions=2 latest=legacy`로 실패한다. 발행 전 실패(n1meta, `회의정보.json.new` 차단)도 후보 6건 통과, 9fdf7e6 실패다. 검토에서 더한 `rv-n1sum`(`요약.json.new` 차단, 새 회의·요약 없던 옛 회의·요약 있던 1.2.0 회의)도 후보 8건 통과, 9fdf7e6 실패(최신 결과 없음)다. 의견 반영 중 발행 뒤 실패에서도 서비스 기록과 디스크 포인터가 이미 저장한 새 결과를 함께 가리킨다(`rv-refinefail`).
- **(5) 위양성. 아니다.** 후보 시험 파일에서 9fdf7e6에 없는 API를 쓰는 두 묶음(refinementChecks·templateCacheChecks)만 빼고 9fdf7e6에 얹어 기기에서 돌렸다. finish(`부속 파일 실패 뒤에도 이미 발행한 실제 결과를 최신으로 연다`), n1new·n1old·n1meta(`versions=2 latest=legacy`), 요청 계약(`일반 요청에는 프로젝트 배경과 의견 칸이 없다`)이 모두 실패했다. JVM AiFeedbackTest는 9fdf7e6에서 `checkedFeedback` 없음으로 컴파일 실패다. 빠진 두 묶음은 변이로 확인했다. M1·M2는 캐시 확인, M3(의견을 첫 구간에만)는 구간별 의견 확인(`No value for feedback`), M5(의견 지시를 user 뒤에)는 위치 확인, M6은 실패 뒤 포인터 확인에서 각각 실패했다(`Task11-변이.log`).
- **(6) 숫자 비교. 같다.** 아래 '시험 결과' 표.

## 지적 표

| ID | 구분 | 사용자 영향·수용 조건 | 직접 근거·재현 조건 | 반증·한계 | 담당·다음 행동 |
|---|---|---|---|---|---|
| S1 | 확정(선택, 9fdf7e6부터 있던 방식) | 제목·참석자·메모·전사·의견·앞 구간 결과에 `/`가 있으면 Android user 메시지는 `\/`로, Windows는 `/`로 보낸다. 값은 같아 모델 이해에는 영향이 거의 없지만, 설계 검증 3의 '같은 입력에 같은 요청'을 글자 기준으로 보면 다르다. `10/24`, `A/B`처럼 회의 전사에 흔한 글자다. | Ai.java:141 `input.toString()`(Android org.json이 `/`를 이스케이프). `Task11-요청대조.log`의 '특수문자-빗금-줄구분' 사례, 첫 차이 `"title":"A\/B 시험 회의"` / `"title":"A/B 시험 회의"`. 같은 사례에서 U+2028 줄 구분 문자는 두 앱 모두 그대로 보냈다. | 9fdf7e6의 section()도 같은 직렬화를 썼다. 기존 시험은 키 순서와 칸만 본다. | Codex 판단. 맞추려면 user 메시지를 JSON.stringify와 같은 규칙(`/`·U+2028·U+2029는 그대로, 짝 없는 서로게이트만 `\uXXXX`)으로 직접 쓴다. `JsonText.quote`는 U+2028·U+2029까지 이스케이프하므로 그대로 쓰면 새 차이가 생긴다. 캐시 키도 바뀌지만 `summary-v2` 도입과 같은 묶음이면 문제없다. 대조 도구 `Task11-검토도구\요청대조.cjs`를 시험으로 옮길 수 있다. |
| S2 | 확정(선택, 드문 실패 경로) | 최신 포인터를 발행한 뒤 요약.json·회의록.txt 쓰기만 실패하면 새 결과는 저장되어 최신이 되는데 사용자에게는 실패로 알린다. 의견 반영은 서비스 snapshot만 `failed`가 되어, 화면(Task 13)이 Windows처럼 '앞선 결과는 그대로입니다'라고 안내하면 사실과 다르다. 다시 분석은 회의정보.json이 `state: failed`이면서 유효한 resultId를 가진 채 저장되어 목록 상태와 열린 결과가 어긋난다. 체험 예약도 결과가 저장됐는데 반환된다. | Store.java:288 발행 → :292 부속 파일 쓰기 실패, Ai.java:97-103(finally에서 새 id를 돌려준 뒤 예외 전달), MeetingService.java:56·60(`status("failed")`). `rv-refinefail` (가)에서 서비스 기록이 새 결과·완료 상태를 가리킨 채 예외가 나는 것을 확인했다. | 디스크 쓰기 실패나 그 몇 ms 사이의 종료가 있어야 한다. 1.3.0에서 요약.json·회의록.txt는 호환용 파일이라 앱 안 읽기에는 쓰이지 않는다(결과 파일 기준). | Codex 판단. 발행 뒤 부속 파일 실패는 결과 저장 성공에 경고 문구를 붙여 처리하거나, Task 13 화면이 실패 응답의 resultId가 바뀌었는지 보고 안내를 고르게 한다. |
| S3 | 확정(선택) | 의견 반영의 브리지 사전 검사(MainActivity.java:94-103)와 서비스 연결(MeetingService.java:27-30·40·58-61)을 거치는 시험이 없다. 특히 '의견 반영 중에는 디스크에 상태를 쓰지 않는다'(:40 `if(!refining)`)를 되돌려도 지금 시험은 통과한다. | AndroidChecks는 `Ai.refine`을 직접 부른다. Task 10 재확인 R7(선택)과 같은 성격이다. | 코드는 짧고 analyze와 같은 틀이라 읽기로는 문제를 찾지 못했다. | Codex. 사전 검사를 static 도우미로 빼 기기 시험에서 부르거나, 계측 프로세스에서 서비스를 시작해 snapshot과 디스크 상태를 보는 시험을 둔다. Task 13 전에 해 두면 화면 연결 시험이 쉬워진다. |
| S4 | 확정(선택, Task 13 연결) | Windows 화면은 의견을 `trim()`한 뒤 보내고 저장한다(app.js:1800). Android 브리지·Ai는 원문 공백을 보존한다(AiFeedbackTest '공백과 줄바꿈 보존'). Android 화면이 다듬지 않으면 같은 입력에서 요청·캐시 키·저장된 의견이 달라지고, 끝에 공백이 붙은 1,001자는 Windows에서 받고 Android에서 거절한다. | app.js:1798-1819, Ai.java:15-18, MainActivity.java:96. 두 서버(브리지) 계층은 둘 다 원문을 보존하므로 계층끼리는 같다. | 화면은 Task 13 범위라 아직 확인할 수 없다. | Codex(Task 13). Android 화면도 의견을 `trim()`해서 넘긴다. 평가를 먼저 저장한 뒤 다시 정리를 부르는 순서, 키 없음 안내, '의견 반영본' 표시도 Windows refineSummary와 맞춘다. |
| S5 | 확정(선택, 문구) | 키가 없을 때 의견 반영(과 시작·분석)은 `AI 설정에서 API 키를 먼저 등록하세요.`를 보여 준다. 1.3.0에는 'AI 설정' 버튼이 없고, 이번 커밋은 Ai.java의 두 문구만 '설정의 AI 연결에서'로 바꿨다. | Store.java:237, Ai.java:27·53. | 화면이 미리 막으면 사용자에게 닿지 않을 수 있다. | Codex(Task 13과 함께). |
| S6 | 확정(선택, 매우 드묾) | `전사.txt`가 있는데 읽기 중 입출력 오류가 나면 정해진 문구 대신 경로가 든 원래 예외 문구가 보인다. 설계는 '없거나 읽히지 않으면' 정해진 문구로 멈추라고 한다. 다시 전사하지 않는다는 핵심 동작은 지켜진다. | MainActivity.java:100, Ai.java:88의 `Store.read`. 잘못된 UTF-8은 대체 문자로 읽혀 예외가 나지 않으므로 실제로는 권한·입출력 오류만 해당한다. | 앱 내부 저장소라 거의 일어나지 않는다. | Codex 판단. 읽기를 감싸 같은 문구로 바꾼다. |
| N-a | 참고(기존) | 24,000자가 넘는 전사의 구간 경계 규칙이 두 앱에서 조금 다르다. Windows는 `。`도 문장 끝으로 보고, 문장 끝이 없으면 공백에서 자른다. Android는 `\n . ? !`만 보고 없으면 24,000자에서 자른다. 그런 전사에서는 구간 요청이 서로 다를 수 있다. | app.js:1067-1098, TextChunks.java:5-12. | 이번 커밋이 바꾼 곳이 아니고 일반 분석도 같다. 문장부호가 있는 한국어 전사에서는 같은 자리를 고른다. | 기록만 한다. |
| N-b | 참고(기존) | Windows는 요약 전에 전사를 `trim()`하고(app.js:1104-1110), Android는 `전사.txt`를 그대로 보낸다(Ai.java:88, 분석은 :107-115). 앞뒤 공백이 있으면 글자가 다르다. | 같은 줄. | 이번 커밋 전부터 일반 분석이 같았다. | 기록만 한다. |
| N-c | 참고(Task 10 N3와 같은 성격) | 의견 반영이 발행 전(회의정보.json 쓰기)에서 실패하면 완성된 새 결과 파일이 결과 버전에 하나 더 보이고 최신은 앞선 결과로 남는다. | `rv-refinefail` (나) versions 3. | 새 결과 파일은 온전하다. | 기록만 한다. |
| N-d | 참고(Task 14 연결, 후보와 무관) | `빌드.ps1`을 Windows PowerShell 5.1에서 실행하면 35행 키 파일 검사(`Get-ChildItem -LiteralPath … -Recurse -Include`)가 모든 자산을 잡아 '원본 자산에 API 키 파일이 섞였습니다.'로 멈춘다. PowerShell 7에서는 정상이다. | `Task11-빌드-PS51.log`(파일 하나만 있는 폴더에서 5.1은 app.css를 잡고 7은 0건). | 첫 빌드 시도를 5.1로 중첩 실행해서 드러났다. | Task 14에서 `-Filter` 두 번이나 이름 비교로 바꾸거나, 빌드 안내에 PowerShell 7을 적는다. |
| N-e | 참고(기존 시험 정리) | `내형식일치.test.cjs:48`과 `설정호환.test.cjs:9`가 `%TEMP%\vn-custom-*`, `vn-settings-v2-*`를 만들고 지우지 않는다. 오늘 실행분만 50개쯤 쌓였다. | 같은 줄. | 이 검토가 만든 두 개는 지웠다. | 기록만 한다. |

## 반드시 고칠 것

없음. 요청 형식, 의견 반영 경로, 캐시, N1, 시험의 위양성 여부, 필수 시험 숫자에서 확정 결함·수용 조건 미충족·회귀·시험 실패를 찾지 못했다.

## 선택 개선

1. **S1** user 메시지의 `/` 직렬화를 Windows와 글자까지 맞춘다(기존 방식, 값은 같음).
2. **S2** 발행 뒤 부속 파일 실패를 '실패'로 알리지 않게 하거나, 화면이 바뀐 resultId로 구분하게 한다.
3. **S3** 브리지·서비스를 거치는 의견 반영 시험을 하나 둔다.
4. **S4·S5** Task 13에서 의견 `trim()`, 평가 먼저 저장, 키 없음 안내 문구를 Windows와 맞춘다.
5. **S6** 읽히지 않는 `전사.txt`도 정해진 문구로 멈추게 한다.

## 시험 결과

로그는 모두 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\` 아래다. 실제 OpenAI 호출은 0회다(기기 시험은 모의 HTTPS, 빌드의 요약 양식 추출과 요청 대조는 모의 apiFetch).

| 시험 | 명령(기준 위치) | 짝 보고 | 이번 결과 | 로그 |
|---|---|---|---|---|
| Node | `mobile\안드로이드`에서 `VOICENOTE_TOOLS=C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드 node --test tests/*.test.cjs` | 19/19 | 19 통과·0 실패·0 건너뜀, 종료 0 | `Task11-Node.log` |
| JVM 단독 | 시험마다 필요한 소스만 javac 후 실행(AiResponseModel·AiFeedback만 android.jar로 컴파일) | TextChunks 18, Trial 59, AiUsage 20, AiResponse 6, SettingsFile 19, AiFeedback 9 | 같은 숫자로 모두 통과. CustomFormat 유효·무효 2줄 기대대로. java.*만 쓰는 7클래스의 import 경계 확인 | `Task11-JVM.log` |
| 검증용 빌드 | PowerShell 7에서 `빌드.ps1 -DebugBuild -OutputRoot …\Task11-빌드\검토-Claude-162050-후보44b2ab8` | 종료 0 | 성공, 공용 기본 키 포함 아니요, APK sha256 `394caa9f99e794cc8e5f5fdf7b4fb25e53de60d8dbad1f2b6b0b26201308d793`. 첫 시도는 Windows PowerShell 5.1 중첩 실행이라 멈춤(N-d, 후보와 무관) | `Task11-빌드.log`, `Task11-빌드-PS51.log` |
| AndroidChecks(기기) | emulator-5554(VoiceNotePhone, API 35)에 `adb -s emulator-5554 install -r` 후 `am instrument -w kr.local.meetingjournal/kr.local.meetingjournal.AndroidChecks` | 156 PASS | `PASS 156 native storage and recovery checks; real API calls=0`. 처음 설치 뒤, 검토 probe 판에서, 마지막 재설치 뒤 세 번 모두 같다 | `Task11-AndroidChecks.log`, `Task11-검토probe-AndroidChecks.log` |
| 회귀 probe(후보) | `am instrument -w -e probe <이름>` | n1new·n1old·n1meta·finish GREEN 3·3·6·3 | first 3, open 3, review 2, draft 4, finish 3, n1new 3, n1old 3, n1meta 6 모두 통과 | `Task11-AndroidChecks.log` |
| 검토 probe(후보) | 후보에 시험 파일만 바꾼 `Task11-검토probe` 복제본 | — | rv-equiv 8, rv-n1sum 8, rv-refineold 8, rv-refinever 4, rv-refinefail 6 모두 통과 | `Task11-검토probe-빌드.log`, `Task11-검토probe-AndroidChecks.log` |
| 요청 대조 | `node Task11-검토도구\요청대조.cjs <기기 본문 JSON> <서버.cjs>`(후보 복제본 판과 `C:\DEV\VoiceNote` 현재 판 각각) | — | 두 판 모두 7사례 중 6사례 본문 전체가 글자까지 같음, 1사례는 `/` 이스케이프만 다름(값·키 순서 같음). Windows 저장소에는 새 파일이 생기지 않음 | `Task11-요청대조.log`, `Task11-요청대조-현재Windows.log`, `Task11-요청대조-안드로이드.json` |
| 고치기 전 대조(기기) | 9fdf7e6 + 후보 회귀 시험(Task 11 API 의존 두 묶음 제외) + rv-contract·rv-n1sum | 짝 RED n1new·n1old | finish·n1new·n1old·n1meta·rv-contract·rv-n1sum 실패(기대한 확인 문구), first·open·review·draft는 통과(Task 10 재확인 수정분) | `Task11-RED-빌드.log`, `Task11-RED-AndroidChecks.log` |
| 고치기 전 대조(JVM) | 9fdf7e6 소스 + 후보 AiFeedbackTest | 짝 RED-의견입력 | `cannot find symbol checkedFeedback`로 컴파일 실패 | `Task11-RED-JVM.log` |
| 변이 | `Task11-검토도구\변이.ps1`(Ai.java에 결함 하나씩, 빌드·설치·전체 실행) | — | M1·M2·M3·M5·M6 다섯 가지 모두 기대한 확인에서 실패, 끝에 복제본 원상 복구 | `Task11-변이.log` |
| 패치 검사 | `git diff --check 9fdf7e6 44b2ab8` | — | 문제 없음 | (명령 결과만 확인) |

## 기기 사용과 하지 않은 것

- 에뮬레이터는 짝이 띄워 둔 emulator-5554(VoiceNotePhone, API 35)만 썼다. `adb devices -l`에는 이 기기 하나뿐이었고 모든 adb 명령에 `-s emulator-5554`를 붙였다. 새 에뮬레이터를 켜지 않았고 실기기에는 설치하지 않았다.
- **끝 상태.** 후보 검증용 APK를 다시 설치하고 전체 156 PASS를 확인한 상태로 두었다. 설치본 sha256 `394caa9f99e794cc8e5f5fdf7b4fb25e53de60d8dbad1f2b6b0b26201308d793`(경로 `/data/app/~~KMQbkRp3twE__Lqy8-1E3A==/kr.local.meetingjournal-vlUhsCHvUg6wuFjb76USOg==/base.apk`, versionName 1.2.0, lastUpdateTime 2026-10-23 07:30:42 UTC). 시작 때 깔려 있던 것은 짝이 같은 커밋으로 만든 판(sha256 `af6e7aad…918b1`)이었다. 사이에 검토 probe 판, 9fdf7e6 대조 판, 변이 다섯 판을 잠시 설치했다.
- 앱 자료. AndroidChecks의 저장은 testContext(앱 cache 아래 `task10-<UUID>` 폴더와 `task10-<UUID>-*` 설정 파일)로만 간다. 실행 전후로 `files/회의자료`는 2026-10-02에 만든 빈 프로젝트-01~03 그대로였다. cache의 `task10-*`는 99→239개, shared_prefs의 `task10-*`는 37→78개로 늘었고 앞선 검토처럼 지우지 않았다. 검토 probe가 cache에 쓴 `task11-review-equiv.json`은 꺼낸 뒤 지웠다.
- 검토 복제본 상태. `Task11`과 `Task11-변이`는 변경 0, `Task11-검토probe`와 `Task11-기준-9fdf7e6`은 시험 파일 하나만 바꾼 채 남겼다(커밋하지 않음). 짝 작업 폴더에는 짝이 진행 중인 Task 12 변경(16:17~16:33 수정)이 있었고 손대지 않았다.
- **실행하지 못한 것.** (1) MainActivity.dispatch("refine")와 MeetingService의 의견 반영 경로는 기기에서 돌리지 않고 코드로만 확인했다(S3). (2) Android 화면은 아직 의견 반영을 부르지 않아(Task 13) 화면 동선·trim·평가 먼저 저장은 확인할 수 없었다. (3) 실제 OpenAI 호출, 실기기, 실제 마이크는 하지 않았다. (4) desktop 시험은 후보 변경 밖이라 다시 돌리지 않았다. Windows 화면의 trim 동작은 코드로만 대조했다.
- push·커밋·원격 작업, 짝 작업 폴더 수정, 사용자 실제 자료(`%LOCALAPPDATA%\MeetingJournal`, 휴대폰) 접근은 하지 않았다. 이 검토가 띄운 Node 서버·빌드는 모두 끝났고 남은 시험 프로세스와 빌드 임시 정션은 없다. Node 시험이 이번에 남긴 `%TEMP%` 임시 폴더 두 개(16:17:39 생성)만 지웠다.

## 재확인 기록

반드시 고칠 것이 없어 재확인할 항목이 없다. 선택 S1~S6을 반영하면 지적한 쪽이 해당 실패 조건만 다시 본다.
