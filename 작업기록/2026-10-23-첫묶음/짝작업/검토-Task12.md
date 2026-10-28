# Task 12 교차 검토

- **검토 대상.** 후보 1587f5dada1ace134b44c39a90954c9ff8ad1e27(브랜치 work/2026-10-23-안드로이드-프로젝트제거, 제목 `feat: 안드로이드 요약본 Markdown 변환과 고른 폴더 사본 저장`), 비교 기준 44b2ab8d33fb9eab48efc8c01084932f1f5703a4, 작성자 보고 `C:\Users\user\AppData\Local\짝작업\VoiceNote\2026-10-23-첫묶음구현\구현-Task12.md`. 바뀐 파일은 제품 6개(Ai·MainActivity·Store 수정, Copies·MeetingDocument 새로, 빌드.ps1 한 줄)와 시험 2개(AndroidChecks 수정, CopyFilesTest 새로)다. 검토 복제본은 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task12`이다(`git clone --no-hardlinks` 뒤 checkout, 추적 파일 변경 0). 짝 작업 폴더는 읽기만 했다. 공유 Task Master에서는 5.5(Android)·9.1(저장 위치)에 해당하며 목록은 고치지 않았다.
- **판정. 반드시 고칠 것 1건(M1). M1을 닫으면 통과.**
  - 회의 문서 변환은 공통 예시 8건의 text·Markdown 16개가 기기 출력, Windows `회의문서.cjs` 출력, 예시 파일 세 쪽 모두 글자까지 같았다. 예시 밖의 경계 10건에서는 차수가 없거나 0인 기록의 text만 다르다(Android "0차", Windows "1차"). Android 기록은 처음부터 차수를 1 이상으로 저장하므로 실제 자료에서는 생기지 않는다(S1, 선택).
  - 사본 규칙은 Windows `사본저장.cjs`와 같다. 사본 기록으로 이미 쓴 것을 판별하고, .md만 성공했으면 .txt만 다시 쓰고, 폴더를 바꾸면 새 폴더 기준으로 쓰되 옛 사본은 지우지 않는다. 같은 이름의 남의 파일은 덮지 않고 `(2)`·`(3)`을 붙이고, 쓰다 실패한 반쪽 파일만 지우며, 원음은 회의 폴더 기록의 순번으로 한 번만 쓴다. 같은 폴더 권한은 마지막 사용처가 비워질 때 한 번만 놓는다. 검토 probe 12단계와 권한 5단계로 기기에서 확인했다.
  - 사본이 실패해도 결과 저장은 성공으로 남는다. 실패 이유는 사본 기록과 응답(`copies.failed`, 다시 열 때의 상태)에 남는다. 그러나 상태 줄 문구에는 이유와 실패한 종류가 없어 정해진 문구와 다르다(M1).
  - 파일 이름은 날짜-차수-제목-결과번호 구조와 금지 문자 치환·끝 점과 공백 제거가 Windows `artifactPrefix`와 같다. Android만 제목을 80자와 함께 UTF-8 120바이트에서도 자르고, 빈 제목을 "회의"로 쓴다. 한글 제목은 40자에서 잘린다. 255바이트 파일 이름 한도 때문에 필요한 차이로 보며, 설계 문서에 적어 두기를 권한다(S5).
  - 짝이 더한 시험은 위양성이 아니다. 고치기 전 코드(44b2ab8)에서는 컴파일부터 실패하고, 결함을 하나씩 넣은 변이 13종을 모두 잡았다. 시험 숫자는 짝 보고와 같다(Node 19/19, JVM 8종, 검증용 빌드 성공, AndroidChecks 187 PASS).
- **범위.** 변경 8파일 diff 전체와 Copies·MeetingDocument·Ai·MeetingService·Store·MainActivity 현재 전문을 설계('고른 폴더에 사본 저장'의 설정 값·폴더 고르기 Android·언제·무엇을·어떤 이름으로·사본 기록·실패와 다시 저장, '결과 모델', '오류와 경계 상황')와 계획(Task 12, '실행 방식과 교차 검증', '집중 검토 대상' 2~4)에 대조했다. Windows 쪽은 `C:\DEV\VoiceNote`(HEAD 134971b)의 `desktop/앱/사본저장.cjs`, `회의문서.cjs`, `출력형식.js`의 customText, `회의보관.cjs`의 artifactPrefix·resultFiles, `화면/app.js`의 copyMessage를 읽기만 했다. 회의문서.cjs는 후보 복제본 판과 같은 내용이다(마지막 변경 4b57ede). 직접 실행한 것은 Node, JVM 8종, 검증용 빌드 12회(후보 1, 검토 probe 1, 변이 10), emulator-5554의 AndroidChecks 13회, 문서·이름 대조 도구, 고치기 전 javac 대조다. 짝의 시험 결과를 그대로 재사용한 것은 없다.

## 요청받은 여섯 가지 확인

- **(1) 회의 문서 text·Markdown. 공통 예시 8건은 글자까지 같다.**
  - 방법. 검토 probe가 기기에서 `MeetingDocument.text`·`markdown`을 공통 예시 8건과 경계 10건에 돌려 기록과 출력을 JSON으로 꺼냈고, `Task12-검토도구\문서대조.cjs`가 같은 기록을 Windows `회의문서.cjs`의 `plainText`·`markdown`에 넣어 비교했다(`Task12-문서대조.log`). 예시 건은 예시 파일의 기대값과도 비교했다.
  - 결과. 예시 8건(회의록, 회의록 옛 프로젝트, 핵심 요약, 업무 정리, 내 형식, 빈 회의록·핵심 요약·업무 정리)의 16개 출력이 세 쪽 모두 같다. 경계 10건(차수 없음, 차수 0, 내 형식 정의 없음, 담당 빈 글자, 참석자 null, 프로젝트가 있는 핵심 요약·업무 정리, 내 형식 모두 빈 값, 점 없는 주제, `/`·따옴표·이모지·탭·`\r\n`·U+2028이 든 제목과 본문)의 20개 출력 중 18개가 같다. 다른 2개는 차수가 없거나 0인 기록의 text 머리글이다(S1). Markdown은 두 경우 모두 "1차"로 같다.
  - 코드. MeetingDocument.java:40-80의 text와 도우미는 44b2ab8 Store.format 본문과 이름만 바꾼 그대로임을 기계적으로 비교해 확인했다. 그래서 회의록.txt·공유·복사 글은 바뀌지 않는다. markdown(:16-38)은 Windows 회의문서.cjs:4-22와 내 형식 부분은 출력형식.js:88-95(customText)와 줄 순서가 같다.
- **(2) 사본 규칙. Windows와 같다.**
  - 이미 쓴 것 판별. Copies.java:109-115는 지금 폴더(tree URI)와 같은 폴더의 성공 기록이 있고 그 문서가 아직 열릴 때만 건너뛴다. Windows 사본저장.cjs:85와 같은 규칙이다(Windows는 이름, Android는 문서 주소로 확인). probe 2단계에서 다섯 개 모두 "이미 이 폴더에 저장했습니다."로 건너뛰었고, 3단계에서 원음 2번 사본만 지우자 그 순번만 다시 썼다.
  - .md 성공·.txt 실패. probe 4단계에서 txt를 쓰는 도중 실패시키자 md만 쓰고 txt는 실패로 남았으며 폴더에는 md 하나만 있었다. 사본 기록의 txt 항목은 `ok:false`와 이유를 가진다. 6단계 다시 저장에서 txt만 썼다. 짝 시험 `다시 저장하면 txt만 쓰고 다른 사본은 중복하지 않는다`도 같다.
  - 폴더 변경. 같은 종류의 다른 폴더 기록은 남기고 같은 폴더 기록만 바꾼다(Copies.java:117, Windows :87과 같음). probe 4·7단계에서 요약 폴더를 '나'로 바꿨다가 '가'로 되돌리자 '가'의 기존 사본은 다시 쓰지 않고 '나'의 사본도 지우지 않았다.
  - 같은 이름의 남의 파일. FileSink는 `CREATE_NEW`로 겹치면 다음 번호를 쓰고(Copies.java:67), TreeSink는 폴더 이름 목록을 본 뒤 비어 있는 번호로 만든다(:78-80·86-87). probe 1단계에서 남의 `…-요약.md`와 `…-요약 (2).md`가 있을 때 `…-요약 (3).md`로 썼고 남의 두 파일 내용은 그대로였다. 사본 내용은 변환기 결과와 같았다.
  - 반쪽 파일. FileSink는 자기가 만든 파일만 지우고(:68-69), TreeSink는 자기가 만든 문서만 지운다(:88-90). JVM 시험과 probe 4단계에서 반쪽 파일이 남지 않았다. TreeSink의 실제 삭제는 실행하지 못했다(아래 '실행하지 못한 것').
  - 원음. 회의 폴더의 `사본기록-원음.json`에 순번으로 기록한다(:128-131). probe 8단계에서 다시 분석해 제목이 바뀐 새 결과는 전사·요약 세 개만 새로 쓰고 원음 둘은 건너뛰었다.
  - 권한 공유. Copies.java:31-42는 새 폴더 권한을 먼저 받고, 설정 저장 뒤 옛 폴더를 다른 종류가 더 쓰지 않을 때만 놓는다. 저장 실패면 되돌리고 새로 받은 권한만 놓는다. probe 권한 단계에서 세 종류가 같은 폴더를 쓰다 하나를 다른 폴더로 바꾸거나 같은 폴더를 다시 골라도 놓지 않았고, 마지막 사용처를 비울 때 한 번만 놓았다. 권한 받기가 실패하면 저장 위치를 바꾸지 않았다. 실제 SAF 권한 유지·회수는 Task 17 범위다.
  - 세 종류 같은 폴더. probe 1단계에서 한 폴더에 전사·요약 둘·원음 둘이 겹치지 않는 이름으로 들어갔다.
- **(3) 실패와 상태. 결과 저장은 성공으로 남지만 상태 줄 문구가 다르다(M1).**
  - 결과 저장. Ai.java:70-75·105는 결과 저장(finish)과 체험 기록 뒤에 사본을 쓰고, :107-113이 사본 쪽 예외를 모두 받아 실패 보고로 바꾼다. 검토 probe `rvAi`에서 권한 없는 실제 문서 트리(`content://com.android.externalstorage.documents/tree/primary%3ADocuments`)를 요약 폴더로 두고 분석과 의견 반영을 모의 응답으로 돌렸다. 두 경우 모두 결과는 complete였고, 회의정보.json과 결과 파일에는 사본 보고가 섞이지 않았다. 변이 M7(사본 실패를 분석 실패로)과 M8(분석 뒤 사본 안 씀)을 짝 시험이 잡았다.
  - 실패 이유. 사본 기록 항목의 `message`, 응답의 `copies.failed[].message`, 다시 열 때 `open`의 `copies` 상태에 "고른 폴더에 쓸 권한이 없습니다. 폴더를 다시 골라 주세요."처럼 종류별 이유가 남는다(`task12-review-ai.json`, probe 5·11단계).
  - 상태 줄. 같은 실행에서 상태 문구는 "회의록 저장 완료 · 고른 폴더에 저장하지 못했습니다. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요."였다. 이유와 실패한 종류가 없다(M1).
  - 다시 열 때의 경로. MainActivity.java:113-119의 `open`이 연 결과의 resultId로 `Copies.status`(Copies.java:136-149)를 부른다. 지금 설정된 폴더 기준으로 기록이 있고 문서가 열리면 written, 실패 기록은 그 이유로 failed, 저장했던 문서가 사라졌으면 "저장했던 사본을 열 수 없습니다. 폴더를 확인한 뒤 다시 저장하세요."로 failed, 폴더를 고르지 않은 종류는 skipped다(probe 5·9·10·11b단계). 이 폴더에 아직 한 번도 쓰지 않은 종류는 아무 항목도 돌려주지 않는다(S2).
- **(4) 파일 이름. 구조와 치환은 같고 Android만 바이트 상한이 더 있다.**
  - 구조. Copies.java:100-103은 `<날짜>-<NN>차-<제목>-<결과id>`(원음은 `<회의 id 앞 8자>-원음-NN.m4a`)이고 Windows 회의보관.cjs:55-58은 `<날짜>-<NN>차-<제목>-<결과id 앞 8자>`다. 결과 id 길이 차이는 설계가 정한 것이다.
  - 제목. 같은 17개 제목을 후보 `Copies.safeTitle`(JVM)과 Windows artifactPrefix의 safe 식에 넣어 비교했다(`Task12-이름대조.log`). 금지 문자 `<>:"/\|?*`, 줄바꿈·탭·`\r`, 끝 점과 공백, U+2028·DEL, 이모지 경계, 앞 공백, 영문 300자(80자), 한글 40자는 같았다. 다른 것은 한글 41자 이상(Windows 80자까지, Android 40자), 이모지 31개 이상(Android 30개), 한글 39자+이모지(Android 39자)처럼 120바이트를 넘는 경우와, 빈 제목·점만 있는 제목(Windows 빈칸, Android "회의")이다. 한글 80자면 Android 이름이 약 287바이트가 되어 255바이트 한도를 넘으므로 상한 자체는 필요하다고 본다(S5).
  - 날짜. Android는 `YYYY-MM-DD`가 아니면 "날짜미입력"을 쓰고 Windows는 날짜 글자를 치환해 쓴다. Android 새 기록은 만들 때 이 형식을 검사하므로 실제로는 차이가 없다.
- **(5) 위양성. 아니다.**
  - 고치기 전 코드. 후보의 AndroidChecks.java와 CopyFilesTest.java를 44b2ab8 제품 소스와 함께 javac하면 `Copies`·`MeetingDocument`가 없어 각각 21개·6개 오류로 실패한다(`Task12-RED-JVM.log`). 새 클래스를 시험하는 것이라 이 RED는 형식적이다.
  - 변이. 그래서 후보에 결함을 하나씩 넣었다(`Task12-변이.log`, 복제본 원상 복구 확인). 기기 10종과 JVM 3종 모두 기대한 확인에서 실패했다. M2 문서가 있는지 보지 않고 건너뜀 → `성공했던 문서가 지워지면 그 문서만 다시 쓴다`, M3 폴더 구분 없음 → `폴더를 바꾸면 새 요약 두 파일만 쓰고 옛 사본을 남긴다`, M4 다른 폴더 기록 버림 → `종류별·폴더별 사본 기록을 함께 남긴다`, M5 원음을 제목 포함 이름으로 판별 → `다시 분석해 제목이 달라도 원음은 한 번만 복사한다`, M6 권한을 무조건 놓음 → `다른 종류가 같은 폴더를 쓰면 권한을 놓지 않는다`, M7·M8 → 사본 실패 보존 시험, M9 Markdown 목록 끝 빈 줄 없음 → `공통 Markdown 예시 일치: 핵심 요약`, M10 업무 정리 담당 미정 빠짐 → 기존 문서 시험, M13 제목 바이트 상한 없음 → 긴 제목 사본 시험(기기)과 `긴 제목도 파일 시스템 길이 안에 든다`(JVM), M11 반쪽 파일 남김 → `중간 실패 뒤 반쪽 파일과 임시 파일이 없다`, M12 같은 이름 덮어씀 → `같은 이름이면 (2)를 붙인다`. 덮어쓰기·반쪽 파일 정리는 JVM 시험만 잡고 기기 시험은 잡지 않는다. 둘 다 같은 FileSink 코드라 문제는 아니다.
  - 참고. 실패 기록은 문서 주소가 빈 값이라 `ok` 검사를 빼도 결과가 같다. 그래서 그 변이는 같은 동작이라 넣지 않았다.
- **(6) 숫자 비교. 같다.** 아래 '시험 결과' 표.

## 지적 표

| ID | 구분 | 사용자 영향·수용 조건 | 직접 근거·재현 조건 | 반증·한계 | 담당·다음 행동 |
|---|---|---|---|---|---|
| M1 | 반드시 고칠 것(정해진 문구 미충족) | 분석이나 의견 반영 뒤 사본이 실패하면 Android 상태 줄에 "회의록 저장 완료 · 고른 폴더에 저장하지 못했습니다. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요."만 보인다. 무엇이 왜 실패했는지(예: 요약본 권한이 끊겨 폴더를 다시 골라야 함) 알 수 없다. 설계 '실패와 다시 저장'은 "고른 폴더에 저장하지 못했습니다: <이유>. …"와 "일부만 실패하면 실패한 종류만 알린다"를 정했고, 계획 공통 제약은 이 문구를 그대로 쓰라고 했다. Windows는 상태 알림과 결과 창 모두 이유가 든 문구를 쓴다. | Ai.java:112가 이유 없는 고정 꼬리를 붙인다. 지금 화면은 이 값을 상태 줄에 그대로 쓴다(assets/app.js:223·230 `$('workflow').textContent = meeting.message`). 재현은 검토 probe `rvAi`. 요약 폴더를 권한 없는 실제 문서 트리로 두고 모의 응답으로 Ai.run·Ai.refine을 실행하면 state complete, `copies.failed`는 summaryMd·summaryTxt "고른 폴더에 쓸 권한이 없습니다. 폴더를 다시 골라 주세요.", message는 위 문구다(`Task12-검토probe-결과\task12-review-ai.json`). Windows 기준은 desktop/앱/화면/app.js:1829-1837 copyMessage와 평가흐름.test.cjs:200. | 이유 자체는 사본 기록과 `copies` 응답에 남는다. 짝의 Task 13 중간 커밋 fe9613d를 참고로 보니 결과 화면은 종류별 줄(`<라벨> · <이유>`)을 그리지만 상태 줄은 여전히 `meeting.message`를 쓴다(fe9613d app.js:327·334). 그 커밋은 이 판정에 넣지 않았다. | Codex. Task 12를 끝내기 전에 둘 중 하나로 닫는다. (가) Ai.copyResult가 `copies.failed`로 Windows copyMessage와 같은 규칙의 문구를 만든다. 종류 이름은 전사문·요약본(.md)·요약본(.txt)·원음·사본, 이유 끝 마침표는 빼고 같은 항목은 한 번만, 쉼표로 잇는다. (나) Ai는 고정 꼬리를 붙이지 않고 Task 13 화면이 `meeting.copies`로 같은 문구를 만든다고 주작성자와 정한다. 어느 쪽이든 기기 시험에 문구를 확인하는 한 줄을 더한다. |
| S1 | 확정(선택, 실제 자료에서는 안 생김) | 차수가 없거나 0인 기록이면 Android text는 "0차 회의", Windows plainText와 Android Markdown은 "1차 회의"다. | MeetingDocument.java:42 `optInt("dailySequence")`(기본 0), :18은 0을 1로 바꾼다. Windows 회의문서.cjs:31 `dailySequence \|\| 1`. `Task12-문서대조.log`의 '경계:차수 없음 회의록'·'경계:차수 0 핵심 요약'. | Android Store.create는 처음 공개 커밋부터 차수를 1 이상으로 저장한다. 옛 Store.format도 같은 식이었다. | Codex 판단. 맞추려면 :42를 :18처럼 `optInt("dailySequence",1)`, 0이면 1로 바꾼다. 회의록.txt에도 같은 효과다. |
| S2 | 확정(선택, Task 13 연결) | 결과를 다시 열 때 지금 폴더에 아직 쓰지 않은 종류는 상태에 아무것도 없고 `ok:true`다. 저장 위치를 분석 뒤에 골랐거나 폴더를 바꾼 경우다. 화면이 Windows copyMessage처럼 빈 written을 "고른 폴더에 새로 저장할 사본이 없습니다."로 보여 주면 사실과 다르다. | Copies.java:136-142는 맞는 기록이 없으면 그냥 돌아간다. Windows는 다시 열 때 사본 상태를 보여 주지 않는다(app.js:1725 `state.copies = null`). | fe9613d 화면은 written·failed 줄만 그려 지금은 잘못된 문구가 나오지 않는다. | Codex(Task 13과 함께). 상태에 `pending: [{ kind }]`처럼 아직 쓰지 않은 종류를 따로 주거나, 화면이 이 경우를 "아직 이 폴더에 저장하지 않았습니다"로 구분한다. |
| S3 | 추정(선택, 실제 공급자 미확인) | 문서가 있는지 확인할 때 파일을 연다. 클라우드 저장소 앱을 고르면 결과를 다시 열거나 다시 저장할 때마다 원음까지 내려받을 수 있다. | Copies.java:92 `openFileDescriptor(uri,"r")`, 사용처 :112(다시 저장)·:139(다시 열기 상태). | 기본 저장소(ExternalStorageProvider)는 로컬이라 빠르다. 클라우드 공급자 동작은 확인하지 않았다. | Codex 판단. 문서 메타데이터 조회(`DocumentsContract.Document.COLUMN_DOCUMENT_ID` 등)로 있는지만 확인한다. Task 17에서 실제 공급자로 시간을 본다. |
| S4 | 확정(선택, 문구 정확도) | 몇몇 실패에서 이유가 실제와 다르거나 뭉뚱그려진다. 앱 안의 `전사.txt`나 원음이 없으면 "고른 폴더나 파일을 찾을 수 없습니다."(Windows는 "앱에 보관된 원음 파일을 읽지 못했습니다."). 지워진 폴더(목록 조회가 null)와 트리가 아닌 주소는 "파일을 쓰지 못했습니다."로만 나온다. 쓰기 실패 뒤 스트림 닫기도 실패하면 만들던 파일을 지웠는데도 "만들던 파일도 지우지 못했습니다."가 나온다. | Copies.java:94-99 error(), :80(목록 null), :77(트리 아님), FileSink :68·TreeSink :89의 try-with-resources가 닫기 예외를 suppressed로 붙인다. | 결과 저장과 다시 저장 동작은 맞다. 문구만의 문제다. | Codex 판단. 앱 안 원본 읽기 실패를 따로 구분하고, 정리 실패 표시는 정리 단계의 예외에만 쓴다. |
| S5 | 확정(선택, 문서) | Android 이름은 제목을 80자와 120바이트 중 먼저 닿는 곳에서 자르고 빈 제목을 "회의"로 쓴다. 설계는 Windows 기준 "80자"만 적고 있어 두 앱의 이름이 긴 한글 제목에서 다른 이유가 문서에 없다. | Copies.java:50-56, `Task12-이름대조.log`. 작성자 판단 기록에는 적혀 있다(구현-Task12.md '판단 기록'). | 255바이트 한도 때문에 필요한 차이다. | Claude(설계 문서 담당). 설계 '언제, 무엇을, 어떤 이름으로'에 Android 바이트 상한을 한 줄 더한다. |
| N-a | 참고(Windows와 같은 한계) | 사본 기록 파일이 손상되면 기록이 없는 것으로 보고 다시 써서 `(2)` 이름의 중복 사본이 생긴다. 사본 기록 쓰기만 실패해도 다음 저장에서 같은 일이 생긴다. | probe 12단계, Copies.java:104·118. Windows 사본저장.cjs:23-28도 같다. | 남의 파일을 덮지는 않는다. | 기록만 한다. |
| N-b | 참고(추정, Task 17 확인) | 설계 '아직 모르는 것'의 `.md` 이름 변경 위험. 기기 MimeTypeMap은 md→text/markdown, text/markdown→md, txt↔text/plain, m4a→audio/mpeg, audio/mp4→m4a다. AOSP FileUtils.splitFileName은 `Objects.equals(mimeType, mimeTypeFromExt) \|\| Objects.equals(ext, extFromMimeType)`이면 확장자를 그대로 둔다. 그래서 기본 저장소 공급자에서는 `.md`·`.txt`·`.m4a` 이름이 바뀌지 않을 것으로 본다. | `Task12-검토probe-결과\task12-review-mime.json`, android.googlesource.com의 frameworks/base FileUtils.java(main). | 실제 createDocument는 실행하지 않았다. 다른 저장소 앱은 모른다. | Task 17에서 실제 폴더 선택으로 확인한다. |
| N-c | 참고 | 원음 폴더를 고르지 않으면 건너뜀 보고가 원음 순번마다 하나씩 나온다(Windows는 하나). | Copies.java:130이 순번마다 attempt를 부른다. | 화면이 같은 이유를 한 번만 보여 주면 된다. | Task 13에서 중복을 없앤다. 참고로 fe9613d 화면의 종류 이름은 '오디오'·'요약본 .md'로 Windows('원음'·'요약본(.md)')와 다르다. Task 13 검토에서 본다. |
| N-d | 참고(시험 자료) | AndroidChecks와 검토 시험이 앱 cache에 `task10-*` 폴더와 설정 파일을 남긴다. 이번 검토로 cache `task10-*` 258→488개, shared_prefs `task10-*` 84→149개가 되었다. | 아래 '기기 사용'. | 실제 회의자료 폴더와 체험 기록에는 쓰지 않았다. 앞선 검토처럼 지우지 않았다. | 기록만 한다. |
| N-e | 참고(환경) | 검토 복제본은 `core.autocrlf=true`라 공통 예시 파일이 CRLF로 풀려 APK 자산 바이트가 원본(LF)과 다르다. JSON 값은 같아 시험 결과에는 영향이 없다. | 복제본 16,768바이트(CR 317개), `C:\DEV\VoiceNote` 16,451바이트, LF로 맞추면 같음. | 짝 작업 폴더 빌드는 원본과 같은 바이트였다고 보고했다. | 기록만 한다. |

## 반드시 고칠 것

1. **M1 자동 사본 실패 때 상태 줄 문구에 이유와 실패한 종류가 없다.**
   - 재현. 요약(또는 다른 종류) 저장 위치가 권한이 끊긴 폴더일 때 녹음을 마치고 분석하거나 의견 반영을 실행한다. 결과는 저장되고 상태 줄에는 위 고정 문구만 보인다. 기기 재현은 검토 probe `rvAi`(`C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\Task12-검토probe` 시험 파일의 rvAi, 결과 `Task12-검토probe-결과\task12-review-ai.json`).
   - 근거 줄. 후보 Ai.java:112, assets/app.js:223·230. 기준 문구는 계획 '공통 제약'의 사본 실패 문구와 설계 '실패와 다시 저장', Windows desktop/앱/화면/app.js:1831-1837.
   - 고친 뒤 확인. 지적한 쪽이 같은 probe로 상태 문구에 실패한 종류와 이유가 들어가는지, 일부만 실패하면 그 종류만 나오는지, 사본이 모두 성공하거나 저장 위치가 없으면 "회의록 저장 완료"만 남는지를 본다.

## 선택 개선

1. **S1** text 머리글의 차수 기본값을 Markdown·Windows와 같게 1로 맞춘다.
2. **S2** 다시 열 때의 사본 상태에서 '아직 이 폴더에 쓰지 않음'을 구분한다(Task 13과 함께).
3. **S3** 문서가 있는지 확인할 때 파일을 열지 않고 메타데이터를 조회한다.
4. **S4** 앱 안 원본 읽기 실패, 지워진 폴더, 정리 실패의 이유 문구를 실제 원인대로 나눈다.
5. **S5** 설계 문서에 Android 이름의 120바이트 상한과 빈 제목 "회의"를 적는다.

## 시험 결과

로그는 모두 `C:\DEV\VoiceNote\산출물\2026-10-23-첫묶음-검토\` 아래다. 검토 도구는 같은 폴더의 `Task12-검토도구\`(jvm.sh, 변이.ps1, 문서대조.cjs, 이름대조.cjs, 제목목록.cjs, TitleProbe.java)에 두었다. 실제 OpenAI 호출은 0회다(기기 시험은 모의 HTTPS, 빌드의 요약 양식 추출은 서버 코드 읽기).

| 시험 | 명령(기준 위치) | 짝 보고 | 이번 결과 | 로그 |
|---|---|---|---|---|
| Node | `Task12\mobile\안드로이드`에서 `VOICENOTE_TOOLS=C:/DEV/VoiceNote/2026-09-30-회의록도구-안드로이드 node --test tests/*.test.cjs` | 19/19 | 19 통과·0 실패·0 건너뜀, 종료 0. 시험이 남긴 `%TEMP%` 폴더 2개는 지웠다 | `Task12-Node.log` |
| JVM 단독 | `Task12-검토도구\jvm.sh`(시험마다 필요한 소스만 javac, AiResponseModel·AiFeedback·CopyFiles만 android.jar로 컴파일) | TextChunks 18, Trial 59, AiUsage 20, AiResponse 6, SettingsFile 19, AiFeedback 9, CopyFiles 16 | 같은 숫자로 모두 통과. CustomFormat 유효·무효 2줄 기대대로. java.*만 쓰는 7클래스의 import 경계 확인 | `Task12-JVM.log` |
| 검증용 빌드 | PowerShell 7.6.6에서 `mobile\안드로이드\빌드.ps1 -DebugBuild -OutputRoot …\Task12-빌드\검토-Claude-165043-후보1587f5d` | 성공(영문 자산명) | 성공, 공용 기본 키 포함 아니요, APK sha256 `18aa755e9813dc4df58e8a96f5330b44d38fa037d157e2b961ea7e34e55a9dd7`. `assets/meeting-document-cases.json`이 들어 있고 복제본 원본과 sha256이 같다 | `Task12-빌드.log` |
| AndroidChecks(기기) | emulator-5554(VoiceNotePhone, API 35)에 `adb -s emulator-5554 install -r` 후 `am instrument -w kr.local.meetingjournal/kr.local.meetingjournal.AndroidChecks` | 187 PASS | 이 검토의 빌드로 `PASS 187 native storage and recovery checks; real API calls=0`. 끝에 짝 APK를 다시 설치한 뒤에도 187 PASS | `Task12-AndroidChecks.log` |
| 검토 probe(기기) | 후보에 시험 파일만 바꾼 `Task12-검토probe`(rvDocuments·rvCopies·rvAi·rvPermissions·rvMime) | — | 210 PASS(후보 187 + 검토 23). 결과 JSON 5개를 꺼낸 뒤 기기에서 지웠다 | `Task12-검토probe-빌드.log`, `Task12-검토probe-AndroidChecks.log`, `Task12-검토probe-결과\` |
| 문서 직접 대조 | `node Task12-검토도구\문서대조.cjs <기기 JSON> C:\DEV\VoiceNote\desktop\앱\회의문서.cjs <예시 파일>` | 공통 예시 16건 | 예시 8건 16개 모두 Android=Windows=예시 파일. 경계 10건 20개 중 18개 같음, 차수 없음·0의 text 2개만 다름(S1) | `Task12-문서대조.log` |
| 이름 대조 | `TitleProbe.java`(후보 Copies.safeTitle, JVM)와 `이름대조.cjs`(Windows safe 식) | — | 17개 제목 중 11개 같음. 다른 6개는 120바이트 상한 4개와 빈 제목 "회의" 2개(S5) | `Task12-이름대조.log` |
| 고치기 전 대조(javac) | 44b2ab8 제품 소스 + 후보 AndroidChecks.java·CopyFilesTest.java | 짝 RED-문서계약·RED-사본계약·RED-사본파일 | 각각 21개·6개 오류(`Copies`·`MeetingDocument` 없음)로 컴파일 실패 | `Task12-RED-JVM.log` |
| 변이 | `Task12-검토도구\변이.ps1`(결함 하나씩, 기기는 빌드·설치·전체 실행, JVM은 CopyFilesTest) | — | 13종 모두 기대한 확인에서 실패. 끝에 복제본 변경 0 | `Task12-변이.log` |
| Windows 공통 예시 | `Task12\desktop`에서 `node --test 앱/회의문서.test.cjs`(창 없음) | — | 3/3 통과 | `Task12-Windows예시.log` |
| 패치 검사 | `git diff --check 44b2ab8 1587f5d` | — | 문제 없음. desktop 파일 변경 없음 | `Task12-Windows예시.log` |

## 기기 사용과 하지 않은 것

- 에뮬레이터는 짝이 띄워 둔 emulator-5554(VoiceNotePhone, API 35)만 썼다. `adb devices -l`에는 이 기기 하나뿐이었고 모든 adb 명령에 `-s emulator-5554`를 붙였다. 새 에뮬레이터를 켜지 않았고 실기기에는 설치하지 않았다.
- **시작 상태.** 짝 후보 APK(sha256 `af2914018b07e91d2739ab51e91eac277c93a66938838620250ef3df6624fc6e`, lastUpdateTime 2026-10-23 07:40:23 UTC)가 설치되어 있었다. 앱 자료는 cache 261개(task10-* 258), shared_prefs 86개(task10-* 84), `files/회의자료`는 2026-10-02에 만든 빈 프로젝트-01~03이었다.
- **사이에 설치한 것.** 이 검토의 후보 빌드(18aa755e…), 검토 probe 판(e8e1a933…), 변이 10판.
- **끝 상태.** 짝 후보 APK를 다시 설치하고 전체 187 PASS를 확인했다. 설치본 sha256 `af2914018b07e91d2739ab51e91eac277c93a66938838620250ef3df6624fc6e`, 경로 `/data/app/~~dTujPhzQ-o3qYcrkDZblaQ==/kr.local.meetingjournal-suzMFIvXNVaSLEM7FvWnvg==/base.apk`, versionName 1.2.0, lastUpdateTime 2026-10-23 08:09:10 UTC. 앱 자료는 cache 491개(task10-* 488, task12-review-* 0, 그 밖은 시작 때부터 있던 WebView·archive-5989ff2a-a89e-4a5b-8828-02ff2089bd29·oat_primary), shared_prefs 151개(task10-* 149, 그 밖은 WebView 설정 2개)다. `files` 아래 파일은 0개이고 빈 `회의자료/프로젝트-01~03`만 있다. 회의기록 폴더와 trial-access.json은 생기지 않았다. 검토 probe가 cache에 쓴 `task12-review-*` 5개는 꺼낸 뒤 지웠다.
- 검토 복제본 상태. `Task12`·`Task12-변이`·`Task12-기준-44b2ab8`은 변경 0, `Task12-검토probe`는 시험 파일 하나만 바꾼 채 남겼다(커밋하지 않음). 짝 작업 폴더는 검토 중 짝이 Task 13 중간 커밋 fe9613d를 더한 뒤 깨끗한 상태였고, 나는 읽기와 복제만 했다. 이 검토의 판정 대상은 1587f5d뿐이다.
- 이 검토가 띄운 빌드·node·java 프로세스는 모두 끝났다. 지금 남은 node 프로세스는 다른 세션의 MCP 서버와 짝 대기 스크립트다.
- **실행하지 못한 것.**
  1. 실제 SAF 공급자에서 TreeSink(createDocument, 공급자가 돌려준 이름 읽기, MIME에 따른 이름 변경, 실패 때 문서 삭제, 문서가 있는지 확인)와 영구 권한 유지·회수·앱 재시작. 기기에서 돈 TreeSink 경로는 권한 없는 트리의 SecurityException → 권한 안내뿐이다. Task 17 범위다.
  2. MainActivity의 pickFolder·clearFolder·copies·folderResult와 open의 copies 필드는 코드로만 확인했다. 1587f5d 화면은 아직 이 요청을 부르지 않는다(Task 13).
  3. MeetingService를 거친 자동 사본(알림·상태 snapshot)은 돌리지 않았다. 기기 시험은 Ai.run·Ai.refine을 직접 부른다.
  4. 헤드리스 화면 검사(`화면검증-브라우저.cjs`)는 돌리지 않았다. 1587f5d는 화면 자산을 바꾸지 않았다.
  5. desktop 전체 시험은 후보 변경 밖이라 `회의문서.test.cjs`만 돌렸다.
  6. 실제 OpenAI 호출, 실기기, 실제 마이크는 하지 않았다.
- push·커밋·원격 작업, 짝 작업 폴더 수정, 짝에게 직접 연락, 사용자 실제 자료(`%LOCALAPPDATA%\MeetingJournal`, 휴대폰) 접근은 하지 않았다.

## 재확인 기록

M1을 고친 커밋을 받으면 지적한 쪽이 M1의 실패 조건(권한 없는 폴더, 일부 종류만 실패, 모두 성공, 저장 위치 없음)과 그 문구를 쓰는 분석·의견 반영 두 경로만 다시 확인하고 이 아래에 덧붙인다.

### 2026-10-28 Claude 재확인 (후보 283ccaa, 최종 20af38a에 포함)

- **M1 닫힘.** `Ai.copyFailureMessage`(Ai.java)가 Windows `desktop/앱/화면/app.js`의 `copyMessage`와 같은 규칙으로 바뀌었다. 이름표는 원음·전사문·요약본(.md)·요약본(.txt)·사본이고, 실패마다 "이름표 — 이유(끝 마침표 제거)"를 만들어 중복을 지운 뒤 ", "로 잇고, 앞뒤 문장도 Windows와 같다. 두 코드를 줄 단위로 대조했다.
- 시험. 283ccaa가 AndroidChecks에 두 검사를 더했다. 세 종류가 서로 다른 이유로 실패하면 정해진 한 문장이 나오는지, 모두 성공하면 실패 안내가 비는지 본다. 짝의 기기 실행 201 PASS(20af38a)에 들어 있다.
- 결과 화면 사본 구역의 같은 문구는 Task 13 T2에서 고쳤다(20af38a의 assets/app.js `copyMessage`, Windows와 글자까지 같음).
- 미확인. 실제 분석 직후 자동 사본이 실패하는 경로의 상태 줄은 실제 OpenAI 분석이 필요해 기기에서 보지 않았다. 폴더가 사라진 경우의 상태 줄은 D2 기기 재확인(`재확인-D2D3T5-Android.md`)에서 본다.
