# Task 14 작성 결과

후보 cf9a5d72e832ac842ccd5461c43e9f2b5bba7415, BASE 283ccaaf69a3831df77946085e00dbc37fb5b532다. Android 1.3.0의 버전·빌드 검사·안내를 고치고 Windows PowerShell 5.1에서 검증용과 release APK를 공용 키 없이 만들었다. 사용자 전달 폴더 게시는 하지 않았으며, Claude의 독립 교차 검토가 남는다.

## 확인

대상은 C:\workspace\VoiceNote\work-2026-10-23-안드로이드-프로젝트제거의 work/2026-10-23-안드로이드-프로젝트제거 브랜치다. AndroidManifest.xml, 빌드.ps1, 빌드안내.txt 세 파일만 바꿨다. 공유 Task Master C:\DEV\VoiceNote, master의 5.5·5.6·5.10 범위이며 목록은 주작성자인 Claude가 관리한다.

- manifest는 versionName 1.3.0, versionCode 5다. minSdkVersion 26·targetSdkVersion 35는 유지했다. 실제 두 APK의 aapt2 badging에서도 같은 버전을 확인했다.
- 빌드 결과의 날짜 포함 한글 이름을 1.3.0으로 바꿨다. APK 항목 검사에 summary-feedback.json을 더했고, 빠지면 빌드를 중단하며 들어 있으면 의견 반영 지시문 포함 예를 출력한다.
- PowerShell 5.1의 Get-ChildItem -LiteralPath -Recurse -Include가 일반 자산 5개를 반환하는 현상과, 원래 DebugBuild가 원본 자산에 API 키 파일이 섞였다는 오류로 끝나는 것을 실제 재현했다. 파일을 열거한 뒤 Name을 직접 거르도록 고쳤다. 수정 후 같은 PowerShell 5.1에서 Debug·release 두 빌드가 종료값 0으로 끝났다.
- 빌드 스크립트의 실제 검사 구문을 별도 합성 폴더에서 실행해 일반 자산 허용, 하위 폴더의 personal.key 거절, default.key 거절, 의견 지시문 포함 허용·누락 거절의 5조건을 통과했다. 합성 키 파일은 빈 파일이며 실제 키 값은 쓰지 않았다.
- 두 APK 모두 공용 기본 키 포함 아니요, 키 파일 항목 0, formats.js·요약 양식 3개·summary-feedback.json 포함이다. 서명 검증도 빌드에서 통과했다. Debug에는 AndroidChecks가 있고 release manifest에는 없다.
- 최종 Debug APK를 emulator-5554에 설치해 AndroidChecks 194 PASS, 실제 API 호출 0회를 확인했다. 최종 빌드 클래스로 JVM 7종 18·59·20·6·19·9·16개, Node 19/19를 다시 통과했다. Task 14는 화면 파일을 바꾸지 않아 Task 13의 Chrome 82/82와 직접 열람한 캡처 30개를 재사용한다.
- 빌드안내는 버전, PowerShell 5.1, 키 없는 두 빌드, 네 설정 구역, 저장 위치·사본 재시도, 기존 .md·.txt 유지, 평가·의견 반영·결과 버전, 설정 파일 2판과 기기 시험 격리를 현재 소스와 맞췄다.

## 빌드 근거

이번 산출물은 작업 폴더 산출물/2026-10-28-DispatchC-Task14 아래에 있다. RED-PS51.log는 원래 검사 실패, PS51-Debug.log와 PS51-Release.log는 수정 후 빌드 결과다. PS51-자산검사.log, APK-검사.json, Debug-badging.log, Release-badging.log, Debug-manifest.log, Release-manifest.log, AndroidChecks.log, 최종-Node.log, 최종-JVM.log에 개별 근거를 남겼다.

| 내부 산출물 | SHA-256 |
|---|---|
| PS51-Debug/VoiceNote-android-test.apk | 23C59E02FEC773B198597A8323EA62B6C139CEF17A7430C9E0D636E5EC6485BB |
| PS51-Release/VoiceNote-android.apk | 6ED788A50A27F16592D99C125227AEED851BC4BD7B03D0CF73B40FE1BDDD6333 |

재현은 저장소 루트에서 powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File mobile/안드로이드/빌드.ps1 -DebugBuild -OutputRoot <새 절대경로>로 한다. release는 DebugBuild를 뺀다. DefaultKeyFile은 두 명령 모두 지정하지 않는다. 실제 생성된 한글 파일 이름은 2026-10-28-VoiceNote-1.3.0-안드로이드-검증용.apk와 2026-10-28-VoiceNote-1.3.0-안드로이드-설치본.apk다.

## 추정과 미확인

추정으로 통과시킨 항목은 없다. 사용자 전달 폴더 갱신, 실기기 설치, 실제 SAF 폴더 권한 유지, 실제 OpenAI 호출, push·main 병합은 하지 않았다. 이 내부 APK는 작성자 검증 산출물이며 사용자 전달 완료가 아니다. 에뮬레이터는 다음 검토·Task 17을 위해 켜 둔 채 Claude에게 반환한다.
