// 회의 출력 형식(회의록·핵심 요약·업무 정리·내 형식)의 이름과 예시, 내 형식 검증·AI 지시·항목 구성을 브라우저·Node에서 함께 쓴다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeetingFormats = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const LABELS = Object.freeze({ meeting: '회의록', summary: '핵심 요약', tasks: '업무 정리', custom: '내 형식' });
  const DESCRIPTIONS = Object.freeze({
    meeting: '회의에 없던 사람도 무엇을 왜 정했는지 알 수 있게 핵심 요약, 다음 할 일, 합의된 방향, 주제별 설명, 미확정 사항을 모두 씁니다.',
    summary: '짧은 시간에 흐름을 파악하도록 핵심 요약과 주요 주제를 중심으로 쓰고, 결정·할 일·확인할 점은 있는 것만 붙입니다.',
    tasks: '회의 뒤 바로 할 일을 담당·기한과 함께 먼저 보여 주고, 정해지지 않은 일과 결정 사항을 이어서 씁니다.',
    custom: '들어갈 항목과 순서, 항목 이름, AI에게 줄 추가 지시를 직접 정한 형식입니다.',
  });
  const KEYS = Object.freeze(['overview', 'topics', 'decisions', 'actions', 'openQuestions']);
  const KEY_LABELS = Object.freeze({ overview: '핵심 요약', topics: '주요 내용', decisions: '결정 사항', actions: '할 일', openQuestions: '확인 필요' });
  const LIMITS = Object.freeze({ name: 30, title: 30, instruction: 1000 });
  const OVERVIEW_LABELS = Object.freeze(['전체 방향', '주요 결정', '다음 할 일', '남은 쟁점']);
  // 회의록형 핵심 요약의 머리말이다. 옛 결과의 '머리말 | 내용' 줄은 이 넷으로 시작할 때만 머리말과 하위 항목으로 나눈다.
  const ITEM_LIMITS = Object.freeze({ text: 1000, detail: 1000, details: 8, overview: 12 });
  // AI 응답 검사의 항목 한도다. 저장된 옛 결과를 읽을 때는 쓰지 않는다.
  // 결과 문서의 목표 글자 수다. 휴대폰 SummaryRules.java와 같은 값을 쓴다.
  const LENGTH_GOALS = Object.freeze({ meeting: 3000, summary: 1000, tasks: 2000, custom: 3000 });
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
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LABELS, value) ? value : null;
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
      '목록에 없는 항목은 빈 배열로 두고, overview가 목록에 없으면 항목 하나로만 씁니다. 항목 이름은 프로그램이 붙이므로 본문에 다시 쓰지 않습니다.',
    ];
    if (custom.instruction) lines.push(`사용자 추가 지시: ${custom.instruction}`, '추가 지시가 위의 개조식·사실 확인·근거 규칙과 충돌하면 위 규칙을 따릅니다.');
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
      return { type: 'list', key, title, items: key === 'actions' ? (m.actions || []).map(actionLine) : (m[key] || []) };
    });
  }

  function customText(minutes, custom) {
    // 저장 파일과 복사용 글에 쓰는 마크다운 본문이다. 목록 칸은 항목·하위 항목으로 쓰고, 내용이 없는 항목은 '없음'으로 남긴다.
    const m = normalizeMinutes(minutes || {});
    return custom.sections.flatMap(({ key, title }) => {
      if (key === 'topics') return [`## ${title}`, '', ...(m.topics.length ? m.topics.flatMap(topic => [`### ${topic.title}`, '', ...itemLines(topic.points), '']) : ['없음', ''])];
      const lines = key === 'actions' ? (m.actions || []).map(action => `- ${actionLine(action)}`) : itemLines(m[key]);
      return [`## ${title}`, ...(lines.length ? lines : ['- 없음']), ''];
    });
  }

  function defaultCustom() {
    return { name: '', sections: KEYS.map(key => ({ key, title: KEY_LABELS[key] })), instruction: '' };
  }

  function minutesLengths(minutes) {
    // 줄일 수 있는 본문(overview·topics)과 그대로 둘 목록(결정·할 일·미확정)의 글자 수를 따로 센다. 휴대폰 MinutesItems.java도 같은 항목을 센다.
    const m = minutes || {};
    const size = list => (list || []).reduce((sum, value) => sum + String(value ?? '').length, 0);
    const field = value => typeof value === 'string' ? value.length
      : Array.isArray(value) ? value.reduce((sum, entry) => sum + (plain(entry) ? String(entry.text ?? '').length + size(entry.details) : String(entry ?? '').length), 0) : 0;
    // 옛 문자열은 지금처럼 원래 길이를, 항목은 본문과 하위 항목의 글자 수를 센다.
    return {
      body: field(m.overview) + (m.topics || []).reduce((sum, topic) => sum + String(topic.title || '').length + field(topic.points), 0),
      kept: field(m.decisions) + field(m.openQuestions) + (m.actions || []).reduce((sum, action) => sum + size([action.task, action.owner, action.due]), 0),
    };
  }

  const BULLETS = /^(?:[-•·*](?:\s+|$))+/;
  // 글 맨 앞의 글머리표 묶음이다. 기호 뒤에 공백이나 글 끝이 올 때만 떼므로 '-5도' 같은 글은 그대로 둔다.
  const clean = value => typeof value === 'string' ? value.trim().replace(BULLETS, '').trim() : '';
  const LABEL_LINE = new RegExp(`^(${OVERVIEW_LABELS.join('|')})\\s*\\|(.*)$`);

  function item(value) {
    // 문자열이나 항목 하나를 앞뒤 공백과 앞 글머리표를 뗀 항목으로 바꾼다. 빈 하위 항목은 버리고, 본문이 비면 첫 하위 항목을 올리며, 둘 다 비면 null이다.
    if (typeof value === 'string') { const text = clean(value); return text ? { text, details: [] } : null; }
    if (!plain(value)) return null;
    const details = (Array.isArray(value.details) ? value.details : []).map(clean).filter(Boolean);
    const text = clean(value.text);
    if (text) return { text, details };
    return details.length ? { text: details[0], details: details.slice(1) } : null;
  }

  function items(value) {
    // 없는 칸·문자열 하나·문자열 배열·항목 배열을 모두 항목 배열로 바꾼다. 옛 문단은 길이와 관계없이 항목 하나가 된다.
    if (typeof value === 'string') { const one = item(value); return one ? [one] : []; }
    return Array.isArray(value) ? value.map(item).filter(Boolean) : [];
  }

  function overviewItems(value) {
    // 옛 핵심 요약 문자열은 줄마다 항목 하나로, 알려진 머리말 줄은 첫 구분자에서 나눠 머리말과 하위 항목으로 바꾼다. 새 구조는 items와 같다.
    if (typeof value !== 'string') return items(value);
    return value.split(/\r?\n/).map(line => {
      const text = clean(line), label = text.match(LABEL_LINE);
      if (!label) return text ? { text, details: [] } : null;
      const detail = clean(label[2]);
      return { text: label[1], details: detail ? [detail] : [] };
    }).filter(Boolean);
  }

  function normalizeMinutes(minutes) {
    // 저장 원본은 바꾸지 않고, 핵심 요약·주제 항목·결정·미확정만 항목 배열로 바꾼 새 객체를 돌려준다. 할 일과 제목은 그대로 둔다.
    if (!plain(minutes)) return minutes;
    return {
      ...minutes,
      overview: overviewItems(minutes.overview),
      topics: (Array.isArray(minutes.topics) ? minutes.topics : []).map(topic => ({ ...topic, points: items(topic?.points) })),
      decisions: items(minutes.decisions),
      openQuestions: items(minutes.openQuestions),
    };
  }
  const pruneMinutes = normalizeMinutes;
  // 새 구조 AI 응답의 빈 값 정리는 item 규칙과 같으므로 같은 함수를 쓴다.

  function itemLines(list, marker = '- ') {
    // 항목은 기호와 본문 첫 줄로 쓰고, 이어지는 줄은 기호 폭만큼 들여 쓴다. 하위 항목은 두 칸 들여 '- '로 쓴다.
    const indent = ' '.repeat(marker.length);
    const block = (text, first, rest) => {
      const [head, ...tail] = String(text).split(/\r?\n/);
      return [first + head.trim(), ...tail.map(line => line.trim()).map(line => line ? rest + line : '')];
    };
    // 이어지는 줄은 앞뒤 공백만 떼고 내용과 빈 줄은 그대로 둔다. 줄 안의 기호(예: '- 5도')도 원문 글자이므로 지우지 않는다.
    return items(list).flatMap(entry => [...block(entry.text, marker, indent), ...entry.details.flatMap(detail => block(detail, '  - ', '    '))]);
  }

  function compactTarget(minutes, outputFormat) {
    // 결과가 목표의 1.2배를 넘고 줄일 본문이 남아 있으면 본문에 허용할 글자 수를, 아니면 0을 돌려준다. 휴대폰 SummaryRules.java와 같은 규칙이다.
    const goal = LENGTH_GOALS[format(outputFormat) || 'meeting'];
    const { body, kept } = minutesLengths(minutes);
    if (body + kept <= goal * 6 / 5) return 0;
    const target = Math.max(goal / 2, goal - kept);
    return body > target ? target : 0;
  }

  function participantKeywords(value) {
    // 참석자 칸을 전사 힌트 단어로 바꾼다. 꺾쇠·줄바꿈이 들어가면 OpenAI가 요청 전체를 거절하므로 글자·숫자·밑줄·하이픈만 남긴다. 휴대폰 SummaryRules.java와 같은 규칙이다.
    const words = [];
    for (const piece of String(value ?? '').split(/[\s,，、;；/|·・]+/u)) {
      const word = piece.replace(/[^\p{L}\p{N}_-]/gu, '');
      if (word.length < 2 || word.length > 30 || words.includes(word)) continue;
      words.push(word);
      if (words.length === 20) break;
    }
    return words;
  }

  // AI가 결과에 섞어 쓴 일본어·중국어 글자(히라가나·가타카나·한자와 장음 부호)를 지운다(2026-11-06 사용자 결정). 휴대폰 SummaryRules.java가 같은 범위로 지운다.
  // 유니코드 표준 버전이 달라도 두 앱이 같은 글자를 지우도록 문자 체계 이름 대신 번호 범위를 쓴다. 한국어에서 쓰는 ㈜·㎏ 같은 기호와 가운뎃점 ・은 넣지 않는다.
  const FOREIGN_SCRIPT = /[\u2E80-\u2FDF\u3005-\u3007\u3021-\u3029\u3038-\u303B\u3040-\u309F\u30A0-\u30FA\u30FC-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\u{1B000}-\u{1B16F}\u{20000}-\u{323AF}]+/gu;
  function withoutForeignText(value) {
    if (typeof value !== 'string' || value.search(FOREIGN_SCRIPT) < 0) return value;
    // 지운 자리에 남는 겹친 공백과 가운뎃점은 하나로 줄이고 앞뒤 공백을 뺀다.
    return value.replace(FOREIGN_SCRIPT, '').replace(/·{2,}/g, '·').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
  }
  function withoutForeignScript(value) {
    // 결과의 모든 문자열에서 지우고, 비게 된 제목은 빼서 다음 구간의 결과 검사를 통과하게 한다.
    const clean = item => typeof item === 'string' ? withoutForeignText(item)
      : Array.isArray(item) ? item.map(clean)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, clean(entry)])) : item;
    const result = clean(value);
    if (result && result.suggestedTitle === '') delete result.suggestedTitle;
    return result;
  }

  return { LABELS, DESCRIPTIONS, KEYS, KEY_LABELS, LIMITS, LENGTH_GOALS, SAMPLE, OVERVIEW_LABELS, ITEM_LIMITS, format, validateCustom, customInstruction, actionLine, customSections, customText, defaultCustom, minutesLengths, compactTarget, participantKeywords, withoutForeignText, withoutForeignScript, item, items, overviewItems, normalizeMinutes, pruneMinutes, itemLines };
});
