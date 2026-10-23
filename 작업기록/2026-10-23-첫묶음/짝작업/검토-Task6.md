# Task 6 교차 검토

후보 e93550b(BASE eb30f3b)를 별도 clone --no-hardlinks로 받아 확인했다. 반드시 고칠 것 2건이 남아 있다.

## 반드시 고칠 것

1. **불러오기 응답 순서가 바뀌면 마지막에 고른 파일 대신 먼저 고른 파일을 적용한다.** desktop/앱/화면/app.js:1925-1944의 previewSettings는 처리 중 잠금이나 요청 순서 검사가 없다. 첫 파일 A(핵심 요약)의 응답을 늦춘 채 B(업무 정리)를 선택하면 B 미리보기가 먼저 나온 뒤 A로 바뀌고, 확인하면 A의 summary가 저장된다. 파일 읽기 시작부터 잠그거나 요청 세대를 검사해 이전 응답이 미리보기와 pendingSettings를 덮지 못하게 해야 한다.
2. **BOM 두 개가 붙은 파일을 UI만 받아들인다.** app.js:1936의 TextDecoder가 BOM 하나를 숨겨 제거하고, 설정파일.cjs의 문자열 파서가 하나를 더 제거한다. 같은 바이트를 parseSettingsFile에 직접 주면 거절되지만 화면에서는 미리보기가 열린다. TextDecoder에서 BOM을 보존하고 파서가 한 번만 처리하도록 맞춰야 한다(Android와 동일한 파일 판정).

두 반례는 실제 서버와 headless Chromium에서 합성 파일로 재현했다. 모델은 목록에 없는 합성 이름을 써 적용하지 않았고 실제 API는 호출되지 않도록 차단했다.

## 확인

- desktop 전체 Node 188/188 통과. 로그: 자체 산출물/2026-10-23-첫묶음-검토/Task6-desktop.log.
- 제공된 화면 재현 스크립트를 검토 clone에서 직접 실행. 1280·960·390 폭에서 페이지/대화상자 넘침과 console/page 오류 없음. 제목 초점, 폴더 선택 요청, 미리보기 건너뜀 사유 확인.
- 390 미리보기와 1280 출력 형식 캡처를 직접 열어 배치와 줄바꿈 확인.
- 독립 반례 스크립트: C:/workspace/VoiceNote/work-2026-10-23-안드로이드-프로젝트제거/산출물/2026-10-23-첫묶음-검토/Task6-독립반례.cjs
- 결과: 같은 폴더 Task6-독립결과.json. doubleBomPreview=true, importEnabledWhileWaiting=true, B 미리보기 뒤 A로 바뀌어 applied=summary.

## 선택·미확인

Windows 실제 창의 폴더 선택 메시지 처리는 Task 8 범위이므로 여기서는 JS 통로만 확인했다. 실제 OpenAI·사용자 자료·원격 저장소는 사용하지 않았다.

## 수정본 재확인

- d1840425a2f8d7a663938b40ed2b78e4dbd10e8c에서 같은 독립 반례를 다시 실행했다. 이중 BOM의 미리보기는 열리지 않았고, A의 응답이 늦어도 B 미리보기·pendingSettings가 유지돼 tasks를 적용했다(Task6-수정결과.json).
- 영향받는 설정 화면·실제 브라우저 왕복 시험 18/18 통과(Task6-재확인.log). 앞서 본 세 폭 화면 근거는 재사용했다.
- R1·R2 모두 닫힘. 현재까지 추가 필수 지적 없음. Windows 실제 창 검증은 여전히 Task 8·17 범위다.
