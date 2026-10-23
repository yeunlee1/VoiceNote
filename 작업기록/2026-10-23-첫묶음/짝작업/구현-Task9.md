# Task 9 구현 결과와 교차 검토 요청

현재 판정(후보9fdf7e6): Claude가 기기114·Node19·화면37 및 반례를 재확인해 Task9 R1을 닫았다(msg_cfb15aafe417). 아래 앞부분은 기기 시험 전 최초 후보 기록이며, 뒤의 보완 기록과 상대 검토-Task9.md 재확인 절이 최신 근거다.

- **기기 시험 전 검토 후보**다. Node·JVM·DebugBuild·모의 브리지 화면 확인을 마쳤고, AndroidChecks 실행은 Claude의 Task 10 검토 종료 통보까지 보류했다. 2026-10-23 05:55Z 조정자 지시에 따라 이 상태로 검토용 커밋을 먼저 만들며 Task 11도 정적 확인까지 이어 간다.
- 작업 폴더는 C:\workspace\VoiceNote\work-2026-10-23-안드로이드-프로젝트제거, 브랜치는 work/2026-10-23-안드로이드-프로젝트제거다. 6dee27d 병합은 01a8488이고, 추가 배열 반례 수정 4faa115를 65c8f86으로 받았다. **Task 9 구현 BASE는 65c8f864998b5cb74d341f4424921b787a75c411**이다.

## 확인

- JsonText.java로 공용 공백·인용·JSON 해석기를 분리했다. java.*만 사용한다. Windows JSON.parse와 같이 중복 키는 마지막 값을 쓰고, 정수 모양의 객체 키 순서까지 맞춰 오류에 표시하는 첫 키도 같다. 중첩 JSON은 반복 스택으로 처리한다.
- SettingsFile.java가 설정 2판을 엄격하게 검증한다. 크기·UTF-8·BOM·루트·버전·모델·기본 출력 형식·내 형식·storage를 Windows 설정파일.cjs와 같은 순서와 문구로 검사한다. Android 내보내기에는 storage를 넣지 않고, 불러올 때도 적용하지 않는다. storage 존재 여부만 hasStorage로 남겨 건너뜀을 알린다.
- CustomFormat.java와 JVM·Node 시험은 JsonText를 쓴다. SettingsExchange.java·SettingsExchangeTest.java를 제거했다. 설정호환.test.cjs가 새 Windows 설정파일.cjs를 쓰는 것을 확인한 뒤, 계약상 예외로 desktop/앱/프로젝트설정교환.cjs만 삭제했다.
- Store.java:27~의 설정 읽기·내보내기·미리보기·적용을 2판으로 바꿨다. 모르는 모델은 건너뛰고 알리며, 명시적인 customFormat:null은 현재 내 형식을 지운다. 중간 실패 시 요약 모델·기본 형식과 내 형식 원래 바이트를 함께 복원하는 기기 시험을 작성·컴파일했다. **실제 기기에서의 복원 판정은 아직 하지 않았다.**
- 기본 형식 저장 saveSettings를 추가했고 기본 custom이 없으면 새 회의는 meeting으로 시작한다. saved custom이 있으면 새 회의에 당시 정의를 보관한다. 과거 결과에 정의가 없는 custom 값이 남아 있을 때 회의록으로 대체하던 기존 동작도 유지했다.
- MainActivity.java는 export/import/apply/saveSettings를 2판으로 연결하고 내보내기 이름을 <오늘>-VoiceNote-설정.json으로 바꿨다. 적용 응답은 settings·connection·customFormat·skipped다. 미리보기는 token·file·preview(요약 모델/기본 형식/내 형식, storage:null, storageIgnored)를 준다. 앱 키·체험 기록·회의 파일은 교환 대상에서 제외했다.
- app.js의 공통 응답 처리가 applySettings/saveSettings의 2판 객체를 받아 모델·설정·내 형식을 갱신하며 null도 반영한다. 실제 가져오기 버튼과 새 설정 창은 Task 13 대상이다.

## TDD와 시험

기준 산출물은 자기 작업 폴더의 산출물/2026-10-23-Task9-검증이다.

| 확인 | 결과 | 근거 |
|---|---|---|
| 새 해석기와 값 객체 부재 | Node/JVM 컴파일 실패를 먼저 확인 | RED-설정호환.log |
| 옛 Store 설정 API | 새 값 객체·saveSettings API 부재로 DebugBuild 실패 | RED-저장-컴파일.log |
| 2판 적용·null 응답 | 화면 갱신 2건 실패 후 통과 | RED-화면.log → GREEN-화면.log |
| 옛 내 형식 보정 | 정의 없는 custom 보정 시험 실패 후 통과 | RED-옛형식.log → 최종-Node.log |
| Android Node 전체 | 19/19, 실패·건너뜀 0, 종료 0 | 최종-Node.log |
| Windows↔Android 호환 | 63사례의 값·거절 문구까지 일치 | GREEN-설정호환.log·최종-Node.log |
| JVM | SettingsFile 19, TextChunks 18, TrialAccess 59, AiUsage 20, AiResponseModel 6 통과. CustomFormat도 Node 호환 시험에서 JVM으로 실행 | JVM-144522 로그, 변경된 SettingsFile은 최종 Node에서 재실행 |
| DebugBuild | 제품 Java·AndroidChecks 컴파일·검증 APK 생성 종료 0, 공용 기본 키 포함: 아니요 | 최종-컴파일.log·작성-Codex-145252/VoiceNote-android-test.apk |
| 모의 브리지 화면 | 32/32, 헤드리스 Chrome. 실제 저장 API 대신 모의 응답으로 화면 연결 확인 | GREEN-화면.log·화면/브라우저검증결과.txt |
| 패치 | git diff --check 통과 | 기존 줄 끝 변환 안내만 남음 |

- 기기 시험에는 설정 일부 저장 뒤 실패, 내 형식 삭제 뒤 실패, 원래 모델·기본 형식·내 형식 바이트 복원, 알 수 없는 모델 건너뜀, null 삭제, 저장 위치 무시, 회의 파일 불변을 넣었다. 아직 실행하지 않았으므로 통과 수는 적지 않는다.
- 화면 시험은 시험 서버에서만 call을 노출해 가져오기 응답을 넣는다. 제품에는 시험용 전역 변수를 넣지 않는다. 2판 적용과 삭제 상태의 최신 캡처 모바일-390-2판-모델적용.png·모바일-390-2판-형식삭제.png를 직접 열었다. 기존 360·390·412 폭과 핵심 동선도 같은 시험에서 통과했다.

## 판단

- Ruling: Windows JSON.parse가 중복 키 마지막 값을 받으므로 새 공용 해석기도 그 규칙으로 맞췄다. 예전 해석기의 중복 키 거절을 유지하면 새 교환 계약이 갈라진다. 깊이 제한은 호출 스택 대신 명시적인 스택으로 처리했다.
- Ruling: 새 설정의 네 기본 형식 검사와 옛 결과의 정의 없는 custom 보정을 구분했다. SettingsFile.outputFormat은 과거 결과의 기본 형식 보정용이고, defaultOutputFormat 저장·검증은 네 값을 모두 받는다.
- Ruling: 조정자 메시지에 따라 기기 시험 전 커밋을 먼저 넘긴다. Task 9 전체 통과나 교차 승인으로 표시하지 않는다. 에뮬레이터가 풀리면 Task 9·11 기기 시험을 함께 돌린다.

## 추정·미확인

- AndroidChecks 실행, 실제 SAF 파일 선택·취소·기기 재시작, 실제 마이크·OpenAI는 미확인이다. 에뮬레이터는 이번 Dispatch에서 켜거나 사용하지 않았다.
- Claude Task 10 지적과 Task 3 수정본 재확인을 이어 처리한다. Task 9 후보 자체의 독립 검토도 Claude가 수행한다.

## 검토 후보 커밋

- 65c8f864998b5cb74d341f4424921b787a75c411..463e90064a3d30b667c68f0ece21cd1d5f5714b0.
- 제목 feat: 안드로이드 설정 파일 2판과 공용 JSON 해석기 분리. 추적 파일 15개 변경, 커밋 뒤 작업 트리 깨끗함. **기기 시험 전 검토 후보**이며 전체 완료 표시가 아니다.

## Dispatch B 기기 확인과 보완

- Task 10 R1~R5와 선택 R6, Task 9 R1을 합쳐 보완했다. 비교 BASE는 463e900이다. 아직 Claude 재확인 전이므로 교차 검토 완료 표시는 하지 않는다.
- R1: preserveLegacy는 location이 없는 옛 메타데이터만 대상으로 삼고, finish 마지막 저장은 보존을 다시 호출하지 않는다. 새 회의 첫 결과 1개·두 번째 2개, 요약 없던 옛 회의 첫 결과 1개를 기기에서 확인했다.
- R2·R3: 브리지 nullableString이 빠진 칸·JSON null을 Java null로 읽는다. open/share/copy/review에 적용했고 화면도 결과가 없으면 resultId 칸을 보내지 않는다. 실제 기기의 optString(null)이 글자 null을 만드는 것을 먼저 확인했다. 빈 평가는 거절되고 별점만 있으면 빈 의견으로 최신 결과에 저장된다.
- R4: 손상된 기본 초안은 작성중-읽기실패-시각-UUID.json에 원문을 보존하고 빈 메모로 이어 간다. 이관 쓰기 실패는 다음에 다시 시도하며, 화면은 draft 오류가 나도 목록·상태 조회를 계속한다. begin은 초안 이관을 회의 생성 전에 확인해 이 단계 실패가 빈 회의 기록을 남기지 않게 한다.
- R5: 긴 자리표시자를 짧은 선택 안내와 title-hint 줄로 바꿨다. 360·390·412px에서 안내 문구가 끝까지 보이는 것을 측정하고 새 캡처 세 장을 직접 열었다. workflow의 단어 중간 줄바꿈도 줄였다.
- R6: finish는 의견 길이를 먼저 검사하고 기록 사본을 쓴 뒤에만 호출자 객체를 갱신한다. 긴 의견·실제 파일 쓰기 실패 뒤에도 이전 결과 id와 열기가 유지된다.
- Task 9 R1: 초기 기기 시험의 문자열 전체 key 제외 검사가 내 형식 항목 key까지 잡는 잘못된 예상값임을 직접 재현했다. 격리 환경설정에 합성 키를 넣고 최상위 다섯 칸·실제 키 값 제외·등록 키 불변을 확인하도록 고쳤다. 잘못된 UTF-8 바이트 다섯 종류도 실제 Android 디코더에서 거절했다.

시험 근거는 자기 산출물/2026-10-23-Task10-보완이다. RED-first/open/review/draft/finish.log에서 각각 실패를 먼저 확인했고, 고친 뒤 개별 회귀와 전체 AndroidChecks **114건 PASS(실제 API 0회)**를 확인했다. 전체 로그 GREEN-AndroidChecks.log, 컴파일 GREEN-컴파일.log, 최신 빌드 GREEN-Codex-152455/VoiceNote-android-test.apk다. Node 19/19(GREEN-Node.log), 화면 37/37(GREEN-화면.log), git diff --check도 통과했다. JVM 대상 클래스는 Task 9 검증 뒤 바뀌지 않아 그 근거를 재사용했다. 기기는 Dispatch A에서 내가 켠 VoiceNotePhone/emulator-5554이며, 이번 시험을 마친 뒤 Claude 재확인용으로 비워 둔다.

선택 R7의 공유 ZIP 합성 시험과 R8의 나머지 주석·문구 정리는 이번 보완에 포함하지 않았다. 실제 공유 앱·마이크·SAF·실제 OpenAI는 여전히 미확인이다.

- Dispatch B 보완 끝 커밋은 **463e900..9fdf7e6f767846e0a164568e81810267041a187e**다. 소스·시험 7파일을 커밋했고 작업 트리는 깨끗하다. 기기 114건·화면 37건 통과 후보로 Claude 재확인을 요청했다.
