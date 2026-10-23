// 회의 결과 기록을 사본 저장용 Markdown과 기호 없는 텍스트로 만든다. Android도 같은 공통 예시로 같은 결과를 시험한다.
const formats = require('./출력형식.js');

function markdown(record) {
  const m = record.minutes;
  const head = [`# ${record.title}`, '', ...(record.projectName ? [`프로젝트: ${record.projectName}`] : []), `날짜: ${record.date} · ${record.dailySequence || 1}차 회의`, `참석자: ${record.participants || '미입력'}`, ''];
  if (record.outputFormat === 'custom' && record.customFormat) return [...head, ...formats.customText(m, record.customFormat)].join('\n');
  const action = a => `- ${a.task} · 담당 ${a.owner || '미정'} · 기한 ${a.due || '미정'}`;
  const list = (title, items, format = x => `- ${x}`) => items.length ? [`## ${title}`, ...items.map(format), ''] : [];
  const topics = title => m.topics.length ? [`## ${title}`, '', ...m.topics.flatMap(t => [`### ${t.title}`, '', ...t.points.flatMap(p => [p, ''])])] : [];
  // 핵심 요약형과 업무 정리형은 내용이 있는 절만 남기고, 회의록형은 기존 순서를 그대로 쓴다.
  if (record.outputFormat === 'summary')
    return [...head, '## 핵심 요약', m.overview, '', ...topics('주요 내용'), ...list('결정 사항', m.decisions), ...list('후속 작업', m.actions, action), ...list('확인 필요', m.openQuestions)].join('\n');
  if (record.outputFormat === 'tasks')
    return [...head, '## 업무 요약', m.overview, '', '## 할 일', ...(m.actions.length ? m.actions.map(action) : ['- 확인된 할 일 없음']), '',
      ...list('미확정 항목', m.openQuestions), ...list('결정 사항', m.decisions), ...topics('참고 내용')].join('\n');
  return [...head,
    '## 핵심 요약', m.overview, '', '## 상세 회의 내용', '', '## 합의된 방향', ...m.decisions.flatMap(x => [x, '']),
    ...m.topics.flatMap(t => [`## ${t.title}`, '', ...t.points.flatMap(p => [p, ''])]), '## 다음 할 일',
    ...m.actions.map(a => `- ${a.task} · 담당 ${a.owner || '미정'} · 기한 ${a.due || '미정'}`), '',
    '## 미확정 사항', ...m.openQuestions.map(x => `- ${x}`), ''].join('\n');
}

// Android Store.format()·topics()·actions()·append()를 그대로 옮겼다. 두 앱의 .txt가 같아야 하므로 줄바꿈 하나도 따로 바꾸지 않는다.
function plainText(record) {
  const m = record.minutes;
  const entries = items => items.map(x => `${x}\n\n`).join('');
  const topics = () => m.topics.map(t => `\n${t.title}\n${entries(t.points)}`).join('');
  // 담당·기한이 비었을 때 미정으로 쓰는 것은 업무 정리형과 내 형식뿐이다.
  const actions = undecided => m.actions.map(a => `- ${a.task}${a.owner ? ` · 담당 ${a.owner}` : undecided ? ' · 담당 미정' : ''}${a.due ? ` · 기한 ${a.due}` : undecided ? ' · 기한 미정' : ''}\n`).join('');
  const head = `${record.title}\n\n${record.date} · ${record.dailySequence || 1}차 회의`;
  if (record.outputFormat === 'custom' && record.customFormat) {
    // 내 형식은 고른 항목만 고른 순서와 이름으로 쓰고, 내용이 없는 항목은 없음으로 남긴다.
    const custom = record.customFormat;
    return `${head} · ${custom.name}` + custom.sections.map(({ key, title }) => `\n\n${title}\n` + (
      key === 'overview' ? `${m.overview}\n`
        : key === 'topics' ? (m.topics.length ? topics() : '없음\n')
          : key === 'actions' ? (m.actions.length ? actions(true) : '- 없음\n')
            : m[key].length ? m[key].map(x => `- ${x}\n`).join('') : '- 없음\n')).join('');
  }
  if (record.outputFormat === 'summary')
    return `${head} · 핵심 요약\n\n핵심 요약\n${m.overview}\n\n주요 내용\n${topics()}\n합의된 방향\n${entries(m.decisions)}\n다음 할 일\n${actions(false)}\n미확정 사항\n${entries(m.openQuestions)}`;
  if (record.outputFormat === 'tasks')
    return `${head} · 업무 정리\n\n업무 요약\n${m.overview}\n\n할 일\n${actions(true)}\n확인 필요\n${entries(m.openQuestions)}\n결정 사항\n${entries(m.decisions)}\n관련 논의\n${topics()}`;
  return `${head}\n\n핵심 요약\n${m.overview}\n\n상세 회의 내용\n\n합의된 방향\n${entries(m.decisions)}${topics()}\n다음 할 일\n${actions(false)}\n미확정 사항\n${entries(m.openQuestions)}`;
}

module.exports = { markdown, plainText };
