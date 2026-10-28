# Task 10 교차 검토

- **검토 대상.** 후보 e464b82aa1dd3c5f46ba46bfa2a643b31f7ba077(브랜치 work/2026-10-23-안드로이드-프로젝트제거, 제목 `refactor: 안드로이드 저장소를 보관함과 결과 버전 구조로 바꿈`), 비교 기준 03c4a6b573a86a99c34424e95f54da199d1f3da7, 작성자 보고 `C:\Users\user\AppData\Local\짝작업\VoiceNote\2026-10-23-첫묶음구현\구현-Task10.md`. 검토 복제본은 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task10`이다(`git clone --no-hardlinks` 뒤 checkout, `git status` 깨끗). 공유 Task Master는 주작성자가 등록한 5.5를 이어 쓴다.
- **판정. 보완 필요.** 짝이 보고한 시험은 기기 시험을 빼고 모두 같은 숫자로 다시 통과했다. 그러나 시험이 닿지 않은 경로에서 반드시 고칠 것 5건(R1~R5)을 확인했다. 가장 큰 두 가지는 이렇다. 새 회의를 처음 분석할 때마다 가짜 옛 결과 `결과-legacy.json`이 하나씩 생겨 결과 버전이 늘어난다(R1). 결과가 없는 회의(분석 실패·녹음 중단·음성만 저장)를 화면에서 열 수 없어, 앱이 실패 문구로 안내하는 '지난 회의에서 다시 분석'이 막힌다(R2, BASE 대비 회귀).
- **범위.** 변경 12파일 전체 diff와 Store·MainActivity·MeetingService·Ai·app.js·flow.js·index.html 현재 전문을 설계('저장 구조', '평가 저장과 다시 정리', '오류와 경계 상황', 'Android 화면과 앱 사이의 요청')와 계획(실행 방식과 교차 검증, Phase 2 머리 문단, Task 10 절 전체)에 대조했다. 직접 실행한 것은 Node, JVM 6종, 검증용 빌드, 헤드리스 화면 30건과 반례 실행(실제 Store.java를 AOSP org.json으로 돌린 JVM 46건, BASE 대조, 실제 app.js가 보내는 요청 본문 수집, 폭별 문구 측정, 초안 실패 때 화면 초기화, 하단 가림 측정)이다. 짝의 캡처 10장 중 9장을 직접 열었다. 재사용한 증거는 짝의 `최종-AndroidChecks.log`(PASS 91)뿐이며, 이것은 다시 돌리지 못했다.
- **기기 시험을 돌리지 못한 이유.** 14시 36분 무렵 `adb devices -l`에 `emulator-5554`(sdk_phone64_x86_64)가 이미 붙어 있었다. 지시대로 새 에뮬레이터를 켜지 않았고 그 기기도 쓰지 않았다. 그래서 AndroidChecks와 기기에서의 `org.json` 동작은 미실행이다. 대신 이 PC의 Gradle·Maven 캐시에 있던 `android-json-0.0.20131108.vaadin1.jar`(AOSP libcore `org.json` 재포장본, 소스 동봉)와 검토용 Android 대역 클래스(Context·SharedPreferences·AtomicFile)로 e464b82의 Store.java를 JVM에서 그대로 돌렸다.

## 네 가지 집중 확인

- **(a) 옛 회의 최신 결과 보존. 1.2.0 회의에서는 맞고, 보존이 엉뚱한 회의에도 돌아간다(R1).** 1.2.0 회의의 최신 결과 id는 가장 최근 `요약-<시각>.json`의 시각이고, 그 파일이 없으면 `legacy`였다. 분석을 시작하는 첫 상태 저장 때 그 결과가 `결과-<그 id>.json`으로 먼저 남아, 다시 분석한 뒤에도 앞선 결과의 제목·형식·본문과 평가 파일 바이트가 그대로였다. 다시 분석이 중간에 실패해도 앞선 결과가 최신으로 남았다(반례 A5~A10 통과). 그러나 같은 보존 코드가 finish의 마지막 저장에서도 돌아, 새 회의와 '1.2.0에서 요약이 없던 옛 회의'의 첫 분석 결과를 가짜 옛 결과로 한 번 더 남긴다.
- **(b) 평가 분리 저장. Store는 맞고, 브리지가 JSON null을 잘못 읽는다(R3).** 평가는 `평가-<결과id>.json`에 따로 쓰고 결과 파일 바이트는 바뀌지 않았다(B5). 별 0·6·-1, 1,001자 의견, 둘 다 빈 경우(빈 문자열·공백·null)는 거절하고 1,000자는 받았다(B1~B4). 평가는 결과마다 따로이고 결과 없는 회의는 거절했다(B6·B12). 브리지의 3.5·문자열 별점 거절도 맞다(B10·B11). 그런데 브리지가 `comment:null`과 `resultId:null`을 문자열 "null"로 넘긴다(B7~B9).
- **(c) 작성 중 메모 이관. 이관 규칙은 맞고, 손상된 새 메모 하나가 시작까지 막는다(R4).** 옛 세 메모 중 가장 최근에 바뀐 정상 메모 하나만 가져오고(최근 둘이 손상·형식 오류면 건너뜀), `connection.draftMigrated`에 기억하고, 옛 파일 세 개를 지우지 않으며, 지운 뒤 다시 열어도 되살아나지 않았다(C1~C4). 이관 표시 저장 실패(C5)와 짝의 쓰기 실패 시험(AndroidChecks.java:180-186)도 맞다. 다만 실패를 그대로 예외로 올려 화면 초기화가 멈추고, 이관 뒤 기본 보관함 메모가 손상되면 회의 시작이 매번 실패한다.
- **(d) location·resultId 연결. 이름과 뜻은 끝까지 이어지고, 결과가 없을 때의 null 처리만 깨진다(R2).** 화면(history 항목, open, poll 자동 열기, analyze, share, copy) → 브리지(MainActivity.java:43 `location`, :55·94·100·102 `resultId`) → 서비스 Intent(:179 `putExtra("location")`·`("id")`, MeetingService.java:27) → Store(load·result·results·finish) → Ai.java(:75 `Store.location(record)`, :84 `finish(record,previous,null)`)까지 같은 이름이다. 새 녹음은 main에서만 만들고(Store.java:103, MainActivity.java:177, L1·L2), 읽을 때 보관함 이름과 폴더를 검사한다(Store.java:90·164, L4~L7). Ai·MeetingService·MainActivity의 기록 경로에 `getInt("slot")`은 없다. `slot`은 옛 기록 해석(Store.java:82)과 Task 9에서 지울 설정 교환 코드에만 남았다.

## 지적 표

| ID | 구분 | 사용자 영향·수용 조건 | 직접 근거·재현 조건 | 반증·한계 | 담당·다음 행동 |
|---|---|---|---|---|---|
| R1 | 확정 | 새 회의(또는 1.2.0에서 요약이 없던 옛 회의)를 한 번 분석하면 실제 결과 외에 `결과-legacy.json`이 생겨 결과 버전이 2개가 되고, 두 번 분석하면 3개가 된다. 가짜 결과에는 `state: analyzing`, 빈 제목, 새 요약 본문이 들어 있다. 계획 Task 10 Interfaces의 'results는 1.3.0 결과 파일만'과 '옛 회의의 결과 id'(1.2.0 이전 회의만 해당)에 어긋나고, Task 12 사본·Task 13 결과 버전·평가가 이 가짜 결과를 실제 결과로 다루게 된다. | Store.java:263 finish 끝의 `save(record)` → :96 `preserveLegacy` → :154 디스크 회의정보.json에 아직 resultId가 없음 → :147-150 `legacyResult`가 같은 :263에서 `save`보다 먼저 덮어쓴 새 `요약.json`을 옛 결과로 읽음 → :156 `결과-legacy.json` 쓰기. 반례 A1~A4(MeetingService.analyze → Ai.sent → Store.finish의 저장 순서를 그대로 따름), `Task10-반례-JVM.log`. | 대역 클래스로 돌렸지만 이 경로는 파일 쓰기 순서만 타므로 기기와 다를 이유가 없다. 짝의 AndroidChecks.java:232도 같은 파일을 만들 것으로 보이나 결과 수를 검사하지 않아 통과했다(추정, 기기 미실행). | Codex. 보존은 디스크 회의정보.json에 `location`이 없는 기록(1.2.0 이전)에만 하거나, finish 안의 마지막 저장에서 보존을 다시 하지 않게 고친다. 앞의 방법은 finish가 중간에 실패한 뒤 실패 상태를 저장하는 경로도 함께 막는다. AndroidChecks에 '새 회의 첫 분석 뒤 results 1개·`결과-legacy.json` 없음', '요약 없던 옛 회의 첫 분석 뒤 1개'를 더한다. |
| R2 | 확정(기기 재확인 미실행) | 결과가 없는 회의(분석 실패·녹음 중단·음성만 저장, 1.2.0에서 요약 없이 남은 옛 회의 포함)를 지난 회의에서 누르면 열리지 않고 "처리를 완료하지 못했습니다. 저장된 자료를 확인한 뒤 다시 시도하세요."만 뜬다. 분석이 실패로 끝난 직후의 자동 열기도 같은 이유로 실패하고, 그때 상단 연결 표시가 잠깐 '연결 확인 필요'로 바뀐다(app.js:233). 결과 창의 '다시 분석'과 '음성 포함 전체 공유'에 닿을 수 없다. BASE는 같은 회의를 열었다(기존 기능 회귀). | app.js:129-130 `open(location, id, opener, resultId = null)`이 `{"location":…,"id":…,"resultId":null}`을 보낸다. 헤드리스 Chrome에서 실제 app.js가 보낸 본문을 그대로 잡았다(목록 클릭·자동 열기 모두 `"resultId":null`, `Task10-반례-열기요청.log`). MainActivity.java:94 `data.optString("resultId",null)`은 Android `org.json`에서 JSON null을 문자열 "null"로 돌려준다(android-json 소스 `JSONObject.optString`·`JSON.toString`, 반례 D1). Store.java:159 → :134 `checkedResultId("null")`이 IllegalArgumentException("결과 번호를 확인하세요.")을 던지고, MainActivity.java:40이 이를 MeetingService.safeMessage의 일반 문구로 바꾼다(D2). `resultId` 칸이 없으면 열린다(D3). BASE 대조는 같은 로그 끝. | 기기(API 35)에서 `optString`을 직접 돌리지 못했다. 쓴 jar는 2013년판 AOSP 구현이고 이 부분은 지금 AOSP와 같다고 알고 있으나, 기기 시험 한 줄로 확인해 닫아야 한다. 화면 시험의 모의 브리지(화면검증-브라우저.cjs:8의 open)는 resultId를 보지 않고 결과 없는 항목을 열지 않아 이 경로를 통과시켰다. | Codex. 브리지에서 빠진 칸과 JSON null을 Java null로 읽는 도우미를 하나 두고 MainActivity.java:55·94·100·102에 쓴다. 화면도 null 칸을 보내지 않게 하면 더 안전하다. AndroidChecks에 `new JSONObject("{\"resultId\":null}")` 판정과 결과 없는 회의를 여는 경로를, 화면 시험에 결과 없는 항목 열기를 더한다. |
| R3 | 확정(브리지 계약, 화면은 아직 미연결) | 평가 브리지가 스스로 허용한 `comment:null`(MainActivity.java:54가 `JSONObject.NULL`을 통과시킴)을 문자열 "null"로 저장한다. 별점 null·의견 null이면 '둘 다 비면 거절'을 지나 의견 "null"로 저장되고, 별점만 줄 때도 의견이 "null"이 된다. `resultId:null`(최신 결과에 평가)은 R2와 같은 이유로 실패한다. 설계 '평가 저장과 다시 정리'의 수용 조건을 브리지에서 지키지 못한다. | MainActivity.java:55 `data.optString("comment","")`, `data.optString("resultId",null)`. 반례 B7·B8·B9. Store 수준 B1~B6·B10~B12는 통과. | 지금 Task 10 화면은 review를 부르지 않으므로 사용자에게 닿는 시점은 Task 13이다. | Codex. R2의 도우미로 comment null은 빈 문자열로, resultId null은 Java null로 읽는다. 브리지 입력 판정 시험을 더한다. |
| R4 | 확정(손상 조건) | 이관을 마친 뒤 기본 보관함 `작성중.json`이 손상되면 draft·saveDraft·clearDraft가 모두 예외를 던진다. 앱을 열면 초기화가 멈춰 지난 회의 목록과 상태 조회가 시작되지 않고, 메모를 칠 때마다 오류가 뜨고, '회의 시작'은 회의 기록을 만든 뒤 clearDraft에서 실패해 '녹음 중' 상태의 빈 기록만 남긴다(2회 시도에 2개). 앱 내부 파일이라 사용자가 직접 고칠 수 없다. BASE는 시작할 때 손상 메모를 그냥 지워 스스로 복구됐다. | Store.java:244(손상 파일을 그대로 파싱), :252·253(saveDraft·clearDraft가 먼저 draft()를 부름), MainActivity.java:177(create 뒤 clearDraft), app.js:320(applyDraft 실패 시 history·poll·setInterval을 건너뜀). 반례 C6~C9, BASE 대조(시작 성공·손상 메모 지워짐), `Task10-반례-초안실패화면.log`(draft 실패 뒤 history·status 요청 0회, 목록 0개). | 손상이 생기는 빈도는 추정이다. Android 10 이하 AtomicFile은 백업 방식이라 쓰는 도중 종료되면 본 파일이 반쯤 쓰인 채 남을 수 있고, Store.read는 백업을 복구하지 않고 직접 읽는다. Android 11부터는 새 파일에 쓴 뒤 이름을 바꿔 드물다. 설계는 옛 메모 손상만 정했지만 같은 원칙(빈 메모로 계속)을 적용하는 것이 자연스럽다. | Codex. 기본 보관함 메모를 읽지 못하면 빈 메모로 돌려준다(손상 파일은 이름을 바꿔 보존). clearDraft는 이관 표시만 확인한 뒤 파싱 없이 지운다. 이관 쓰기 실패도 예외로 초기화를 멈추지 말고 빈 메모로 넘긴 뒤 다음 실행에 다시 시도한다. AndroidChecks에 '손상된 기본 메모에서 읽기·저장·시작'을 더한다. |
| R5 | 확정(화면 품질) | 회의명 빈칸 안내(계획의 정해진 문구 "비워 두면 AI가 회의 내용을 보고 정합니다")가 360px·390px에서 잘려 끝까지 읽을 수 없다. 412px에서만 다 보인다. 지원 폭 세 개 중 두 개에서 안내가 깨진다. | index.html:53 placeholder. 짝 캡처 `모바일-360-준비.png`("…보고 정햡"), `모바일-390-준비.png`("…정합니ㄷ"). 측정값은 문구 폭 305px, 입력 칸 안쪽 폭 268px(360)·298px(390)·320px(412)이다(`Task10-반례-문구폭.log`). | 헤드리스 Chrome(Windows 글꼴) 측정이다. 휴대폰 글꼴에서는 폭이 조금 다를 수 있으나 360px의 37px 차이는 넘기 어렵다. | Codex. 정해진 문구를 입력 칸 아래 안내 줄로 옮기고 placeholder는 짧게 두는 식으로 고친 뒤 360·390 캡처로 확인한다. Task 13 화면 작업으로 넘길지는 주작성자가 정한다. |
| R6 | 확정(선택, Task 11에서 닿음) | finish가 기록에 resultId·완료 상태를 먼저 넣은 뒤 의견 길이를 검사하고 파일을 쓴다. 거절이나 쓰기 실패가 나면 MeetingService가 실패 상태를 저장할 때 결과 파일이 없는 resultId가 회의정보.json에 남고, 그 회의는 목록에서 사라져 '읽지 못한 기록'으로만 센다. | Store.java:259(값 넣기) → :260(의견 길이 검사), MeetingService.java:56(catch에서 status("failed") → save). 반례 '참고-문제 finish가 입력 검사로 거절된 뒤…'. | 지금은 feedback이 늘 null이라 의견 길이 경로는 닿지 않는다. 쓰기 실패 경로는 지금도 닿지만 드물다. | Codex(Task 11 전). 검사를 먼저 하고, 기록 사본에 값을 넣어 파일을 다 쓴 뒤에 원래 기록에 반영한다. |
| R7 | 확정(선택) | 시험이 바뀐 실제 경로를 다 덮지 못한다. AndroidChecks는 실제 Store를 쓰지만 브리지(MainActivity.dispatch)를 거치지 않고, 새 회의의 결과 수·손상된 기본 메모·평가 거절 사례를 보지 않는다. 화면 시험의 모의 브리지는 open에서 resultId를 무시한다. BASE에 있던 공유 zip 내용 검사와 녹음 파일 재생 검사(기기에 실제 자료가 있을 때만 돌던 것)가 빠졌는데, 이번에 share·copy는 `회의록.txt` 대신 결과 기록에서 글을 다시 만들도록 바뀌었다(MainActivity.java:181-205). | AndroidChecks.java 전체, 화면검증-브라우저.cjs:8, `git diff 03c4a6b..e464b82 -- tests/AndroidChecks.java`의 지운 줄. | — | Codex. R1~R4 시험을 더할 때 공유 글과 zip 항목을 합성 자료로 확인하는 시험을 하나 둔다. resultText를 static으로 빼면 기기 시험에서 부를 수 있다. |
| R8 | 확정(선택) | 다듬을 점 다섯 가지다. (1) MainActivity의 설명 주석 4줄(해제문자 처리, copy, share 두 곳)이 동작 변경 없이 지워졌다. (2) index.html:37·53 들여쓰기가 빠지고 :137에 빈 줄이 남았다. flow.js 새 세 줄만 큰따옴표를 쓴다. (3) settingsIdle·fileIdle 문구가 키·모델·평가·권한 대기에도 '설정 파일'을 말한다(MainActivity.java:118-123). (4) 360px 첫 화면 상태 문장이 "있습니 / 다."로 끊긴다(app.css:75의 `overflow-wrap: anywhere`). 하단 안내처럼 `word-break: keep-all`을 주면 낫다. (5) Ai.java:87은 옛 기록의 `context`를 아직 보낸다. 계획대로 Task 11에서 뺀다. | 각 파일:줄, 캡처 `모바일-360-첫화면.png`. | (4)는 기존 CSS 성질이 새 기본 문장에서 드러난 것이다. | Codex 판단. |

## 반드시 고칠 것

1. **R1. 새 회의 첫 분석 때 가짜 `결과-legacy.json`이 생긴다(Store.java:263 → :96 → :152-157).**
   - 재현. `Store.create`로 새 회의를 만들고 MeetingService·Ai와 같은 순서로 `save`(분석 시작) → `save`(사용량) → `finish(record, minutes, null)`을 부른 뒤 `results("main", id)`를 본다. 반례 코드는 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task10\검토재현\harness\kr\local\meetingjournal\ReviewRepro.java`의 `phantomLegacy`다.
   - 기대 동작. 결과 버전은 1개이고 회의 폴더에 `결과-legacy.json`이 없다. 두 번 분석하면 2개다. 1.2.0에서 요약 없이 남은 옛 회의도 첫 분석 뒤 1개다. 1.2.0 회의의 보존(A5~A10)은 지금처럼 유지된다.
2. **R2. 결과 없는 회의를 열 수 없다(app.js:129-130, MainActivity.java:94·100·102, Store.java:134).**
   - 재현. 분석에 실패한 회의를 지난 회의에서 누른다. 또는 `{"location":"main","id":"<결과 없는 회의>","resultId":null}`을 open에 넘긴다(브리지 첫 호출과 같은 `store.result(location,id,data.optString("resultId",null))`).
   - 기대 동작. 회의가 열리고 결과 창의 '다시 분석'과 '음성 포함 전체 공유'를 쓸 수 있다. 분석 실패 직후 자동 열기도 성공한다. 기기 시험에 `optString` 판정 한 줄을 넣어 실제 기기에서 먼저 실패를 확인한 뒤 고치기를 권한다.
3. **R3. 평가 브리지가 JSON null을 문자열 "null"로 넘긴다(MainActivity.java:54-55).**
   - 재현. review에 `{"stars":null,"comment":null}`, `{"stars":4,"comment":null}`, `{"stars":2,"resultId":null}`을 넘긴다(반례 B7~B9).
   - 기대 동작. 첫째는 "별점이나 의견을 입력하세요."로 거절, 둘째는 빈 의견으로 저장, 셋째는 최신 결과에 저장된다.
4. **R4. 손상된 기본 보관함 메모가 앱 초기화와 회의 시작을 막고 빈 '녹음 중' 기록을 남긴다(Store.java:244·252·253, MainActivity.java:177).**
   - 재현. 이관을 마친 상태에서 `회의자료\회의기록\작성중.json`을 `{"title":"쓰다 만`으로 바꾼 뒤 앱을 열고 회의 시작을 두 번 누른다(반례 C6~C9, 화면 쪽은 `검토재현\초안실패화면.cjs`).
   - 기대 동작. 메모는 빈 메모로 읽히고 목록·상태 조회가 이어진다. 새 메모를 저장할 수 있다. 회의 시작이 성공하고 실패한 시작이 빈 기록을 남기지 않는다. 이관 쓰기 실패도 초기화를 멈추지 않는다.
5. **R5. 회의명 빈칸 안내가 360·390px에서 잘린다(index.html:53).**
   - 재현. 360px 또는 390px에서 '회의 준비'를 펼친다(짝 캡처 `모바일-360-준비.png`, `모바일-390-준비.png`, 측정 `Task10-반례-문구폭.log`).
   - 기대 동작. 정해진 문구 "비워 두면 AI가 회의 내용을 보고 정합니다"가 360·390·412px 모두에서 끝까지 보인다.

## 선택 개선

- R6. finish의 검사·쓰기 순서(Task 11 의견 반영 전에 고치기를 권함).
- R7. 브리지·결과 수·손상 메모·평가 거절·공유 글을 덮는 시험 보강.
- R8. 지운 주석 복원, 들여쓰기·따옴표, 잠금 문구, 상태 문장 줄바꿈, Task 11의 context 제거.

## 실행을 멈출 지적

없다. 사용자 실제 자료나 배포에 닿는 위험은 찾지 못했다. 다만 Task 11·12·13이 `results()`·resultId·평가 브리지를 그대로 쓰므로 R1~R3은 Task 11에 들어가기 전에 닫는 것을 권한다.

## 확인했지만 문제가 아닌 것

- 목록은 깨진 회의정보.json과 보관함 이름이 다른 기록을 빼고 skipped로 세며, `.tmp`·`.new`·다른 파일은 무시하고 전체가 실패하지 않았다(반례 H1, 짝 AndroidChecks.java:133-137). 요약.json만 깨진 옛 회의도 빠지고 '읽지 못한 기록'으로 센다. BASE에서도 이런 회의는 열 수 없었으므로 설계의 '읽지 못한 기록' 범위로 본다.
- 화면에서 프로젝트 줄·프로젝트 창·1판 설정 파일 창·동의 체크 세 개(녹음, AI 분석, 재분석)가 빠졌다(index.html diff, 캡처). 하단 안내 "녹음 전에 참석자에게 녹음과 AI 분석(OpenAI 전송)을 알려 주세요."는 정해진 문구 그대로이고, 하단 고정 영역(96~113px)이 360·390·412px 모두에서 목록 끝을 가리지 않았다(`Task10-반례-하단가림.log`). 목록의 '이전 프로젝트: …', '★ 4', '제목 미정 회의', '읽지 못한 기록 2개'와 녹음 중 설정 잠금 화면을 캡처로 확인했다.
- 회의명을 적어도 AI 제목으로 저장하는 동작은 BASE(Store.java:141)와 Windows(`desktop\앱\화면\app.js:1132`)도 같아 이번 변경의 결함이 아니다.
- 공백 검사 `git diff --check 03c4a6b..e464b82`는 문제 없음, 커밋 작성자는 계획의 저장소 설정(yeunlee1, GitHub 비공개 메일)과 같다.

## 시험 결과

로그 폴더는 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\`이고 반례 코드는 복제본 안 `Task10\검토재현\`(git 제외)에 있다. 실제 OpenAI 호출은 0회다(빌드의 요약 양식 추출은 로컬 모의 응답, 화면은 모의 브리지, 반례는 네트워크 없음).

| 시험 | 명령(기준 위치) | 결과 | 종료 코드 | 로그 |
|---|---|---|---|---|
| Node | `mobile\안드로이드`에서 `VOICENOTE_TOOLS=C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드 node --test tests/*.test.cjs` | 19 통과, 0 실패, 0 건너뜀 | 0 | `Task10-Node.log` |
| JVM 단독 6종 | 시험마다 필요한 `java.*` 소스만 javac 후 실행. AiResponseModelTest만 android.jar로 컴파일·실행 경로 | SettingsExchange 48, TextChunks 18, TrialAccess 59, AiUsage 20, AiResponseModel 6 통과, CustomFormat 유효·무효 2줄 기대대로 | 모두 0 | `Task10-JVM.log`, `Task10-JVM\` |
| 검증용 빌드 | `빌드.ps1 -DebugBuild -OutputRoot …\Task10-빌드\검토-Claude-20261023-143837` | 성공, 요약 양식 추출 완료, 공용 기본 키 포함 아니요(서명 암호는 출력하지 않음) | 0 | `Task10-빌드.log` |
| 화면(모의 브리지) | `mobile\안드로이드`에서 `node tests/화면검증-브라우저.cjs …\Task10-화면` | 30/30 통과 | 0 | `Task10-브라우저.log`, `Task10-화면\` |
| AndroidChecks | **미실행** | — | — | `emulator-5554`가 이미 연결돼 있어 지시대로 쓰지도 새로 켜지도 않았다. 짝의 `최종-AndroidChecks.log`(PASS 91)만 읽었다. |
| 반례 JVM | `검토재현`에서 android-json.jar·대역 클래스·e464b82 Store.java 등을 javac 후 `ReviewRepro` 실행 | 33 통과, 13 기대와 다름(A1~A4, D1·D2, B7~B9, C6~C9), 참고 2건 | 1(기대와 다름 때문) | `Task10-반례-JVM.log` |
| BASE 대조 | 같은 방식으로 03c4a6b Store.java와 `BaseRepro` 실행 | 손상 메모에서 시작 성공·메모 지워짐, 결과 없는 회의 load 성공 | 0 | `Task10-반례-JVM.log` 끝 |
| 열기 요청 수집 | `node 검토재현/열기요청.cjs` | 목록 클릭·자동 열기 모두 `"resultId":null` | 0 | `Task10-반례-열기요청.log` |
| 문구 폭 | `node 검토재현/문구폭.cjs` | 360·390px 잘림, 412px 안 잘림 | 0 | `Task10-반례-문구폭.log` |
| 초안 실패 화면 | `node 검토재현/초안실패화면.cjs` | draft 실패 뒤 history·status 요청 0회, 목록 0개 | 0 | `Task10-반례-초안실패화면.log` |
| 하단 가림 | `node 검토재현/하단가림.cjs` | 세 폭 모두 목록 끝을 가리지 않음 | 0 | `Task10-반례-하단가림.log` |

## 최신 짝 HEAD 확인

검토를 마칠 때 짝 브랜치는 Task 9까지 나아가 463e900(`feat: 안드로이드 설정 파일 2판과 공용 JSON 해석기 분리`)이었다. 읽기만 해서 대조하니 R1~R5의 코드는 줄 번호만 바뀌고 그대로다. Store.java:108·169·261·269·270·273, MainActivity.java:55·95·101·103, app.js:137, index.html:53이다. 고친 커밋은 이 줄들을 기준으로 다시 보면 된다.

## 하지 않은 것

push·커밋·원격 작업, 실제 OpenAI 호출, 사용자 실제 자료(`%LOCALAPPDATA%\MeetingJournal`, 휴대폰 앱 자료) 읽기·수정, 짝 작업 폴더와 `C:\DEV\VoiceNote` 추적 파일 수정은 하지 않았다. 짝 작업 폴더에서는 보고서·로그·캡처를 읽기만 했다. 에뮬레이터는 쓰지 않았다.

## 재확인 기록

| ID | 반영 또는 반박 근거 | 새 후보 | 실패 조건 재시험 | 영향 범위 재확인 | 판정 |
|---|---|---|---|---|---|
| R1 | 대기 | — | 반례 A1~A4, 1.2.0 보존 A5~A10 | Task 12·13이 쓰는 results·result | 대기 |
| R2 | 대기 | — | 반례 D1~D3, 열기 요청 수집, 기기 판정 한 줄 | share·copy·share all·poll 자동 열기 | 대기 |
| R3 | 대기 | — | 반례 B7~B9 | Store 평가 검사 B1~B6 | 대기 |
| R4 | 대기 | — | 반례 C6~C9, 초안 실패 화면 | 이관 C1~C5, 짝 draftFailureCheck | 대기 |
| R5 | 대기 | — | 360·390·412 캡처와 문구 폭 측정 | 회의 준비 다른 칸 배치 | 대기 |

### 재확인 1회차(2026-10-23, 후보 9fdf7e6)

- **대상.** 후보 9fdf7e6f767846e0a164568e81810267041a187e(`fix: 첫 결과와 null 입력·손상 초안 복구를 바로잡음`, 기준 463e900, 변경 7파일)와 짝 보고 `구현-Task10.md`의 'Dispatch B 기기 확인과 보완'이다. 복제본은 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\재확인-후보-9fdf7e6`이다(`git clone --no-hardlinks` 뒤 checkout, 추적 파일 변경 0). 고치기 전 대조는 `재확인-기준-463e900`(463e900에 후보의 `AndroidChecks.java`·`화면검증-브라우저.cjs`와 MainActivity 검토용 대역 한 줄 `nullableString`=옛 `optString(이름,null)`을 얹음)에서, N1 기기 확인은 `재확인-후보-9fdf7e6-N1기기확인`(후보에 시험 probe 두 개만 더함)에서 했다. 짝 작업 폴더는 읽기만 했다.
- **판정.** 반드시 고칠 것 R1~R5는 지적한 재현 조건과 기대 동작 기준으로 모두 닫혔다. 선택 R6도 닫혔다. 짝이 더한 회귀 시험(기기 다섯 묶음, 화면 다섯 건)은 고치기 전 코드에서 모두 실패하고 후보에서 통과하므로 위양성이 아니다. 기기 시험 AndroidChecks도 이번에 emulator-5554에서 직접 돌려 114건 통과를 확인했다. 다만 R1과 같은 원인(요약.json을 옛 결과로 읽는 대체 경로)이 finish 중간 실패 경로에 남아 있어 새 지적 N1(반드시 고칠 것, 드문 실패 경로)로 올린다.

| ID | 반영 또는 반박 근거 | 새 후보 | 실패 조건 재시험 | 영향 범위 재확인 | 판정 |
|---|---|---|---|---|---|
| R1 | Store.java:171 `preserveLegacy`가 디스크 회의정보.json에 `location`이 있으면 건너뛴다. 배포된 1.2.0 기록에는 이 칸이 없다(`git log -S'"location"'`의 첫 커밋이 e464b82). :276-292 `finish`는 끝에서 `save`를 부르지 않고 :290에서 회의정보.json을 직접 쓴다. | 9fdf7e6 | JVM A1~A4b 통과(새 회의 1개→2개, `결과-legacy.json` 없음, 요약 없던 옛 회의 1개→2개). 기기 probe `first` 통과(3건). 같은 시험을 463e900에 얹으면 '새 회의 첫 분석은 가짜 legacy 없이 결과 하나다'에서 실패한다. | A5~A11 통과(1.2.0 회의의 최신 결과 보존, 앞선 평가 유지, 목록 제목, 실패 뒤 앞선 결과, 요약.json만 있던 옛 회의는 legacy와 새 결과 2개). 기기 archiveChecks 통과(114건 안). | 닫힘. 같은 원인의 실패 경로는 N1. |
| R2 | MainActivity.java:111 `nullableString`(칸 없음·JSON null → Java null)을 :55·95·101·103에 썼다. app.js:139-140은 결과 id가 없으면 `resultId` 칸을 보내지 않는다. | 9fdf7e6 | 기기 probe `open` 통과(3건). 그 첫 확인으로 API 35의 `optString(JSON null, null)`이 글자 "null"인 것을 기기에서 확인했다. JVM D1~D4와 D2b(옛 화면처럼 `resultId:null`을 보내도 열림) 통과. 후보 app.js가 실제로 보낸 열기 요청은 목록 클릭과 분석 실패 뒤 자동 열기 모두 `resultId` 칸이 없다. 화면 시험 '결과 없는 회의를 열 때 null 결과 칸을 보내지 않는다' 통과(463e900에서는 실패). | share·copy·share all은 같은 도우미를 거친다. poll 자동 열기(app.js:234)는 snapshot에 resultId가 없으면 칸을 빼고, 결과 창의 다시 분석 버튼이 켜진다(화면 시험). 결과 없는 회의의 versions는 빈 배열이다(D4). | 닫힘 |
| R3 | MainActivity.java:55가 resultId·comment를 모두 `nullableString`으로 읽고, Store.saveReview가 null 의견을 빈 값으로 바꾼다. | 9fdf7e6 | JVM B7(정해진 문구 '별점이나 의견을 입력하세요.'로 거절)·B7b(평가 파일 안 생김)·B8(별점만 주면 빈 의견)·B9·B9b(resultId null이나 칸 없음은 최신 결과) 통과. 기기 probe `review` 통과(2건), 463e900에서는 실패. | B1~B6·B10~B12와 B11b(숫자 의견 거절) 통과. | 닫힘 |
| R4 | Store.java:261-266은 기본 메모를 읽지 못하면(손상, 칸 형식 오류, 4,000자 초과) 원문을 `작성중-읽기실패-<시각>-<UUID>.json`에 보존하고 지운 뒤 빈 메모를 돌려준다. MainActivity.java:175 `begin`은 회의 기록을 만들기 전에 `draft()`를 먼저 부른다. app.js:101은 draft가 실패해도 초기화를 이어 간다. | 9fdf7e6 | JVM C6~C9 통과(손상 메모에서 읽기·저장, 시작 2회 모두 성공, 빈 '녹음 중' 기록 없음). 기기 probe `draft` 통과(4건), 463e900에서는 JSONException으로 실패. 화면 시험 '초안 읽기 실패 뒤에도 목록·상태를 불러온다' 통과(463e900에서는 실패). | C1~C5와 기기 draftFailureCheck 통과. G1(이관 표시 저장이 실패하면 begin이 기록을 만들기 전에 멈춤), G2(다음 호출에서 같은 메모 이관), G3·G4(형식 오류·4,001자 메모도 빈 메모와 원문 보존), G5(손상 메모에서 clearDraft 성공) 통과. 백업 파일은 목록과 읽지 못한 기록 수에 섞이지 않는다(H2). | 닫힘 |
| R5 | index.html:53이 정해진 문구를 입력 칸 위 안내 줄 `#title-hint`('선택 · 비워 두면 AI가 회의 내용을 보고 정합니다')로 옮기고 placeholder는 '선택'으로 줄였다. app.css:241. | 9fdf7e6 | 화면 시험의 360·390·412px '회의명 빈칸 안내 전체 표시' 통과(463e900에서는 세 폭 모두 실패). 캡처 `재확인-Task9·10-화면\모바일-360-준비.png`·`모바일-390-준비.png`·`모바일-412-준비.png`를 직접 열어, 세 폭 모두 문구가 한 줄로 끝까지 보이는 것을 확인했다. | 날짜·참석자·출력 형식·상세 내용 배치와 가로 넘침 없음(같은 캡처와 화면 시험). 접근성 이름에 안내가 두 번 들어가는 점은 N2(선택). | 닫힘 |
| R6(선택) | Store.java:278이 의견 길이를 먼저 검사하고, :281-292가 사본에 모두 쓴 뒤에만 호출자 기록을 바꾼다. | 9fdf7e6 | JVM F1~F4 통과(463e900은 F2·F4 실패). 기기 probe `finish` 통과(2건). | E3·E4 통과(요약-<시각>이 있던 옛 회의와 결과가 있던 회의는 재분석이 중간에 실패해도 최신이 앞선 결과). | 닫힘 |
| R7(선택) | 결과 수, null 판정, 손상 메모, 평가 거절은 기기 시험에 들어갔다. MainActivity.dispatch를 거치는 시험과 공유 글·zip 합성 시험은 없다. 브리지 연결(:55·95·101·103)은 코드로만 확인했다. | 9fdf7e6 | — | — | 일부 남음(선택) |
| R8(선택) | (4) 상태 문장 줄바꿈만 반영했다(app.css:242, 360px 첫 화면이 '…시작할 수 / 있습니다.'로 끊김). (1)(2)(3)(5)는 그대로다. | 9fdf7e6 | — | — | 일부 남음(선택) |

#### 새로 찾은 것

| ID | 구분 | 사용자 영향·수용 조건 | 직접 근거·재현 조건 | 반증·한계 | 담당·다음 행동 |
|---|---|---|---|---|---|
| N1 | 반드시 고칠 것(확정, 드문 실패 경로) | 새 회의나 1.2.0에서 요약이 없던 옛 회의의 첫 분석에서, finish가 요약.json을 쓴 뒤 회의록.txt나 회의정보.json을 쓰지 못하면(디스크 쓰기 실패, 또는 그 몇 ms 사이 프로세스 종료) 결과 버전이 2개(`결과-<v>`와 `legacy`)가 되고 최신 결과가 `legacy`로 잡힌다. 이 legacy는 파일이 아니라 새 요약.json으로 만든 가상 결과라, 다음 분석이 성공하면 목록에서 사라지고 그사이 남긴 평가(`평가-legacy.json`)도 화면에서 사라진다. 계획 Task 10의 '옛 회의의 결과 id'(1.2.0 이전 회의만)와 'results는 1.3.0 결과 파일만'에 어긋난다. | Store.java:287-290(결과 → 요약 → 회의록 → 회의정보 순서로 쓴다), MeetingService.java:56·40(실패하면 finish가 바꾸지 않은 호출자 기록으로 save한다), Store.java:159-163(resultId가 없고 요약.json이 있으면 legacyId), :175-180, :189(results가 가상 최신 결과를 더한다). 재현 순서는 `create`(또는 요약 없는 옛 회의) → `save`(analyzing) → 회의 폴더에 `회의록.txt.new` 폴더를 만들어 쓰기를 막음 → `finish` 실패 → 막음 해제 → `state:failed`로 `save` → `results`·`result(null)`이다. JVM `재확인-Task9·10-반례-JVM.log` E1·E2, 기기 `재확인-Task9·10-N1-AndroidChecks.log`(probe `n1new`·`n1old` 모두 `versions=2 … latest=legacy`). | 463e900도 같은 경로에서 legacy가 생겼다. 그때는 `결과-legacy.json` 파일이었고 최신은 v였다(`재확인-Task9·10-반례-JVM-기준대조.log` E1·E2). 그래서 이번 수정이 만든 회귀가 아니라 R1의 남은 경로다. 요약 요청은 strict JSON schema라 `format()` 예외로는 생기지 않고, 쓰기 실패나 짧은 사이의 종료가 있어야 한다. | Codex. 권장은 finish에서 `결과-<v>.json` 다음에 회의정보.json을 쓰고 그때 호출자 기록을 갱신한 뒤 요약.json·회의록.txt를 쓰는 것이다. 그러면 뒤쪽 쓰기가 실패해도 최신은 실제 파일 v다. 요약.json을 옛 결과로 읽는 대체를 1.2.0 기록으로만 좁히는 방법도 있으나, 요약 없던 옛 회의(n1old)는 그것만으로 닫히지 않는다. 기기 시험에 위 순서의 '요약.json 뒤 실패' 확인을 넣는다. Task 11이 finish를 다시 고치므로 그때 함께 고쳐도 되지만, Task 12·13이 results()를 쓰기 전에는 닫아야 한다. |
| N2 | 선택(접근성) | 회의명 입력 칸의 접근성 이름이 '회의명 선택 · 비워 두면 AI가 회의 내용을 보고 정합니다'이고 설명도 같은 안내라, 화면 낭독기가 안내를 두 번 읽는다. WCAG 기준을 어기지는 않는다. | index.html:53(label 안에 small이 있고 input의 aria-describedby도 같은 small). `재확인-Task9·10-반례-접근성이름.log`(헤드리스 Chrome 접근성 트리). | — | Codex. small을 label 밖으로 빼고 `label for="title"`로 잇거나 aria-describedby를 뺀다. Task 13 화면 작업에서 함께 해도 된다. |
| N3 | 참고 | 결과가 있던 회의의 재분석이 마지막 회의정보.json 쓰기에서 실패하면, 완성된 새 결과 파일이 버전 목록에 하나 더 보이고 최신은 앞선 결과로 남는다(E4b). 새 결과 파일은 온전하므로 결함으로 보지 않는다. | `재확인-Task9·10-반례-JVM.log` E4·E4b. | — | 기록만 한다. |

#### 시험 결과

로그는 모두 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\` 아래 `재확인-Task9·10-*.log`다. 실제 OpenAI 호출은 0회다. 기기 시험은 HTTPS를 모의 처리기로 바꾸고 `real API calls=0`을 출력하며, 빌드의 요약 양식 추출은 로컬 모의 응답, 화면 시험은 모의 브리지를 쓴다.

| 시험 | 명령(기준 위치) | 짝 보고 | 이번 결과 | 로그 |
|---|---|---|---|---|
| Node | `mobile\안드로이드`에서 `VOICENOTE_TOOLS=C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드 node --test tests/*.test.cjs` | 19/19 | 19 통과·0 실패·0 건너뜀, 종료 0 | `재확인-Task9·10-Node.log` |
| JVM 단독 | 시험마다 필요한 소스만 javac 후 실행(AiResponseModelTest만 android.jar) | Task 9 근거 재사용 | SettingsFile 19, TextChunks 18, TrialAccess 59, AiUsage 20, AiResponseModel 6 통과, CustomFormat 유효·무효 2줄 기대대로, 모두 종료 0 | `재확인-Task9·10-JVM.log` |
| 검증용 빌드 | `빌드.ps1 -DebugBuild -OutputRoot …\재확인-Task9·10-빌드\후보-9fdf7e6-153758` | 종료 0 | 종료 0, 공용 기본 키 포함 아니요, APK sha256 `c1deba66…6248ef` | `재확인-Task9·10-빌드.log` |
| 화면(모의 브리지) | `mobile\안드로이드`에서 `node tests/화면검증-브라우저.cjs …\재확인-Task9·10-화면` | 37/37 | 37/37, 종료 0 | `재확인-Task9·10-화면.log` |
| AndroidChecks(기기) | emulator-5554(VoiceNotePhone, API 35)에 `adb -s emulator-5554 install -r` 후 `am instrument -w kr.local.meetingjournal/kr.local.meetingjournal.AndroidChecks` | 114 PASS | `PASS 114 native storage and recovery checks; real API calls=0`. 처음 설치 뒤, 고치기 전 대조 뒤, N1 확인 뒤 다시 설치해 세 번 모두 같다. 회귀 probe first 3·open 3·review 2·draft 4·finish 2 통과 | `재확인-Task9·10-AndroidChecks.log`, `재확인-Task9·10-N1-AndroidChecks.log` 끝 |
| 고치기 전 대조(화면) | 463e900에 후보 `화면검증-브라우저.cjs`만 얹음 | — | 32/37, 새 확인 5건(안내 세 폭, null 결과 칸, 초안 실패)만 실패 | `재확인-Task9·10-RED-화면.log` |
| 고치기 전 대조(기기) | 463e900에 후보 `AndroidChecks.java`와 MainActivity 대역을 얹어 빌드·설치한 뒤 probe 다섯 개 | 짝 RED 로그 | 다섯 개 모두 기대한 확인에서 FAIL(짝 RED 로그와 같은 문구) | `재확인-Task9·10-RED-빌드.log`, `재확인-Task9·10-RED-AndroidChecks.log` |
| 반례 JVM | 후보 Store.java, AOSP org.json(android-json), 검토용 Android 대역으로 `ReviewRecheck` | — | 71 통과 / 0 기대와 다름, 참고-문제 3건(E1·E2는 N1, E4b는 N3) | `재확인-Task9·10-반례-JVM.log` |
| 반례 JVM 기준 대조 | 463e900 Store.java로 같은 반례 | — | A1~A4b·C6~C9·F2·F4·E3·E4 실패(고치기 전 결함이 그대로 재현됨) | `재확인-Task9·10-반례-JVM-기준대조.log` |
| N1 기기 | 후보에 probe `n1new`·`n1old`만 더해 빌드·설치 | — | 둘 다 FAIL(versions=2, latest=legacy) | `재확인-Task9·10-N1-빌드.log`, `재확인-Task9·10-N1-AndroidChecks.log` |
| 열기 요청 수집 | 복제본 `검토재현-재확인\열기요청.cjs`(앞선 도구 재사용) | — | 목록 클릭·자동 열기 모두 `resultId` 칸 없음 | `재확인-Task9·10-반례-열기요청.log` |
| 접근성 이름 | 복제본 `검토재현-재확인\접근성이름.cjs` | — | `#title`의 이름과 설명에 같은 안내 | `재확인-Task9·10-반례-접근성이름.log` |
| 패치 검사 | `git diff --check 463e900 9fdf7e6` | 통과 | 문제 없음. 작성자 yeunlee1(GitHub 비공개 메일) | (명령 결과만 확인) |

#### 기기 사용과 하지 않은 것

- 에뮬레이터는 짝이 띄워 둔 emulator-5554(VoiceNotePhone, API 35, 화면 없이 실행)만 썼다. `adb devices -l`에는 이 기기 하나뿐이었고, 모든 adb 명령에 `-s emulator-5554`를 붙였다. 새 에뮬레이터를 켜지 않았고 실기기에는 설치하지 않았다.
- AndroidChecks의 저장은 모두 testContext(앱 cache 아래 `task10-<UUID>` 폴더와 `task10-<UUID>-*` 설정 파일)로만 간다(AndroidChecks.java:186-193). 실행 전후로 에뮬레이터 앱의 `files/회의자료`는 2026-10-02에 만든 빈 프로젝트-01~03 그대로였고, cache와 shared_prefs에는 `task10-*` 항목만 늘었다(39→70, 19→31). 남은 시험 자료는 지우지 않았다.
- 대조 실행 때문에 463e900 빌드를 잠시 설치했다가, 끝에 후보 검증용 APK(sha256 `c1deba66…6248ef`)를 다시 설치하고 전체 114 PASS를 확인해 두었다.
- push·커밋·원격 작업, 짝 작업 폴더 수정, 실제 OpenAI 호출, 사용자 실제 자료(`%LOCALAPPDATA%\MeetingJournal`, 휴대폰) 접근은 하지 않았다. 띄운 헤드리스 Chrome은 도구마다 끝날 때 닫혔고 남은 시험 프로세스는 없다.
- 실제 마이크, 문서 선택 창, 공유 앱, 실기기는 이번에도 확인하지 않았다. 데스크톱 시험은 후보 변경(mobile/안드로이드 7파일) 밖이라 다시 돌리지 않았다.
