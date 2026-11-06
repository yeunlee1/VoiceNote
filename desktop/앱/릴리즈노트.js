// VoiceNote 버전별 바뀐 점을 정리한 목록이다. Windows 화면과 Android 화면이 같은 파일을 쓴다(안드로이드 assets/release-notes.js와 같은 내용).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoiceNoteReleaseNotes = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  // 새 버전을 낼 때 맨 앞에 더한다. date는 깃허브 릴리즈를 게시한 날(한국 시간)이고, 아직 게시하지 않은 버전은 null이다.
  // 문장은 회의를 기록하는 사람이 읽고 바로 알 수 있게 쓰고, 내부 이름이나 파일 이름은 넣지 않는다.
  const NOTES = [
    { version: '1.5.0', date: null, title: '앱 안에서 업데이트', items: [
      '새 버전이 나오면 Windows는 화면 위쪽, Android는 첫 화면에 알려 줍니다.',
      'Windows는 ‘지금 업데이트’를 누르면 받아서 설치한 뒤 다시 켭니다. Android는 받은 뒤 나오는 설치 화면에서 ‘업데이트’만 누르면 됩니다.',
      '녹음·분석 중이거나 저장하지 않은 내용이 있으면 설치하지 않고 이유를 알려 줍니다.',
      '받은 파일이 VoiceNote 서명과 맞을 때만 설치합니다.',
      '설정의 ‘프로그램 정보’에서 지금 버전과 버전별로 바뀐 점을 볼 수 있습니다.',
    ] },
    { version: '1.4.0', date: '2026-11-06', title: '긴 회의 정리와 다음 할 일', items: [
      '회의가 길어도 결과를 읽기 좋은 길이로 줄입니다. 합의된 방향·다음 할 일·미확정 사항은 그대로 둡니다.',
      '회의록 형식에서 핵심 요약 바로 아래에 다음 할 일을 보여 줍니다.',
      '비슷한 할 일은 묶되 담당·기한과 ‘이번 스프린트’ 같은 시점은 남깁니다.',
      '참석자 칸의 이름을 전사 힌트로 쓰고, 이름이 나온 일은 참석자 명단의 표기로 적습니다.',
      'AI 결과에 섞여 나오는 일본어·중국어 글자를 지웁니다.',
      '할 일이 아주 많거나 결과가 길 때 요약 전체가 실패하던 문제를 고쳤습니다.',
    ] },
    { version: '1.3.0', date: '2026-10-28', title: '바로 시작하는 회의', items: [
      '프로젝트를 고르지 않고 바로 회의를 시작합니다. 회의명을 비워 두면 AI가 제목을 정합니다.',
      '1.2.0까지 프로젝트에 저장한 회의도 지난 회의 한 목록에서 함께 봅니다.',
      'AI 연결·출력 형식·저장 위치·설정 파일을 설정 창 한곳에서 정합니다.',
      '원음·전사문·요약본을 고른 폴더에 사본으로 남깁니다.',
      '요약에 별점과 의견을 남기고, 의견을 반영해 요약을 다시 정리할 수 있습니다.',
      '요약 모델·기본 출력 형식·내 형식을 설정 파일로 Windows와 Android 사이에 옮깁니다.',
    ] },
    { version: '1.2.0', date: null, title: '1.2.0까지', items: [
      '회의를 프로젝트 1~3으로 나눠 보관했습니다. 이 기록은 1.3.0부터 지난 회의 목록에 함께 보입니다.',
      '1.2.0에서 GPT-6 Sol과 GPT-5.6 Terra를 요약 모델 목록에서 뺐습니다.',
      '1.0.1부터 전사 원문을 요약 전에 자동으로 보관합니다.',
    ] },
  ].map((note) => Object.freeze({ ...note, items: Object.freeze([...note.items]) }));

  function find(version) {
    return NOTES.find((note) => note.version === version) || null;
  }
  // 날짜는 '2026년 11월 6일'처럼 보여 준다. 게시 전이면 빈 글자를 돌려준다.
  function dateLabel(date) {
    const match = typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
    return match ? `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일` : '';
  }

  return Object.freeze({ NOTES: Object.freeze(NOTES), find, dateLabel });
});
