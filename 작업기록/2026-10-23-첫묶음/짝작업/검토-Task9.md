# Task 9 교차 검토

- **검토 대상.** 후보 463e90064a3d30b667c68f0ece21cd1d5f5714b0(브랜치 work/2026-10-23-안드로이드-프로젝트제거, 제목 `feat: 안드로이드 설정 파일 2판과 공용 JSON 해석기 분리`, 작성자 yeunlee1), 비교 기준 65c8f864998b5cb74d341f4424921b787a75c411, 작성자 보고 `C:\Users\user\AppData\Local\짝작업\VoiceNote\2026-10-23-첫묶음구현\구현-Task9.md`. 검토 복제본은 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task9`이다(`git clone --no-hardlinks` 뒤 checkout, 추적 파일 변경 0). 반례 코드는 복제본 안 `검토반례\`에만 두었다(복제본 `.gitignore`의 `/*`로 추적 밖). 공유 Task Master는 주작성자가 등록한 9.1(설정 파일)·5.5(Android)를 이어 쓰고 새로 등록하지 않았다.
- **판정. 보완 필요.** 설정 파일 2판의 해석·검증은 Windows와 같은 파일을 받아들이고 같은 파일을 같은 문구로 거절한다. 짝의 63사례에 더해 검토자 반례 79건도 모두 같았고, 짝이 보고한 Node·JVM·DebugBuild·화면 시험은 같은 숫자로 다시 통과했다. 그러나 이 작업의 기기 시험 `AndroidChecks.java:58`에 그대로 돌리면 반드시 실패하는 확인이 들어 있다(R1). 그래서 계획 Task 9 Step 4의 수용 조건(공통 확인과 AndroidChecks)을 채울 수 없고, 같은 실행에서 뒤쪽 기기 시험도 돌지 않는다. 기기 시험은 짝과 검토자 모두 아직 돌리지 않았으므로 내 형식 null 삭제와 중간 실패 되돌리기의 실제 기기 동작은 미확인이다.
- **범위.** 변경 15파일 diff 전체와 JsonText·SettingsFile·CustomFormat 전문, 지운 SettingsExchange.java의 BASE판, Store.java 설정 부분(27~86·112~133·289~295행), MainActivity의 dispatch·settingsIdle·pick·onActivityResult·readLimited·preview, app.js의 call과 다시 그리는 함수, AndroidChecks의 settingsChecks·testContext·onStart, 설정호환.test.cjs·SettingsFileTest.java를 읽었다. Windows 기준은 복제본 안 `desktop/앱/설정파일.cjs` 전문, `출력형식.js`의 format·validateCustom, `서버.cjs:20357-20470`(settingsPreview·importSettings·`/api/settings/*`)이다. 설계 '설정 파일 2판'·'Android 화면과 앱 사이의 요청'과 계획 '실행 방식과 교차 검증'·Phase 2 머리 문단·Task 9 절에 대조했다. 직접 실행한 것은 아래 '시험 결과' 표 전부다. 재사용한 증거는 짝의 RED 로그(먼저 실패한 기록)를 읽은 것뿐이다. 에뮬레이터는 지시대로 켜지도 쓰지도 않았다.

## 집중 확인

- **(a) Windows와 같은 판정·문구. 맞다.** SettingsFile.read의 검사 순서(크기 → 엄격한 UTF-8 → BOM 한 개 제거 → JSON → 1판 → format → 알 수 없는 칸 → 버전 → 요약 모델 → 기본 형식 → customFormat 칸 → 내 형식 → storage, SettingsFile.java:37-58)가 설정파일.cjs:51-69·34-41과 같고, 문구도 글자까지 같다. 설정호환.test.cjs는 실제 Windows 모듈(`require('../../../desktop/앱/설정파일.cjs')`)과, 후보 Java 소스를 그 자리에서 javac로 컴파일한 `SettingsFileTest --verdict`(SettingsFile.read → write)에 같은 바이트 파일을 넣어 비교한다. 모의 결과를 비교하는 시험이 아니다. 복사본에서 Android 쪽만 바꾼 변이 3개(저장 위치 상한 1001자, 1판 거절 줄 삭제, 정수 키 순서 맞춤 끄기)를 이 시험이 모두 실패로 잡았다. 검토자 반례 79건(깊은 중첩 6만 단계, 정수 모양 키의 순서와 4294967294/4294967295 경계, `__proto__`·`constructor` 키, 검사 순서 충돌, 중복 키, 버전 숫자 표기 17가지, CESU·overlong·범위 밖·끝 잘림 UTF-8, BOM 두 개·공백 뒤 BOM, JSON 밖 공백, 이스케이프, 서로게이트 길이 경계, JS trim에 없는 공백 U+200B·U+180E·U+0085 등)도 값과 문구가 모두 같았다. 받은 22건은 Android가 실제로 쓴 바이트(`--roundtrip`)를 Windows가 다시 읽어 같은 값이 되는 것까지 확인했다. JsonText.space 집합은 JS trim이 지우는 집합과 같다. 새 해석기는 V8 `JSON.parse`처럼 중복 키의 마지막 값을 쓰고 깊이 제한이 없는데, V8도 6만 단계를 문제없이 읽어 판정이 갈리지 않았다.
- **(b) 파일의 customFormat이 null이면 지우고, 실패하면 되돌린다. 코드는 맞고 기기 실행은 미확인이다.** Store.java:60이 null이면 `deleteCustomFormat()`, 값이 있으면 저장한다. 실패하면 63-71행이 요약 모델·기본 형식(이전 값이 없으면 칸 삭제)과 내 형식 파일의 원래 바이트(없었으면 삭제)를 함께 되돌리고, 성공·실패에 따라 Windows와 같은 두 문구 중 하나로 알린다. `deleteCustomFormat()`(295행)은 지운 뒤에도 파일이 남으면 예외를 던져 되돌리기로 이어진다. Windows(서버.cjs:20384-20398)는 AI설정.json만 되돌리므로 Android 쪽 범위가 더 넓다. 기기 시험(AndroidChecks.java:29-63)은 1·2 지점 실패, 삭제 뒤 실패, 없는 모델 건너뜀, null 삭제, storage 무시, 옛 회의 파일 불변을 담았다. 정적으로 따라가면 58행 앞까지는 기대대로 흐르지만 실행하지 못했다.
- **(c) storage·1판·128KiB·BOM·깨진 UTF-8. 맞다(UTF-8은 JVM 디코더 기준).** 내보내기 JSON(SettingsFile.java:18-19)에는 storage가 없다. 읽을 때는 storage를 Windows와 같은 규칙으로 검사만 하고 있었는지만 남긴다(56-57행). 적용은 storage 설정을 건드리지 않고 skipped에 `저장 위치: Android에서는 적용하지 않습니다.`를 더하며(Store.java:53), 미리보기는 `storage:null`과 `storageIgnored`를 준다(41행). 1판은 정해진 문구로 거절한다(SettingsFile.java:43). 128KiB는 MainActivity.readLimited(155-161행)와 read(38행)가 같은 문구로 막고, 정확히 131072바이트는 받는다. BOM은 한 개만 허용하고 두 개·공백 뒤 BOM은 양쪽 모두 거절한다. 깨진 UTF-8 다섯 가지는 JVM에서 양쪽 판정이 같았다. Android 기기의 UTF-8 디코더로는 돌려 보지 않았다(S3).
- **(d) `desktop/앱/프로젝트설정교환.cjs` 삭제. 맞다.** 계약의 예외대로 그 파일 하나만 지웠다. 그 밖의 desktop 파일과 `요약계약추출.cjs`는 건드리지 않았다. 복제본 전체에서 그 모듈을 부르는 코드는 없고 데스크톱 시험 150건이 통과했다. 남은 언급은 문서 두 곳뿐이다(S1). Claude 브랜치(aef5952)에는 옛 모바일 시험의 require가 남아 있지만 Task 9가 그 시험을 바꾸므로 병합 뒤에는 남지 않는다. 복제본 안에서 해 본 가상 병합(merge-tree)은 충돌이 없었고, Claude 쪽은 공통 기준 4faa115 이후 이 파일과 `설정파일.cjs`·`출력형식.js`·`mobile/안드로이드`를 바꾸지 않았다(`Task9-병합확인.log`).
- **(e) JVM 경계와 연결. 맞다.** JsonText·SettingsFile·CustomFormat의 import는 java.io·java.nio·java.util뿐이고 android.jar 없이 컴파일된다. Store(27-86행) → MainActivity(45·57-66·130·148·170행) → app.js(11-19행)가 2판 이름으로 이어진다. 내보내기 이름은 `<오늘>-VoiceNote-설정.json`이다(MainActivity.java:130). AndroidChecks에서 SettingsExchange·`project(slot)`·preset 사용이 모두 사라졌고(DebugBuild 컴파일 통과), 새 settingsChecks는 testContext의 격리된 폴더·설정 이름을 써서 실제 앱 자료를 건드리지 않는다(AndroidChecks.java:178-185).
- **(f) 화면 응답 모양. 맞다.** applySettings 응답은 Store.importSettings의 `{settings, customFormat, skipped}`에 `connection`을 더한 것이고(MainActivity.java:63), saveSettings 응답은 `{settings, connection}`이다(65행). app.js:12-16은 settings·connection·customFormat(null 포함)을 반영해 모델 선택·내 형식 선택지·편집기·시작 잠금을 다시 그린다. 화면 시험의 모의 applySettings(화면검증-브라우저.cjs:8)도 같은 모양이다. 미리보기 `{token, file, preview}`의 preview는 Windows `/api/settings/preview`의 모양에 `storageIgnored`를 더한 것이다. 지금 Android 화면에는 불러오기·미리보기 버튼이 없어 이 응답을 쓰지 않는다(Task 13 몫). 새 캡처 `모바일-390-2판-모델적용.png`(모델이 Luna로 바뀜)와 `모바일-390-2판-형식삭제.png`(선택지가 '내 형식 (새로 만들기)'로 돌아가고 시작이 잠김)를 직접 열어 확인했다.

## 시험 결과

로그 위치는 모두 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\` 아래다.

| 시험 | 명령(기준 폴더) | 결과 | 종료 코드 | 로그 |
|---|---|---|---|---|
| Android Node | `VOICENOTE_TOOLS=C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드 node --test tests/*.test.cjs` (복제본 `mobile/안드로이드`) | 19 통과, 0 실패, 0 건너뜀. `설정 2판 호환 사례 63건 일치` 출력 | 0 | `Task9-Node.log` |
| JVM SettingsFileTest | `javac` JsonText·CustomFormat·SettingsFile·SettingsFileTest(android.jar 없이) 후 `java` | PASS 19 | 0 | `Task9-JVM.log` |
| JVM TextChunksTest | TextChunks + 시험 | 18개 조합 통과 | 0 | `Task9-JVM.log` |
| JVM TrialAccessTest | TrialAccess + 시험 | 59개 통과 | 0 | `Task9-JVM.log` |
| JVM AiUsageTest | AiUsage·AiModels + 시험 | 20개 통과 | 0 | `Task9-JVM.log` |
| JVM AiResponseModelTest | `javac -cp android.jar src/*.java` + 시험 | 6개 통과. 첫 실행은 검토자 실행기의 `-cp` 경로 형식 오류(ClassNotFound)였고 같은 컴파일본을 Windows 경로로 다시 실행했다(로그에 둘 다 있음) | 0 | `Task9-JVM.log` |
| CustomFormat | Node `내형식일치.test.cjs` 안에서 JVM 실행 | 통과(Node 19건에 포함) | 0 | `Task9-Node.log` |
| DebugBuild | `빌드.ps1 -DebugBuild -OutputRoot C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task9-빌드\검토-Claude-20261023-150632` | 제품 Java·AndroidChecks 컴파일, d8, 서명 검증 통과. `공용 기본 키 포함: 아니요`. 클래스에 JsonText·SettingsFile이 있고 SettingsExchange는 없다 | 0(ok=True) | `Task9-빌드.log` |
| 데스크톱 | `node --test 앱/*.test.cjs tests/*.test.cjs` (복제본 `desktop`) | 150 통과, 0 실패, 0 건너뜀 | 0 | `Task9-데스크톱.log` |
| 화면(헤드리스 Chrome, 모의 브리지) | `node tests/화면검증-브라우저.cjs C:/DEV/VoiceNote/산출물/2026-10-23-첫묶음-검토/Task9-화면` | 32/32 | 0 | `Task9-화면.log`, 캡처 `Task9-화면\` |
| 패치 검사 | `git diff --check 65c8f86..463e900` | 문제 없음 | 0 | (명령 결과만 확인) |
| 반례: 설정 판정 | `node 검토반례/설정반례.cjs <Task9-JVM\SettingsFileTest>` (복제본 루트) | 79건 일치(Windows 받음 22, 거절 57), 받은 22건은 Android가 쓴 바이트를 Windows가 같은 값으로 다시 읽음 | 0 | `Task9-반례-설정판정.log` |
| 반례: 호환 시험 민감도 | `bash 검토반례/변이시험.sh` (복사본에서 `node --test tests/설정호환.test.cjs`) | 기준선 3/3 통과, 변이 3개 모두 실패로 잡음 | 0 | `Task9-반례-호환시험변이.log` |
| 반례: 기기 시험 58행 | `javac` JsonText·CustomFormat·SettingsFile·`검토반례/KeyCollisionRepro.java` 후 `java` | `AndroidChecks 58행 expect 결과=false` | 0 | `Task9-반례-기기시험키충돌.log` |
| 병합 참고 | 복제본 안 `git merge-tree --write-tree claude/work 463e900` | 충돌 없음 | 0 | `Task9-병합확인.log` |
| AndroidChecks(기기) | — | **미실행.** 지시에 따라 에뮬레이터를 켜지도 쓰지도 않았다 | — | — |

## 지적 표

| ID | 구분 | 사용자 영향·수용 조건 | 직접 근거·재현 조건 | 반증·한계 | 담당·다음 행동 |
|---|---|---|---|---|---|
| R1 | 확정 | 기기 시험 AndroidChecks가 settingsChecks의 58행에서 반드시 `FAIL AssertionError: 2판 내보내기는 키·체험·저장 위치를 빼고 현재 설정만 담는다`로 끝난다. 계획 Task 9 Step 4(공통 확인과 AndroidChecks)를 채울 수 없고, onStart가 첫 실패에서 끝나므로(AndroidChecks.java:259) 뒤의 draftFailureCheck·settingsFormatAndTrial과 이후 Task 11 기기 확인도 돌지 않는다. 또 이 확인은 원래 목적(API 키가 빠졌는지)도 보지 못한다. 격리된 설정에 키가 없고, 찾는 글자 `"key"`가 내 형식 항목의 칸 이름과 겹친다. | 36행에서 이름을 '새 형식'으로 바꾼 내 형식이 52행 저장과 54-55행 불러오기(Store.java:60)로 다시 저장된 상태에서, 57행 exportSettings(Store.java:31-34 → SettingsFile.java:18-19 → CustomFormat.java:55-58)가 `"sections":[{"key":"overview","title":"요약"}]`를 쓴다. 그래서 58행 `!exported.contains("\"key\"")`가 거짓이 된다. JVM에서 같은 바이트를 만들어 재현했다(`Task9-반례-기기시험키충돌.log`, 내보낸 파일 원문과 `expect 결과=false`). | 기기에서 직접 돌리지 못했다. 다만 내보내기 바이트는 java.*만 쓰는 SettingsFile·CustomFormat이 만들고 Store는 org.json으로 같은 내 형식을 넘길 뿐이라, 기기와 JVM의 결과가 다를 이유가 없다. 앞 단계(archiveChecks 등)가 기기에서 먼저 실패하면 58행에 닿지 않지만, 그것을 고치면 다시 여기서 멈춘다. | Codex. 58행을 정확한 조건으로 바꾼다. 예를 들면 격리된 설정에 합성 키(`prefs.edit().putString("key","sk-합성-설정내보내기")`)를 넣고, 내보낸 글에 그 값과 `apiKey`·`trial`·`"storage"`가 없는지, 최상위 칸이 정확히 format·version·summaryModel·defaultOutputFormat·customFormat 다섯 개인지 본다. 에뮬레이터가 풀리면 AndroidChecks를 돌려 통과 수를 보고한다. |
| U1 | 미확인 | 내 형식 null 삭제, 1·2 지점 중간 실패 때 모델·기본 형식·내 형식 바이트 복구, 없는 모델 건너뜀, storage 무시, saveSettings의 실제 기기 동작이다(설계 '내보내기와 불러오기'의 되돌리기 조건). | Store.java:45-86, AndroidChecks.java:29-63. 정적 추적으로는 58행 외에 기대대로 흐른다. | org.json·SharedPreferences.commit·AtomicFile 동작이 걸려 JVM으로 대신할 수 없다. | Codex. R1을 고친 뒤 AndroidChecks로 닫는다. |
| U2 | 미확인 | 실제 문서 선택 창(SAF)에서 고르기·취소, 128KiB를 넘는 파일 읽기 중단, 미리보기 뒤 확인까지의 흐름이다. | MainActivity.java:57-66·125-161. | 지금 화면에 버튼이 없어 사용자가 닿을 수 없다(Task 13). | Task 13 화면 연결 뒤 Task 17 실제 확인에서 본다. |
| S1 | 확정(선택) | 문서가 지운 파일과 옛 동작을 안내한다. README가 두 문서를 링크한다. | `desktop/소스안내.txt:10`(지운 `앱/프로젝트설정교환.cjs` 설명), `mobile/안드로이드/빌드안내.txt:28`(1판 프로젝트 설정 교환 설명), `:37`(지운 `tests/SettingsExchangeTest.java`를 JVM 시험으로 안내. 지금은 `SettingsFileTest.java`), `:45`(검증이 '프로젝트 03'에 기록을 만들고 설정을 되돌린다는 옛 설명. 지금은 testContext 격리). | 빌드 입력은 아니다. | 계획상 Task 15(문서 갱신, 주작성자). `빌드안내.txt`는 Codex 소유 폴더라 Task 14에서 함께 고칠지 주작성자가 정한다. |
| S2 | 확정(선택) | 사용자 주석 규칙(설명 주석은 대상 코드 바로 아래, 메서드는 본문 첫 줄 아래)과 다르다. | `SettingsFile.java:21`의 `// 옛 결과의 기본 형식을 읽을 때 쓴다…`가 22행 메서드 위에 있다. 다른 새 주석은 규칙대로다. | 동작과 무관하다. | Codex. 다음 수정 때 메서드 본문 첫 줄 아래로 옮긴다. |
| S3 | 추정(선택) | 엄격한 UTF-8 거절이 Windows와 같다는 것은 JVM 디코더로만 증명됐다. Android의 UTF-8 디코더가 CESU(ED A0 80)나 overlong(C0 AF)을 다르게 다루면 같은 파일이 기기에서만 받아들여질 수 있다. | SettingsFile.java:39(`StandardCharsets.UTF_8.newDecoder()` + REPORT), 반례 `cesuSurrogate`·`overlongSlash`·`aboveMaxCodePoint`·`truncatedAtEnd`. | 기기 구현이 같을 가능성이 높다고 보지만 확인하지 않았다. | Codex. SettingsFile은 java.*만 쓰므로 AndroidChecks에 `SettingsFile.read` 바이트 사례 서너 개(위 네 가지와 BOM 정상)를 넣으면 기기에서도 바로 닫힌다. |
| S4 | 확정(선택) | 되돌리기가 내 형식 파일을 건드리기 전에 실패한 경우(설정 commit 실패, 실패 주입 0·1)에도 원래 바이트를 다시 쓴다. 디스크가 가득 차 그 쓰기가 실패하면 파일은 그대로인데도 '되돌리지도 못했습니다'로 알린다. | Store.java:70(`before!=null`이면 항상 `writeBytes`). | AtomicFile 쓰기 실패는 원래 파일을 남기므로 자료는 안전하다. 안내 문구만 지나치게 나쁘다. | Codex 판단. 내 형식 파일을 바꿨는지 표시해 그때만 되돌린다. |
| S5 | 확정(선택) | 기기 시험 보강점이다. 43-44행(삭제 뒤 실패)은 내 형식 파일만 보고 모델·기본 형식 복구는 보지 않는다. 실패 주입 0 경로가 없다. applySettings의 token 확인·settingsIdle·응답 모양(MainActivity 브리지)은 기기 시험과 화면 시험(모의 응답) 어디에서도 실제로 거치지 않는다. | AndroidChecks.java:43-44, MainActivity.java:59-65, 화면검증-브라우저.cjs:8. | — | Codex. R1을 고칠 때 함께 더한다. |

## 반드시 고칠 것

1. **R1. 기기 시험 `AndroidChecks.java:58`이 반드시 실패한다.**
   - 재현. 기기에서는 AndroidChecks를 그대로 실행하면 settingsChecks 58행에서 `FAIL AssertionError: 2판 내보내기는 키·체험·저장 위치를 빼고 현재 설정만 담는다`로 끝난다(예상, 미실행). JVM 재현은 복제본에서 `javac -encoding UTF-8 -d <출력> mobile/안드로이드/src/kr/local/meetingjournal/{JsonText,CustomFormat,SettingsFile}.java 검토반례/KeyCollisionRepro.java` 뒤 `java -cp <출력> kr.local.meetingjournal.KeyCollisionRepro`를 돌리면 내보낸 파일에 `"key":"overview"`가 있고 `AndroidChecks 58행 expect 결과=false`가 나온다.
   - 기대 동작. 내보내기 확인은 API 키 값과 `apiKey`·체험 기록·저장 위치가 없는지, 최상위 칸이 2판 다섯 칸뿐인지를 정확히 본다. 내 형식 항목의 `key` 칸은 허용한다. 고친 뒤 settingsChecks가 끝까지 지나고 AndroidChecks가 이어서 draftFailureCheck·settingsFormatAndTrial 등 나머지 기기 확인까지 돌아 `PASS <수> native storage and recovery checks`로 끝나야 한다. 이 실행으로 U1도 함께 닫는다.

## 선택 개선

- **S1.** 문서의 옛 이름과 옛 동작 안내를 고친다(`desktop/소스안내.txt:10`, `mobile/안드로이드/빌드안내.txt:28·37·45`). Task 15 또는 Task 14에서 처리한다.
- **S2.** `SettingsFile.java:21` 주석을 메서드 본문 첫 줄 아래로 옮긴다.
- **S3.** AndroidChecks에 `SettingsFile.read`의 깨진 UTF-8·BOM 바이트 사례를 몇 개 넣어 기기 디코더에서도 Windows와 같은 판정인지 확인한다.
- **S4.** Store.java:70의 되돌리기를 내 형식 파일을 실제로 바꾼 경우로 좁혀 실패 안내를 정확하게 한다.
- **S5.** 삭제 뒤 실패 경로에서 모델·기본 형식 복구도 보고, 실패 주입 0 경로와 applySettings 브리지(token·settingsIdle·응답 모양)를 기기 시험에서 한 번 거친다.
- 참고. Android 미리보기의 `storage:null`과 `storageIgnored`는 Windows 미리보기와 다른 Android 전용 칸이다. Task 13 화면이 이 칸으로 '저장 위치는 Android에서 적용하지 않습니다'를 보여 주도록 원장에 남겨 두기를 권한다.

## 실행을 멈출 지적

- 없다. 사용자 자료·원격·배포에 닿는 위험은 찾지 못했다. 다만 에뮬레이터가 풀려 Task 9·11 기기 시험을 함께 돌리기 전에 R1을 먼저 고쳐야 한다. 그대로 돌리면 58행에서 전체 실행이 끝나 Task 11 확인까지 결과를 얻지 못한다.

## 미실행·미확인

- AndroidChecks(기기 시험). 지시에 따라 에뮬레이터를 켜지도 쓰지도 않았다. 짝도 아직 돌리지 않았다.
- 실제 문서 선택 창(SAF) 고르기·취소·기기 재시작, Android 기기 UTF-8 디코더 동작, 실제 마이크·OpenAI 호출은 확인하지 않았다.
- Windows 실제 창은 이 작업 범위가 아니다(Task 6·17).

## 재확인 기록

### 재확인 1회차(2026-10-23, 후보 9fdf7e6)

- **대상.** 후보 9fdf7e6f767846e0a164568e81810267041a187e(기준 463e900)다. Task 9 R1 수정은 `tests/AndroidChecks.java`에만 있다. 복제본과 로그는 `검토-Task10.md`의 같은 날 재확인과 같다(`C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\재확인-후보-9fdf7e6`, 로그 `재확인-Task9·10-*.log`). 짝 작업 폴더는 읽기만 했다.
- **판정.** 반드시 고칠 것 R1은 닫혔다. 이번에 emulator-5554에서 기기 시험을 직접 돌려, 후보는 settingsChecks를 지나 끝까지 `PASS 114`로 끝나고 고치기 전 463e900 원본은 같은 기기에서 예상대로 '2판 내보내기는 키·체험·저장 위치를 빼고 현재 설정만 담는다'에서 멈추는 것을 확인했다. 미확인 U1도 같은 실행으로 닫혔다. Task 9 범위에서 새로 찾은 반드시 고칠 것은 없다.

| ID | 반영 또는 반박 근거 | 새 후보 | 실패 조건 재시험 | 영향 범위 재확인 | 판정 |
|---|---|---|---|---|---|
| R1 | AndroidChecks.java:32-33이 격리된 설정에 합성 키를 넣고, :59-63이 내보낸 파일의 최상위 칸이 정확히 format·version·summaryModel·defaultOutputFormat·customFormat 다섯 개인지, 합성 키 값과 apiKey·trial 칸이 없는지, 등록된 시험용 키가 그대로인지 본다. 내 형식 항목의 `key` 칸은 허용한다. | 9fdf7e6 | 기기에서 후보 AndroidChecks 전체가 `PASS 114 native storage and recovery checks; real API calls=0`으로 끝났다(세 번 같음). 대조로 앞선 Task 9 검토의 463e900 검증용 APK(sha256 `e246b4b5…d3264f`)를 같은 에뮬레이터에서 돌리면 `FAIL java.lang.AssertionError: 2판 내보내기는 키·체험·저장 위치를 빼고 현재 설정만 담는다`로 멈춘다. | 같은 실행에서 settingsChecks 뒤의 draftFailureCheck, 저장·분할 요청 확인, settingsFormatAndTrial까지 모두 통과했다. 새 확인은 키가 내보내기에 섞이면 칸 수 비교와 값 검색 두 곳에서 잡는다. | 닫힘 |
| U1 | — | 9fdf7e6 | 후보 기기 실행에서 settingsChecks의 1·2 지점 중간 실패 복구, 내 형식 삭제 뒤 실패 복구, 없는 모델 건너뜀, 명시적 null 삭제, storage 무시, 옛 회의 파일 불변이 모두 통과했다. | — | 닫힘(기기 확인) |
| S3(선택) | AndroidChecks.java:64-66이 잘못된 UTF-8 다섯 가지(C3 28, C0 AF, ED A0 80, F0 9F 98, FF FE)를 기기 디코더가 Windows와 같은 문구로 거절하는지 본다. | 9fdf7e6 | 기기 통과. | 범위 밖 코드포인트(F4 90 80 80)와 BOM 한 개 정상 사례는 아직 없다. | 대부분 닫힘(선택) |
| S1·S2·S4·S5(선택) | 해당 줄은 이번 후보에서 바뀌지 않았다. S5의 '삭제 뒤 실패에서 모델·기본 형식 복구 확인'(지금 AndroidChecks.java:46)과 applySettings 브리지 시험도 그대로다. | 9fdf7e6 | — | — | 남음(선택) |

- **시험 숫자.** Node 19/19, JVM 단독 SettingsFile 19·TextChunks 18·TrialAccess 59·AiUsage 20·AiResponseModel 6(CustomFormat 유효·무효 2줄 기대대로), 검증용 빌드 종료 0(공용 기본 키 포함 아니요), 화면 37/37, AndroidChecks 114 PASS다. 짝 보고 숫자(AndroidChecks 114, Node 19, 화면 37)와 모두 같다. 명령과 로그는 `검토-Task10.md` 재확인 1회차의 '시험 결과' 표에 있고, 463e900 원본 대조는 `재확인-Task9·10-RED-AndroidChecks.log` 끝의 'Task 9 R1 기기 대조'다.
- **기기 자료.** 기기 시험은 testContext의 `task10-<UUID>` 폴더와 설정 파일에만 쓰고(AndroidChecks.java:186-193), 에뮬레이터 앱의 `files/회의자료`는 실행 전후로 같았다. 실제 휴대폰은 연결돼 있지 않았고 실제 OpenAI 호출은 0회다.
- **아직 확인하지 않은 것.** 실제 문서 선택 창(SAF) 고르기·취소와 화면의 불러오기·미리보기 흐름(U2, Task 13 뒤), 실제 마이크·OpenAI는 이번에도 확인하지 않았다.
