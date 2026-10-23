# Task 12 정적 구현 진행

상태는 구현·기기 확인 완료, Claude 교차 검토 전이다. BASE44b2ab8d33fb9eab48efc8c01084932f1f5703a4다. 아래 앞부분은 자원 반환 전 정적 작업 기록이고 끝의 기기 확인 결과가 최신 근거다.

## 확인

- MeetingDocument로 기존 텍스트 변환 본문을 옮기고 Windows 회의문서.cjs에 맞춘 Markdown 변환을 작성했다. Store.format은 기존 호출자를 위한 한 줄 위임만 남겼고 실제 저장·공유는 새 변환기를 쓴다. 공통 예시8종은 DebugBuild 자산에만 넣도록 했다.
- Copies는 FileSink와 TreeSink, 종류별·결과별 사본 기록, 원음의 회의/순번별 중복 방지, 실패 항목 message와 다시 열기 상태 조회를 작성했다. 실제 문서의 URI와 공급자가 돌려준 이름을 기록한다. TreeSink의 .md MIME은 text/markdown으로 준비했지만 공급자의 실제 이름 변경은 아직 확인하지 않았다.
- Store.settings는 storage의 각 종류에 {uri,name}을 주고 SettingsFile 내보내기에는 넣지 않는다. MainActivity에 pickFolder/clearFolder/copies와 open의 copies 상태를 연결했다. Ai는 결과를 저장한 뒤 사본을 쓰며 사본 실패를 결과 저장 실패로 다시 던지지 않는다.
- CopyFilesTest에서 구현 클래스 부재 RED를 확인한 뒤 파일 겹침·기존 파일 보존·중간 실패 정리·경로/제어문자·긴 제목과 이모지16건을 JVM에서 통과했다. org.json/Context를 만들지 않는 FileSink 경로만 실행했다.
- 문서/사본/권한 시험을 AndroidChecks에 먼저 적고 없는 클래스/생성자의 javac 실패를 확인한 뒤 구현했다. 이후 전체 제품 Java+AndroidChecks의 javac, Node19건은 통과했다. 기기 동작의 통과 근거는 아직 아니다.

## 판단 기록

Android의 긴 한글 파일명이 바이트 한도를 넘지 않도록 제목에80코드포인트와 UTF8 120바이트 제한을 함께 쓴다. 날짜·순번·전체 결과id·파일 종류·겹침번호가 들어갈 길이를 남기고 이모지는 반쪽으로 자르지 않는다. 저장 위치 응답 모양과 실패 message 필드는 구현 전에 msg_0bb559f83062로 알렸다.

SAF의 트리 선택과 영구 읽기·쓰기 권한, 폴더 이동/삭제 뒤 다시 권한을 받아야 하는 경계는 [Android 공식 문서](https://developer.android.com/training/data-storage/shared/documents-files)를 참고했다. 이 문서 확인은 실제 공급자 시험을 대신하지 않는다.

## 자원 반환 전 미확인 기록

기기 공통 예시 text/Markdown 비교, 부분 실패 뒤 txt만 재시도, 제목이 달라도 원음 한 번, 새 폴더와 지워진 문서, 옛 결과 사본 기록, 공유 권한의 마지막 참조 정리는 AndroidChecks에 준비만 했다. DebugBuild·AndroidChecks 실행과 검토가 남았다. 실제 SAF 공급자·이름/MIME 변경·권한 회수·재시작은 Task17 경계다. 실제 사용자 자료·OpenAI·원격·main 병합은 사용하지 않았다.

정적 근거는 자기 작업 폴더의 산출물/2026-10-23-Task12 안 RED-사본파일.log, RED-제어문자.log, GREEN-제어문자.log, RED-문서계약.log, RED-사본계약.log, 정적-컴파일.log, 정적-Node.log다.

## 기기 확인 결과

Task11 교차 검토 통과와 자원 반환 뒤 Task12를 빌드·설치했다. 첫 빌드는 공통 예시의 한글 자산 이름에서 aapt2가 파일을 열지 못해 실패했다(빌드.log). 원본 예시를 바꾸지 않고 APK 안 자산 이름만 meeting-document-cases.json으로 바꾼 새 빌드는 성공했다(빌드-영문자산.log). 원본과 포장 자산의 SHA256도 같았다.

AndroidChecks **187건 PASS·실제 API0회**(AndroidChecks.log). 공통 예시8종의 text/Markdown16건, 부분 실패 뒤 txt만 다시 저장, 긴 제목의 실제 파일명, 같은 폴더의 종류별 구분, 제목이 달라도 원음 한 번, 폴더 변경과 문서 삭제 뒤 재저장, 옛 결과 사본 기록, 공유 권한 마지막 참조, 자동 사본 실패 후 결과 성공 유지가 포함된다. 권한 검사는 합성 Permissions를 주입한 수명 확인이며 실제 SAF 권한 시험으로 대신 주장하지 않는다.

Node19/19(최종-Node.log), 최종 빌드 클래스에서 JVM7종(TextChunks18·Trial59·AiUsage20·AiResponse6·SettingsFile19·AiFeedback9·CopyFiles16) 통과(최종-JVM.log). 바뀌지 않은 화면37건 근거는 재사용했다. 실제 앱 files/회의자료의 파일 목록은 비어 있었고 모든 시험 자료는 task10-* 캐시에만 썼다. APK는 산출물/2026-10-23-Task12/작성-Codex-164011/VoiceNote-android-test.apk다.

## 남은 확인

실제 TreeSink의 MIME/파일 이름, 폴더 선택/취소, 영구 권한·권한 회수는 Task17에서 확인한다. Android 화면 연결은 Task13 범위다. Task12는 구현·필수 시험 완료이나 Claude 교차 검토 전이다. APK는 검증용이며 버전 변경은 Task14에서 한다.

끝 커밋 **1587f5dada1ace134b44c39a90954c9ff8ad1e27**, BASE **44b2ab8d33fb9eab48efc8c01084932f1f5703a4**. 제품·시험8파일, 커밋 뒤 작업 트리 깨끗함.
