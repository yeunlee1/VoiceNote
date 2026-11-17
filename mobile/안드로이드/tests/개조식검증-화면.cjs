// 휴대폰 결과 화면이 회의 결과를 개조식 목록(ul > li, 하위 항목은 그 li 안의 ul > li)으로 그리고, 옛 결과·긴 항목·형식 예시도 폭 안에서 보이는지 헤드리스 화면으로 검사한다.
module.exports = async ({ viewport, load, key, click, evaluate, wait, shot, check }) => {
  const I = (text, details = []) => ({ text, details });
  const Formats = require('../assets/formats.js');
  const flat = minutes => { const m = Formats.normalizeMinutes(minutes); return [...m.overview, ...m.topics.flatMap(topic => topic.points), ...m.decisions, ...m.openQuestions]; };
  // 화면에 그려진 항목마다 본문과 그 li 바로 아래 하위 항목 글까지 기대값과 같은지 본다. 개수만 보면 하위 설명이 빠져도 통과한다(짝보고 10).
  const missing = (tree, minutes) => flat(minutes).filter(item => !tree.some(drawn => JSON.stringify(drawn) === JSON.stringify(item))).map(item => item.text.slice(0, 20));
  const long = '가'.repeat(600);
  const fresh = { overview: [I('전체 방향', ['공통 양식부터 정리함']), I('주요 결정', ['시안 A 사용', '부서별 서식 폐기'])],
    topics: [{ title: '양식', points: [I('공통 양식 쓰기로 함', ['이유: 부서마다 서식이 달라 혼선']), I('옛 양식은 보관만 함\n새로 만들지는 않음')] }],
    decisions: [I('양식 — 공통 양식 사용', ['적용: 모든 부서']), I(long, [long])], actions: [], openQuestions: [I('배포 시점', ['정해지지 않으면 12월 보고서 일정이 밀림'])] };
  const old = { overview: Array.from({ length: 13 }, (_, i) => `줄 ${i + 1}`).join('\n'), topics: [{ title: '긴 내용', points: ['나'.repeat(2000)] }], decisions: ['- 결정'], actions: [], openQuestions: ['미정'] };
  const inspect = root => evaluate(`(()=>{const root=document.getElementById(${JSON.stringify(root)});const items=[...root.querySelectorAll('ul.items > li')];
    return {items:items.length,nested:root.querySelectorAll('ul.items > li > ul.item-details > li').length,texts:items.map(li=>li.querySelector(':scope > .item-text').textContent),tree:items.map(li=>({text:li.querySelector(':scope > .item-text').textContent,details:[...li.querySelectorAll(':scope > ul.item-details > li')].map(d=>d.textContent)})),
      labels:[...root.querySelectorAll('.item-label')].map(n=>n.textContent),paragraphs:[...root.querySelectorAll('p')].filter(p=>/공통 양식|배포 시점|전체 방향|줄 1|결정/.test(p.textContent)).length,
      object:root.textContent.includes('[object Object]'),visible:root.getClientRects().length>0,page:document.documentElement.scrollWidth>innerWidth,wide:[...root.querySelectorAll('li')].some(li=>li.scrollWidth>li.clientWidth+1)}})()`);
  for (const width of [360, 390, 412]) {
    await viewport(width); await load(); await key();
    await evaluate(`__mock.minutesOverride=${JSON.stringify(fresh)}`);
    await click('#history button'); await wait(60);
    const now = await inspect('minutes');
    check(`${width}px 개조식 결과는 ul > li와 그 li 안의 ul > li로 그린다`, now.visible && now.nested >= 6 && now.paragraphs === 0 && !now.object, JSON.stringify({ items: now.items, nested: now.nested, paragraphs: now.paragraphs }));
    check(`${width}px 핵심 요약은 머리말만 굵게 보인다`, JSON.stringify(now.labels) === JSON.stringify(['전체 방향', '주요 결정']), JSON.stringify(now.labels));
    check(`${width}px 새 결과의 핵심 요약·주제·결정·미확정이 본문과 하위 항목 글까지 그대로 보인다`, missing(now.tree, fresh).length === 0, JSON.stringify(missing(now.tree, fresh)));
    check(`${width}px 여러 줄 항목은 한 항목 안에서 줄을 바꾼다`, now.texts.includes('옛 양식은 보관만 함\n새로 만들지는 않음'));
    check(`${width}px 600자 항목과 하위 항목도 가로로 넘치지 않는다`, !now.page && !now.wide, JSON.stringify({ page: now.page, wide: now.wide }));
    await shot(`개조식-${width}-새결과.png`);
    await evaluate("document.querySelector('#minutes ul.items:last-of-type')?.scrollIntoView()"); await shot(`개조식-${width}-새결과-아래.png`);
    await click('#close-result');
    await evaluate(`__mock.minutesOverride=${JSON.stringify(old)}`);
    await click('#history button'); await wait(60);
    const before = await inspect('minutes');
    check(`${width}px 옛 결과도 항목 하나씩 그린다(13줄 핵심 요약 13개, 앞 기호는 뗌)`, ['줄 1', '줄 13', '결정', '미정'].every(text => before.texts.includes(text)) && before.texts.filter(text => /^줄 \d+$/.test(text)).length === 13, JSON.stringify(before.texts.slice(0, 3)));
    check(`${width}px 옛 결과도 항목 바꾸기 규칙대로 모든 항목이 보인다`, missing(before.tree, old).length === 0, JSON.stringify(missing(before.tree, old)));
    check(`${width}px 옛 2000자 문단은 자르지 않고 폭 안에서 줄바꿈한다`, before.texts.some(text => text.length === 2000) && !before.page && !before.wide);
    await shot(`개조식-${width}-옛결과.png`);
    await click('#close-result');
    await evaluate('__mock.minutesOverride=null');
    await click('#tab-new'); await evaluate("document.getElementById('prep').hidden&&document.getElementById('prepare').click()");
    // 형식 예시는 새 회의 화면의 회의 준비 안에 있다. 접혀 있으면 펼친 뒤 예시를 연다.
    await click('#format-help'); await wait(60);
    for (const format of ['meeting', 'summary', 'tasks']) {
      await evaluate(`(()=>{const s=document.getElementById('output-format');s.value=${JSON.stringify(format)};s.dispatchEvent(new Event('change'));})()`); await wait(60);
      const example = await inspect('format-example-body');
      check(`${width}px ${format} 형식 예시도 항목·하위 항목 목록으로 보인다`, example.visible && missing(example.tree, Formats.SAMPLE.minutes).length === 0 && example.paragraphs === 0 && !example.object && !example.page && !example.wide, JSON.stringify({ items: example.items, nested: example.nested }));
    }
    await evaluate("document.getElementById('format-example').scrollIntoView()"); await shot(`개조식-${width}-형식예시.png`);
    await evaluate(`(()=>{const s=document.getElementById('output-format');s.value='meeting';s.dispatchEvent(new Event('change'));})()`);
    await click('#format-help'); await click('#tab-records');
  }
};
