// 회의 결과 기록을 사본 저장용 Markdown과 텍스트로 만든다. 목록 칸은 개조식(항목·하위 항목)으로 쓰며, Android도 같은 공통 예시로 같은 결과를 시험한다.
const formats = require('./출력형식.js');

function markdown(record) {
  const m = formats.normalizeMinutes(record.minutes);
  // 옛 문자열 결과도 항목 배열로 바꾼 값으로 쓴다. 저장된 원본은 바꾸지 않는다.
  const head = [`# ${record.title}`, '', ...(record.projectName ? [`프로젝트: ${record.projectName}`] : []), `날짜: ${record.date} · ${record.dailySequence || 1}차 회의`, `참석자: ${record.participants || '미입력'}`, ''];
  if (record.outputFormat === 'custom' && record.customFormat) return [...head, ...formats.customText(m, record.customFormat)].join('\n');
  const action = a => `- ${a.task} · 담당 ${a.owner || '미정'} · 기한 ${a.due || '미정'}`;
  const list = (title, lines) => lines.length ? [`## ${title}`, ...lines, ''] : [];
  const topics = title => m.topics.length ? [`## ${title}`, '', ...m.topics.flatMap(t => [`### ${t.title}`, '', ...formats.itemLines(t.points), ''])] : [];
  // 목록 기호는 itemLines와 할 일 줄에서 한 번만 붙인다. 핵심 요약형과 업무 정리형은 내용이 있는 절만 남기고, 회의록형은 기존 순서를 그대로 쓴다.
  if (record.outputFormat === 'summary')
    return [...head, '## 핵심 요약', ...formats.itemLines(m.overview), '', ...topics('주요 내용'), ...list('결정 사항', formats.itemLines(m.decisions)), ...list('후속 작업', m.actions.map(action)), ...list('확인 필요', formats.itemLines(m.openQuestions))].join('\n');
  if (record.outputFormat === 'tasks')
    return [...head, '## 업무 요약', ...formats.itemLines(m.overview), '', '## 할 일', ...(m.actions.length ? m.actions.map(action) : ['- 확인된 할 일 없음']), '',
      ...list('미확정 항목', formats.itemLines(m.openQuestions)), ...list('결정 사항', formats.itemLines(m.decisions)), ...topics('참고 내용')].join('\n');
  return [...head,
    '## 핵심 요약', ...formats.itemLines(m.overview), '', '## 다음 할 일',
    ...m.actions.map(a => `- ${a.task} · 담당 ${a.owner || '미정'} · 기한 ${a.due || '미정'}`), '',
    '## 상세 회의 내용', '', '## 합의된 방향', ...formats.itemLines(m.decisions), '',
    ...m.topics.flatMap(t => [`## ${t.title}`, '', ...formats.itemLines(t.points), '']),
    '## 미확정 사항', ...formats.itemLines(m.openQuestions), ''].join('\n');
}

// Android Store.format()·topics()·actions()·append()를 그대로 옮겼다. 두 앱의 .txt가 같아야 하므로 줄바꿈 하나도 따로 바꾸지 않는다.
function plainText(record) {
  const m = formats.normalizeMinutes(record.minutes);
  const lines = items => formats.itemLines(items).map(line => `${line}\n`).join('');
  const entries = items => { const text = lines(items); return text && `${text}\n`; };
  // 목록은 항목('- 본문')과 하위 항목('  - 하위')을 한 줄씩 쓰고, 목록 묶음 끝에 빈 줄 하나를 둔다. 빈 목록은 아무것도 쓰지 않는다.
  const topics = () => m.topics.map(t => `\n${t.title}\n${entries(t.points)}`).join('');
  const overview = entries(m.overview) || '\n';
  // 핵심 요약이 비어도 다음 제목과의 사이에 빈 줄 하나를 남긴다.
  // 담당·기한이 비었을 때 미정으로 쓰는 것은 업무 정리형과 내 형식뿐이다.
  const actions = undecided => m.actions.map(a => `- ${a.task}${a.owner ? ` · 담당 ${a.owner}` : undecided ? ' · 담당 미정' : ''}${a.due ? ` · 기한 ${a.due}` : undecided ? ' · 기한 미정' : ''}\n`).join('');
  const head = `${record.title}\n\n${record.date} · ${record.dailySequence || 1}차 회의`;
  if (record.outputFormat === 'custom' && record.customFormat) {
    // 내 형식은 고른 항목만 고른 순서와 이름으로 쓰고, 내용이 없는 항목은 없음으로 남긴다.
    const custom = record.customFormat;
    return `${head} · ${custom.name}` + custom.sections.map(({ key, title }) => `\n\n${title}\n` + (
      key === 'topics' ? (m.topics.length ? topics() : '없음\n')
        : key === 'actions' ? (m.actions.length ? actions(true) : '- 없음\n')
          : lines(m[key]) || '- 없음\n')).join('');
  }
  if (record.outputFormat === 'summary')
    return `${head} · 핵심 요약\n\n핵심 요약\n${overview}주요 내용\n${topics()}\n합의된 방향\n${entries(m.decisions)}\n다음 할 일\n${actions(false)}\n미확정 사항\n${entries(m.openQuestions)}`;
  if (record.outputFormat === 'tasks')
    return `${head} · 업무 정리\n\n업무 요약\n${overview}할 일\n${actions(true)}\n확인 필요\n${entries(m.openQuestions)}\n결정 사항\n${entries(m.decisions)}\n관련 논의\n${topics()}`;
  return `${head}\n\n핵심 요약\n${overview}다음 할 일\n${actions(false)}\n상세 회의 내용\n\n합의된 방향\n${entries(m.decisions)}${topics()}\n미확정 사항\n${entries(m.openQuestions)}`;
}

module.exports = { markdown, plainText };
