// 휴대폰 새 회의 화면의 녹음 파일 불러오기 단추를 모의 브리지로 검증한다(잠금, 선택 중 잠금, 취소, 거절 안내, 시작 뒤 진행 화면, 곧바로 실패, 좁은 폭).
module.exports = async ({ viewport, load, key, tap, evaluate, until, wait, shot, check }) => {
  const js = value => JSON.stringify(value);
  const FILLED = js(['거래처 통화', '김민수, 박서연', '계약 조건 재확인']);
  const buttons = () => evaluate("(()=>{const b=document.getElementById('import-audio');return b?{exists:true,disabled:b.disabled,shown:!b.closest('[hidden]'),start:document.getElementById('start').disabled}:{exists:false}})()");
  const fill = () => evaluate("(()=>{for(const [id,v] of [['title','거래처 통화'],['participants','김민수, 박서연'],['notes','계약 조건 재확인']]){const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}return true})()");
  const fields = () => evaluate("JSON.stringify(['title','participants','notes'].map(id=>document.getElementById(id).value))");
  const mode = (name, delay = 0) => evaluate(`__mock.importMode=${js(name)};__mock.importDelay=${delay};true`);
  const workflow = text => until(`document.getElementById('workflow').textContent.includes(${js(text)})`);
  const press = () => evaluate("(()=>{const e=document.getElementById('import-audio');if(e)e.click();return !!e})()");
  // 단추가 없으면 누르지 않는다. 그때는 아래 확인이 실패로 남고 다른 검사는 이어 간다.
  const attempt = () => evaluate("__mock.calls.filter(c=>c.method==='importAudio').at(-1)?.data?.attemptId||''");
  const serviceState = async (active, meeting) => evaluate(`__mock.active=${active};__mock.meeting=Object.assign(${js(meeting)},{attemptId:${js(await attempt())},createdAt:Date.now()});true`);
  // 서비스가 이번 불러오기의 시도 번호를 실은 상태를 내놓는 것을 흉내 낸다.

  await viewport(390); await load();
  let s = await buttons();
  check('키가 없으면 녹음 파일 불러오기 단추가 회의 시작과 함께 잠긴다', s.exists && s.disabled && s.start, js(s));
  await key(); s = await buttons();
  check('키를 등록하면 녹음 파일 불러오기 단추가 풀린다', s.exists && !s.disabled && !s.start && s.shown, js(s));

  await fill(); await mode('cancel', 400); await evaluate("document.getElementById('message').hidden=true;true");
  await press(); await wait(80); s = await buttons();
  check('파일 선택 창이 열린 동안에는 회의 시작과 불러오기 단추가 모두 잠긴다', s.exists && s.disabled && s.start, js(s));
  await wait(500);
  check('고르기를 취소하면 칸 값이 그대로이고 오류 안내가 없다', await fields() === FILLED && await evaluate("document.getElementById('message').hidden"), await fields());

  await mode('reject'); await press();
  const rejected = await until("!document.getElementById('message').hidden&&document.getElementById('message').textContent.includes('m4a 녹음 파일만')");
  check('받을 수 없는 파일이면 그 안내를 보여 주고 칸 값은 그대로다', rejected && await fields() === FILLED, await fields());
  await evaluate("document.getElementById('message').hidden=true;true");

  await mode('ok'); await press();
  const sent = await until("__mock.calls.filter(c=>c.method==='importAudio').length===3");
  const data = sent ? await evaluate("__mock.calls.filter(c=>c.method==='importAudio').at(-1).data") : {};
  check('불러오기 요청에 회의명·날짜·참석자·상세 내용·출력 형식과 시도 번호를 싣는다', data.title === '거래처 통화' && /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') && data.participants === '김민수, 박서연' && data.notes === '계약 조건 재확인' && data.outputFormat === 'meeting' && /^[0-9a-f-]{36}$/.test(data.attemptId || ''), js(data));
  const preparing = await workflow('녹음 파일을 준비하는 중');
  s = await buttons();
  check('시작되면 진행 문구를 보여 주고 불러오기 단추를 감추며, 회의가 만들어지기 전에는 칸 값과 초안을 지우지 않는다', preparing && await fields() === FILLED && !s.shown && await evaluate("__mock.draft.title==='거래처 통화'"), js({ fields: await fields(), s, draft: await evaluate('__mock.draft') }));
  await shot('모바일-390-녹음파일불러오기-준비중.png');
  await serviceState(false, { state: 'failed', message: '파일을 읽지 못했습니다. 다시 골라 주세요.' });
  check('회의를 만들기 전에 담기가 실패하면 그 안내를 보여 주고 작성한 칸 값을 그대로 돌려준다', await workflow('파일을 읽지 못했습니다') && await until(`${js(FILLED)}===JSON.stringify(['title','participants','notes'].map(id=>document.getElementById(id).value))&&!document.getElementById('import-wrap').hidden`), await fields());

  await mode('ok'); await press(); await workflow('녹음 파일을 준비하는 중');
  await serviceState(true, { id: '55555555-5555-4555-8555-555555555555', location: 'main', state: 'analyzing', message: '음성 저장 완료 · 분석을 시작합니다.' }); await evaluate('__mock.draft={};true');
  check('회의가 만들어지면 그때 칸을 비운다', await until("['title','participants','notes'].every(id=>document.getElementById(id).value==='')"), await fields());
  // 서비스가 조각을 다 담아 회의를 만들고(상태에 이번 시도의 id가 생김) 네이티브가 초안을 지운 순간을 흉내 낸다.
  await evaluate("__mock.active=false;__mock.meeting={};true");

  await load(); await key(); await fill(); await mode('stale'); await press(); await wait(1700);
  check('시작 직후 상태에 앞선 회의 id가 남아 있어도 이번 회의로 보지 않고 칸 값을 지우지 않는다', await fields() === FILLED, await fields());
  await serviceState(true, { state: 'analyzing', message: '녹음 파일을 준비하는 중' }); await workflow('녹음 파일을 준비하는 중');
  await serviceState(false, { state: 'failed', message: '파일을 읽지 못했습니다. 다시 골라 주세요.' });
  check('앞선 회의 id를 받은 뒤 이번 불러오기가 실패해도 작성한 칸 값을 그대로 돌려준다', await workflow('파일을 읽지 못했습니다') && await fields() === FILLED, await fields());

  await load(); await key(); await fill(); await mode('late'); await press(); await wait(1700);
  const waiting = await evaluate("({workflow:document.getElementById('workflow').textContent,state:document.getElementById('record-state').textContent,stage:document.querySelector('#stage [aria-current]')?.dataset.stage,importHidden:document.getElementById('import-wrap').hidden,start:document.getElementById('start').disabled})");
  check('서비스가 아직 시작되지 않은 상태를 받아도 불러오기를 끝난 것으로 보지 않고 준비 중으로 보여 준다', waiting.workflow.includes('녹음 파일을 준비하는 중') && waiting.state === '분석 중' && waiting.stage === 'analyze' && waiting.importHidden && waiting.start && await fields() === FILLED, js({ waiting, fields: await fields() }));
  await serviceState(true, { state: 'analyzing', message: '녹음 파일을 준비하는 중' }); await workflow('녹음 파일을 준비하는 중');
  await serviceState(true, { id: '66666666-6666-4666-8666-666666666666', location: 'main', state: 'analyzing', message: '음성 저장 완료 · 분석을 시작합니다.' });
  check('늦게 시작된 서비스가 이번 회의를 만들면 그때 칸을 비운다', await until("['title','participants','notes'].every(id=>document.getElementById(id).value==='')"), await fields());
  await evaluate("__mock.active=false;__mock.meeting={};true");

  const ended = () => evaluate("JSON.stringify({workflow:document.getElementById('workflow').textContent,state:document.getElementById('record-state').textContent,result:!document.getElementById('result').hidden,opened:__mock.calls.filter(c=>c.method==='open').at(-1)?.data?.id||'',fields:['title','participants','notes'].map(id=>document.getElementById(id).value),importShown:!document.getElementById('import-wrap').hidden})");
  for (const [state, id, message, label] of [['complete', '77777777-7777-4777-8777-777777777777', '회의록을 저장했습니다.', '보관 완료'], ['failed', '88888888-8888-4888-8888-888888888888', 'AI 서버 응답이 늦어 중단했습니다. 잠시 후 지난 회의에서 다시 분석하세요. 녹음은 저장되어 있습니다.', '확인 필요']]) {
    await load(); await key(); await fill(); await mode('late'); await press(); await wait(1700);
    await evaluate(`__mock.history.push({id:${js(id)},location:'main',date:'2026-11-13',dailySequence:2,title:'거래처 통화',state:${js(state)},createdAt:Date.now(),audio:['원음-001.m4a']});true`);
    await serviceState(false, { id, location: 'main', state, message });
    await until("!document.getElementById('result').hidden");
    const end = JSON.parse(await ended());
    check(`진행 상태를 보기 전에 이번 불러오기가 ${state === 'complete' ? '완료' : '실패'}로 끝나도 그 안내를 보여 주고 그 회의를 열며 칸을 비운다`, end.workflow.includes(message.slice(0, 12)) && end.state === label && end.result && end.opened === id && end.fields.every(v => v === '') && end.importShown, js(end));
    // 서비스가 회의를 만들고 분석까지 끝낸 뒤에야 화면이 첫 상태를 받는 순서다. 앞선 진행 상태를 못 봤어도 이번 시도의 끝 상태면 녹음 뒤 분석이 끝났을 때와 같이 처리한다. 결과가 열려 있는 동안 회의 시작이 잠기는 것은 원래 동작이라 불러오기 추적이 끝났는지는 불러오기 단추가 다시 보이는지로 본다.
  }

  await load(); await key(); await fill(); await mode('failFast'); await press();
  check('회의를 만들기 전에 곧바로 실패해도 첫 상태 조회에서 그 안내를 보여 주고 칸 값을 지우지 않는다', await workflow('저장 공간이 부족') && await fields() === FILLED, await evaluate("JSON.stringify([document.getElementById('workflow').textContent,['title','participants','notes'].map(id=>document.getElementById(id).value)])"));

  for (const width of [360, 390]) {
    await viewport(width); await load(); await key();
    const box = await evaluate("(()=>{const button=document.getElementById('import-audio'),help=document.getElementById('import-help');if(!button||!help)return null;const b=button.getBoundingClientRect(),h=help.getBoundingClientRect();return {height:Math.round(b.height),right:Math.ceil(Math.max(b.right,h.right)),width:innerWidth,scroll:document.documentElement.scrollWidth}})()");
    check(`${width}폭에서 불러오기 단추와 설명이 넘치지 않고 단추 높이가 44px 이상이다`, !!box && box.height >= 44 && box.right <= box.width && box.scroll <= box.width, js(box));
    await shot(`모바일-${width}-녹음파일불러오기.png`);
  }
};
