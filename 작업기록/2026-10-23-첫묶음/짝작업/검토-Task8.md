# Task 8 교차 검토

후보 d652a1d(BASE d184042)를 별도 clone --no-hardlinks에서 읽고 같은 빌드 명령을 새 폴더로 다시 실행했다. 계획 Task 8의 코드·빌드 확인 범위는 통과이며 반드시 고칠 것은 찾지 못했다. 실제 Windows 창 동작은 Task 17에서 확인해야 한다.

## 확인

- desktop/프로그램.cs:141-146은 앱의 로컬 origin에서 요청한 마이크만 Allow, 나머지는 Deny이며 SavesInProfile=false를 유지한다. IsLocal:258은 scheme·host·port를 모두 비교한다.
- 프로그램.cs:147-172는 WebMessageAsJson을 역직렬화해 문자열 open-data-folder와 객체 pick-folder를 나눠 처리한다. kind는 audio/transcript/summary만 받고, 자체 검사에서는 폴더 창을 띄우지 않는다. BeginInvoke 뒤 PickFolder:216-236에서 창 소유자·한 번에 하나·취소 path:null·JSON 응답을 연결했다.
- 프로그램.cs:27-49·62-71은 --data-root의 자료 경로, 경로 해시 뮤텍스, 원래 실행 모드와 자체 검사 모드를 나눈다. 자체 검사:190-213은 설정 버튼·지난 회의·상태 함수와 기존 가상 마이크 확인을 사용한다.
- 별도 빌드 desktop/설치/빌드.ps1 -BuildRoot <자기 산출물의 검토-Codex-20261023-155418> 종료 0. csc·ISCC 오류 없음. 실행파일 133,632바이트/파일·제품 버전1.3.0.0, 설치파일26,691,246바이트/제품 버전1.3.0을 직접 조회했다.
- 빌드 배포 폴더의 기본키.json·personal.key·default.key는 0개. DefaultKeyFile을 주지 않았다. 설치파일을 실행하거나 설치하지 않았다.

빌드 위치 C:/workspace/VoiceNote/work-2026-10-23-안드로이드-프로젝트제거/산출물/2026-10-23-첫묶음-빌드/검토-Codex-20261023-155418. 실행 파일은 그 아래 배포/프로젝트 회의록.exe, 설치파일은 설치파일/2026-10-23-VoiceNote-1.3.0-설치.exe다. 원로그는 자체 첫묶음-검토/Task8-빌드.log와 Task8-빌드경로.txt에 있다.

## 추정·미확인

코드상 메시지 형식은 Task 6과 이어진다. 폴더 선택·취소, 마이크 권한과 운영체제 차단 안내, 실제 WebView2 재진입, --data-root 실제 창과 자체 검사는 실행하지 않았다. 이것을 빌드 통과로 대신 판정하지 않았으며 Task 17에서 둘이 확인한다. 선택 개선은 추가하지 않았다.
