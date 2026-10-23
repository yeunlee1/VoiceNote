// 회의 출력 형식(회의록·핵심 요약·업무 정리·내 형식)의 이름과 예시, 내 형식 검증·AI 지시·항목 구성을 브라우저·Node에서 함께 쓴다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeetingFormats = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const LABELS = Object.freeze({ meeting: '회의록', summary: '핵심 요약', tasks: '업무 정리', custom: '내 형식' });
  const DESCRIPTIONS = Object.freeze({
    meeting: '회의에 없던 사람도 무엇을 왜 정했는지 알 수 있게 핵심 요약, 합의된 방향, 주제별 설명, 다음 할 일, 미확정 사항을 모두 씁니다.',
    summary: '짧은 시간에 흐름을 파악하도록 핵심 요약과 주요 주제를 중심으로 쓰고, 결정·할 일·확인할 점은 있는 것만 붙입니다.',
    tasks: '회의 뒤 바로 할 일을 담당·기한과 함께 먼저 보여 주고, 정해지지 않은 일과 결정 사항을 이어서 씁니다.',
    custom: '들어갈 항목과 순서, 항목 이름, AI에게 줄 추가 지시를 직접 정한 형식입니다.',
  });
  const KEYS = Object.freeze(['overview', 'topics', 'decisions', 'actions', 'openQuestions']);
  const KEY_LABELS = Object.freeze({ overview: '핵심 요약', topics: '주요 내용', decisions: '결정 사항', actions: '할 일', openQuestions: '확인 필요' });
  const LIMITS = Object.freeze({ name: 30, title: 30, instruction: 1000 });
  // 예시 화면에만 쓰는 가상의 회의 결과다. 실제 회의 내용과 관계없다.
  const SAMPLE = Object.freeze({
    title: '사내 회의실 예약 화면 개편 회의',
    minutes: {
      overview: '전체 방향 | 예약이 겹치는 문제를 먼저 줄이고, 화면 개편은 다음 달에 이어서 진행합니다.\n주요 결정 | 같은 시간대 중복 예약을 막고 예약 확인 알림을 보냅니다.\n남은 쟁점 | 외부 손님 예약을 누가 승인할지는 정하지 못했습니다.',
      topics: [
        { title: '중복 예약 문제', points: ['같은 회의실이 같은 시간에 두 번 예약되는 일이 지난달에 다섯 번 있었습니다. 예약 저장 전에 시간이 겹치는지 확인하기로 했습니다.'] },
        { title: '알림 방식', points: ['메일보다 사내 메신저 알림을 먼저 붙이기로 했습니다. 메일은 요청이 많을 때 추가합니다.'] },
      ],
      decisions: ['중복 예약 확인 — 저장 전에 같은 시간대를 검사합니다.', '예약 알림 — 사내 메신저로 먼저 보냅니다.'],
      actions: [
        { task: '중복 예약 검사 기능 만들기', owner: '백엔드 담당', due: '10월 15일' },
        { task: '메신저 알림 문구 정하기', owner: null, due: null },
      ],
      openQuestions: ['외부 손님 예약 승인 담당자'],
    },
  });

  function format(value) {
    return Object.prototype.hasOwnProperty.call(LABELS, value) ? value : null;
  }
  function invalid(message) {
    return Object.assign(new Error(message), { status: 400 });
  }
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  function validateCustom(value) {
    // 저장하거나 회의에 붙이기 전에 이름·항목·추가 지시를 모두 확인하고, 앞뒤 공백을 지운 값으로 돌려준다.
    if (!plain(value)) throw invalid('내 형식 내용을 확인하세요.');
    const extra = Object.keys(value).find(key => !['name', 'sections', 'instruction'].includes(key));
    if (extra !== undefined) throw invalid(`내 형식에 알 수 없는 항목(${String(extra).slice(0, 40)})이 있습니다.`);
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > LIMITS.name) throw invalid(`내 형식 이름은 1~${LIMITS.name}자로 입력하세요.`);
    if (!Array.isArray(value.sections) || !value.sections.length || value.sections.length > KEYS.length) throw invalid('내 형식에 넣을 항목을 하나 이상 고르세요.');
    const seen = new Set();
    const sections = value.sections.map(section => {
      if (!plain(section) || !KEYS.includes(section.key) || Object.keys(section).some(key => !['key', 'title'].includes(key))) throw invalid('내 형식 항목을 확인하세요.');
      if (seen.has(section.key)) throw invalid('같은 항목을 두 번 넣을 수 없습니다.');
      seen.add(section.key);
      if (typeof section.title !== 'string' || !section.title.trim() || section.title.trim().length > LIMITS.title) throw invalid(`항목 이름은 1~${LIMITS.title}자로 입력하세요.`);
      return { key: section.key, title: section.title.trim() };
    });
    const instruction = value.instruction ?? '';
    if (typeof instruction !== 'string' || instruction.length > LIMITS.instruction) throw invalid(`추가 지시는 ${LIMITS.instruction.toLocaleString('ko-KR')}자 이하로 입력하세요.`);
    return { name: value.name.trim(), sections, instruction: instruction.trim() };
  }

  function customInstruction(custom) {
    // 휴대폰 CustomFormat.java가 같은 문장을 만든다. 바꿀 때는 두 곳을 함께 바꾼다.
    const order = custom.sections.map(section => `${section.title}(${section.key})`).join(' → ');
    const lines = [
      `사용자가 정한 출력 형식 '${custom.name}'으로 정리합니다. 결과에 보여 줄 항목과 순서는 ${order}입니다.`,
      '목록에 없는 항목은 빈 배열로 두고, overview가 목록에 없으면 한 문장으로만 씁니다. 항목 이름은 프로그램이 붙이므로 본문에 다시 쓰지 않습니다.',
    ];
    if (custom.instruction) lines.push(`사용자 추가 지시: ${custom.instruction}`, '추가 지시가 위의 사실 확인·근거 규칙과 충돌하면 위 규칙을 따릅니다.');
    return lines.join('\n');
  }

  function actionLine(action) {
    return [action.task, `담당 ${action.owner || '미정'}`, `기한 ${action.due || '미정'}`].join(' · ');
  }

  function customSections(minutes, custom) {
    const m = minutes || {};
    return custom.sections.map(({ key, title }) => {
      if (key === 'overview') return { type: 'overview', title, text: String(m.overview || '') };
      if (key === 'topics') return { type: 'topics', title, topics: m.topics || [] };
      return { type: 'list', title, items: key === 'actions' ? (m.actions || []).map(actionLine) : (m[key] || []) };
    });
  }

  function customText(minutes, custom) {
    // 저장 파일과 복사용 글에 쓰는 마크다운 본문이다. 내용이 없는 항목은 '없음'으로 남긴다.
    return customSections(minutes, custom).flatMap(section => {
      if (section.type === 'overview') return [`## ${section.title}`, section.text, ''];
      if (section.type === 'topics') return [`## ${section.title}`, '', ...(section.topics.length ? section.topics.flatMap(topic => [`### ${topic.title}`, '', ...(topic.points || []).flatMap(point => [point, ''])]) : ['없음', ''])];
      return [`## ${section.title}`, ...(section.items.length ? section.items.map(item => `- ${item}`) : ['- 없음']), ''];
    });
  }

  function defaultCustom() {
    return { name: '', sections: KEYS.map(key => ({ key, title: KEY_LABELS[key] })), instruction: '' };
  }

  return { LABELS, DESCRIPTIONS, KEYS, KEY_LABELS, LIMITS, SAMPLE, format, validateCustom, customInstruction, actionLine, customSections, customText, defaultCustom };
});
