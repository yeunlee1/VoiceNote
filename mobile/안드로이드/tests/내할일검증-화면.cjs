// 휴대폰 결과 화면의 내 할 일 탭, 나 고르기·선택 지우기, 지난 회의 목록의 내 일 수를 모의 브리지로 검증한다.
module.exports = async ({ viewport, load, key, tap, evaluate, until, wait, shot, check }) => {
  const MEETING = '11111111-1111-1111-1111-111111111111';
  const js = value => JSON.stringify(value);
  const ACTIONS = "[{task:'출시 일정표 수정본 공유',owner:'박서연',due:'11월 12일'},{task:'전파 인증 진행 상황 확인',owner:'김민수',due:'11월 14일'},{task:'초도 물량 발주서 변경',owner:'박서연',due:'다음 주 화요일까지'},{task:'온라인 행사 대행사 견적 비교',owner:null,due:null}]";
  const item = (task, owner, due, done) => ({ task, owner, due, done });
  const FIRST_DONE = js({ 1234: { finalized: false, items: [item('출시 일정표 수정본 공유', '박서연', '11월 12일', true), item('전파 인증 진행 상황 확인', '김민수', '11월 14일', false), item('초도 물량 발주서 변경', '박서연', '다음 주 화요일까지', false), item('온라인 행사 대행사 견적 비교', null, null, false)] } });
  // 첫 일(박서연)을 이미 끝낸 수정본이다. 안 끝낸 일이 먼저 보이는지 본다.
  const myName = name => evaluate(`__mock.myName=${js(name)};window.__settingsBridgeForTest('saveSettings',{defaultOutputFormat:'meeting'}).then(()=>true)`);
  // 설정의 내 이름은 앱을 열 때 읽으므로, 모의 값을 바꾼 뒤 설정 저장 응답으로 화면에 다시 알린다.
  const prepare = async ({ query = '', name = '박서연', participants = '박서연, 김민수, 이도현', actions = ACTIONS, saved = '{}', extra = '' } = {}) => {
    await load(query); await key();
    await evaluate(`__mock.todoActions=${actions};__mock.todoParticipants=${js(participants)};__mock.savedTodos=${saved};${extra}`);
    await myName(name);
  };
  const press = selector => evaluate(`(()=>{const e=document.querySelector(${js(selector)});if(e)e.click();return !!e})()`);
  // 없을 수 있는 요소를 누른다. 없으면 다음 확인이 실패로 남고 검사 전체는 이어 간다.
  const opened = () => until("!document.getElementById('result').hidden");
  const openFirst = async () => { await tap('#history button'); await opened(); await wait(60); };
  const closeResult = async () => { await press('#close-result'); await wait(60); };
  const hideMessage = () => evaluate("(()=>{document.getElementById('message').hidden=true;return true})()");
  const calls = method => evaluate(`__mock.calls.filter(c=>c.method===${js(method)}).length`);
  const last = method => `(__mock.calls.filter(c=>c.method===${js(method)}).at(-1)?.data||{})`;
  const texts = selector => evaluate(`JSON.stringify([...document.querySelectorAll(${js(selector)})].map(e=>e.textContent))`);
  const message = () => evaluate("document.getElementById('message').hidden?'':document.getElementById('message').textContent");
  const selected = tab => `document.getElementById('tab-${tab}')?.getAttribute('aria-selected')==='true'&&!document.getElementById('panel-${tab}')?.hidden`;
  const addMeetings = () => evaluate("(()=>{for(let i=0;i<12;i++)__mock.history.push({id:'bbbbbbbb-0000-4000-8000-'+String(i).padStart(12,'0'),location:'main',resultId:'1234',date:'2026-10-'+String(10+i),dailySequence:1,title:'내 일 목록 '+i,state:'complete',outputFormat:'meeting',createdAt:1,audio:[]});return true})()");
  const toRecords = async () => { await press('#refresh'); await wait(80); await press('#tab-records'); await wait(80); };

  await viewport(390); await prepare({ saved: FIRST_DONE }); await openFirst();
  check('목록에서 회의를 열면 내 할 일 탭이 먼저 열린다', await evaluate(`(()=>{const $=id=>document.getElementById(id);return ${selected('mine')}&&$('tab-mine').tabIndex===0&&$('tab-minutes').getAttribute('aria-selected')==='false'&&$('panel-minutes').hidden&&$('panel-transcript').hidden&&document.querySelector('.result-actions').hidden&&!!$('result-more')&&$('result-more').hidden})()`));
  const firstRows = await texts('#panel-mine .mine-task');
  check('내 일만 안 끝낸 일부터 보이고 기한은 저장된 글자 그대로다', firstRows === js(['초도 물량 발주서 변경', '출시 일정표 수정본 공유']) && (await texts('#panel-mine .mine-due')) === js(['다음 주 화요일까지', '11월 12일']) && await evaluate("(()=>{const rows=document.querySelectorAll('#panel-mine .mine-row');return !rows[0].classList.contains('is-done')&&rows[1].classList.contains('is-done')&&document.querySelector('#panel-mine .mine-left')?.textContent==='1건 남음'&&document.querySelector('#panel-mine .me-name')?.textContent==='박서연'})()"), firstRows);
  const rest = await evaluate("document.querySelector('#panel-mine .mine-rest')?.textContent||''");
  await press('#panel-mine .mine-all');
  check('나머지 일의 수와 정리본으로 가는 단추가 있다', rest.includes('담당 미정 1건') && rest.includes('다른 사람 일 1건') && await evaluate(`${selected('minutes')}&&document.getElementById('panel-mine').hidden&&!document.querySelector('.result-actions').hidden&&document.activeElement===document.getElementById('tab-minutes')`), rest);
  await press('#tab-mine');

  const readsBefore = await calls('history');
  await evaluate(`document.querySelector('#panel-mine [data-todo-focus="mine:2"]')?.click()`);
  await until(`__mock.calls.filter(c=>c.method==='history').length>${readsBefore}`);
  const afterCheck = await texts('#panel-mine .mine-task');
  check('체크하면 원래 결과에 저장하고 줄이 아래로 내려가며 목록을 다시 읽는다', afterCheck === js(['출시 일정표 수정본 공유', '초도 물량 발주서 변경']) && await evaluate(`(()=>{const d=${last('saveTodos')},order=__mock.calls.map(c=>c.method);return d.location==='p1'&&d.id===${js(MEETING)}&&d.resultId==='1234'&&d.todos?.items?.[2]?.done===true&&order.lastIndexOf('history')>order.lastIndexOf('saveTodos')&&document.activeElement?.dataset?.todoFocus==='mine:2'&&document.querySelector('#panel-mine .mine-left')?.textContent==='모두 끝냄'})()`), afterCheck);

  await evaluate('__mock.todoFail=true');
  await evaluate(`document.querySelector('#panel-mine [data-todo-focus="mine:0"]')?.click()`);
  await until("!document.getElementById('message').hidden");
  check('체크 저장이 실패하면 되돌리고 알린다', await evaluate(`document.querySelector('#panel-mine [data-todo-focus="mine:0"]')?.checked===true&&document.getElementById('message').textContent.includes('디스크 오류')`));
  await evaluate('__mock.todoFail=false'); await hideMessage();

  await evaluate(`__mock.todoFailNext=1;document.querySelector('#panel-mine [data-todo-focus="mine:0"]')?.click();document.querySelector('#panel-mine [data-todo-focus="mine:2"]')?.click()`);
  const lastWins = `__mock.todoFailNext===0&&${last('saveTodos')}.todos?.items?.[0]?.done===false&&${last('saveTodos')}.todos?.items?.[2]?.done===false&&__mock.savedTodos['1234']?.items?.[0]?.done===false&&!document.querySelector('#panel-mine .mine-row.is-done')&&document.querySelectorAll('#panel-mine .mine-row').length===2`;
  const lastSaved = await until(lastWins); await wait(150);
  check('앞 저장만 실패해도 마지막으로 누른 값이 남는다', lastSaved && await evaluate(lastWins));
  await hideMessage(); await closeResult();

  // 할 일 저장이 끝나기 전에는 결과를 닫지 않고, 받아 둔 업데이트도 설치하지 않는다.
  await prepare({ query: '?update=ready' }); await openFirst();
  await evaluate(`__mock.delay=900;document.querySelector('#panel-mine [data-todo-focus="mine:0"]')?.click()`);
  await press('#close-result');
  check('저장 중에는 결과를 닫지 않고 알리며 업데이트 설치를 막는다', await evaluate("!document.getElementById('result').hidden&&document.getElementById('message').textContent.includes('저장하는 중')&&document.getElementById('update-action').disabled&&document.getElementById('update-lock').textContent.includes('저장하는 중')"));
  await until("!document.getElementById('update-action').disabled"); await evaluate('__mock.delay=0');

  // 설정에 내 이름이 없으면 이 회의에서 나를 묻는다.
  await prepare({ name: '' }); await openFirst();
  const lead = await evaluate("document.querySelector('#panel-mine .who-lead')?.textContent||''"), who = await texts('#panel-mine .who-button');
  await hideMessage(); await shot('내할일-390-나고르기.png');
  const picks = await calls('saveMe');
  await evaluate("document.querySelectorAll('#panel-mine .who-button')[1]?.click()");
  await until(`__mock.calls.filter(c=>c.method==='saveMe').length>${picks}&&document.getElementById('message').textContent.includes('김민수')`);
  check('나를 모르면 번호가 붙은 후보를 보여 주고 고르면 저장한다', lead === '이 회의에서 나는 누구인가요?' && who === js(['1박서연', '2김민수', '3이도현']) && await evaluate(`(()=>{const d=${last('saveMe')};return d.name==='김민수'&&d.location==='p1'&&d.id===${js(MEETING)}&&d.resultId==='1234'&&document.getElementById('message').textContent==='이 회의에서 나는 김민수입니다.'&&document.querySelector('#panel-mine .me-name')?.textContent==='김민수'})()`) && (await texts('#panel-mine .mine-task')) === js(['전파 인증 진행 상황 확인']), who);

  const unchanged = await calls('saveMe');
  await press('#panel-mine .me-change');
  const pressed = await evaluate(`document.querySelector('#panel-mine .who-button[aria-pressed="true"]')?.textContent||''`);
  await press('#panel-mine .who-button[aria-pressed="true"]'); await wait(60);
  check('바꾸기에서 눌린 이름을 다시 누르면 저장하지 않고 닫는다', pressed === '2김민수' && (await calls('saveMe')) === unchanged && await evaluate("!document.querySelector('#panel-mine .who-box')&&!!document.activeElement?.classList.contains('me-change')"), pressed);

  await press('#panel-mine .me-change'); await press('#panel-mine .who-clear');
  await until(`${last('saveMe')}.name===null&&document.getElementById('message').textContent==='고른 나를 지웠습니다.'`);
  check('선택 지우기는 고른 것을 지운다', await evaluate(`${last('saveMe')}.name===null&&__mock.me?.[${js(MEETING)}]===null&&!!document.querySelector('#panel-mine .who-lead')&&!document.querySelector('#panel-mine .me-name')&&document.activeElement===document.querySelector('#panel-mine .who-button')`));
  await closeResult();

  // 지금 결과의 후보에 없는 옛 선택은 적용되지 않지만 지울 수는 있어야 한다.
  await prepare({ extra: `__mock.me={${js(MEETING)}:'예전 담당자'}` }); await openFirst();
  const resolved = await evaluate("document.querySelector('#panel-mine .me-name')?.textContent||''");
  await press('#panel-mine .me-change');
  const canClear = await evaluate("!!document.querySelector('#panel-mine .who-clear')");
  await press('#panel-mine .who-clear');
  check('후보에서 사라진 옛 선택도 선택 지우기로 지울 수 있다', resolved === '박서연' && canClear && await until(`${last('saveMe')}.name===null&&__mock.me?.[${js(MEETING)}]===null`), resolved);
  await closeResult();

  await prepare({ name: '' }); await openFirst(); await evaluate('__mock.meFail=true');
  await press('#panel-mine .who-button');
  check('나 저장이 실패하면 되돌리고 알린다', await until("document.getElementById('message').textContent.includes('나를 저장하지 못했습니다')&&document.getElementById('message').textContent.includes('디스크 오류')") && await evaluate("!!document.querySelector('#panel-mine .who-lead')&&!document.querySelector('#panel-mine .me-name')&&!document.querySelector('#panel-mine .who-button:disabled')"));
  await evaluate('__mock.meFail=false'); await closeResult();

  // 나를 저장하는 사이 사용자가 패널 안의 다른 조작 요소로 옮긴 초점은, 다시 그린 뒤 같은 요소로 돌려준다.
  await prepare({ extra: `__mock.me={${js(MEETING)}:'김민수'}` }); await openFirst();
  await press('#panel-mine .me-change');
  await evaluate("(()=>{__mock.delay=900;const b=document.querySelector('#panel-mine .who-clear');b?.focus();b?.click();window.__moved=document.querySelector('#panel-mine [data-todo-focus=\"mine:0\"]');window.__moved?.focus();return true})()");
  check('나를 저장하는 사이 패널 안에서 옮긴 초점은 같은 조작 요소로 돌려준다', await until("!!window.__moved&&!window.__moved.isConnected&&document.activeElement?.dataset?.todoFocus==='mine:0'&&document.getElementById('message').textContent==='고른 나를 지웠습니다.'"), await evaluate("document.activeElement?.dataset?.todoFocus||document.activeElement?.tagName"));
  await evaluate('__mock.delay=0'); await closeResult();

  await prepare({ query: '?update=ready', name: '' }); await openFirst();
  await evaluate('__mock.delay=900'); await press('#panel-mine .who-button'); await press('#close-result');
  check('나를 저장하는 동안에는 결과를 닫지 않고 업데이트 설치를 막는다', await evaluate("!document.getElementById('result').hidden&&document.getElementById('message').textContent.includes('저장하는 중')&&document.getElementById('update-action').disabled&&document.getElementById('update-lock').textContent.includes('저장하는 중')"));
  await until("!document.getElementById('update-action').disabled"); await evaluate('__mock.delay=0');

  // 나를 고르거나 체크하면 목록을 다시 읽는다. 닫은 뒤 목록이 보던 자리에 있는지 본다.
  await prepare({ name: '' }); await addMeetings(); await toRecords();
  const listY = await evaluate("(()=>{document.querySelectorAll('#history button')[8].scrollIntoView({block:'center'});return Math.round(scrollY)})()");
  const listReads = await calls('history');
  await evaluate("document.querySelectorAll('#history button')[8].click()"); await opened(); await wait(60);
  await press('#panel-mine .who-button'); await until("!!document.querySelector('#panel-mine .me-name')&&!document.querySelector('#panel-mine .who-button:disabled')"); await wait(80);
  await evaluate(`document.querySelector('#panel-mine [data-todo-focus^="mine:"]')?.click()`); await wait(200);
  const listReadsAfter = await calls('history');
  await closeResult(); await wait(40);
  const listAfter = await evaluate('Math.round(scrollY)');
  check('나를 고르거나 체크해 목록을 다시 읽어도 닫은 뒤 목록이 보던 자리에 있다', listY > 0 && listReadsAfter >= listReads + 2 && Math.abs(listAfter - listY) <= 4, js({ listY, listAfter, listReads, listReadsAfter }));

  await prepare(); await evaluate('__mock.history[0].mineOpen=2'); await toRecords();
  const badge = await evaluate("(()=>{const first=document.querySelector('#history button'),count=first.querySelector('.state .mine-count'),label=first.querySelector('.state')?.lastElementChild;return {count:count?.textContent||'',total:document.querySelectorAll('#history .mine-count').length,above:!!count&&!!label&&label!==count&&count.getBoundingClientRect().bottom<=label.getBoundingClientRect().top+1,label:label?.textContent||''}})()");
  check('지난 회의 줄에 내 일 수를 형식 이름 위에 붙인다', badge.count === '내 일 2' && badge.total === 1 && badge.above && badge.label === '업무 정리', js(badge));
  await hideMessage(); await shot('내할일-390-목록.png');

  // 목록 끝의 회의를 열고 닫으면 그 줄이 아래쪽 탭에 가리지 않아야 한다.
  await prepare(); await addMeetings(); await toRecords();
  await evaluate('(()=>{window.scrollTo(0,document.documentElement.scrollHeight);return true})()'); await wait(60);
  await tap('#history button:last-of-type'); await opened(); await wait(60);
  await closeResult(); await wait(60);
  const back = await evaluate("(()=>{const row=[...document.querySelectorAll('#history button')].at(-1),r=row.getBoundingClientRect(),dock=document.querySelector('.dock').getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {focused:document.activeElement===row,bottom:Math.round(r.bottom),dock:Math.round(dock.top),hit:row.contains(hit)}})()");
  check('회의를 닫으면 그 줄에 초점이 가고 아래쪽 탭에 가리지 않는다', back.focused && back.bottom <= back.dock && back.hit, js(back));

  await prepare(); await openFirst();
  const versionTo = async id => { const before = await calls('open'); await evaluate(`(()=>{const s=document.getElementById('result-version');s.value=${js(id)};s.dispatchEvent(new Event('change'));return true})()`); await until(`__mock.calls.filter(c=>c.method==='open').length>${before}&&document.getElementById('result-version').value===${js(id)}`); await wait(60); };
  await versionTo('1233');
  const mineKept = await evaluate(selected('mine'));
  await press('#tab-transcript'); await versionTo('1234');
  check('결과 버전을 바꿔도 보던 탭에 머문다', mineKept && await evaluate(selected('transcript')));
  await closeResult();

  await prepare(); await openFirst(); await press('#tab-minutes');
  await evaluate("(()=>{__mock.refineOutcome='success';const c=document.getElementById('review-comment');c.value='담당자를 다시 보아 주세요.';c.dispatchEvent(new Event('input'));return true})()");
  await press('#refine'); await press('#tab-mine');
  check('의견 반영이 끝나 새 결과가 열리면 정리본 탭이다', await until(`document.getElementById('result-version').value==='1235'&&${selected('minutes')}`));
  await closeResult();

  // 내가 누구인지와 맡은 일이 있는지에 따라 같은 탭이 다른 말을 보여 준다.
  const cases = [
    ['맡은 일을 다 끝냄', { participants: '박서연', actions: "[{task:'가',owner:'박서연',due:null}]", saved: js({ 1234: { finalized: false, items: [item('가', '박서연', null, true)] } }) }, "document.querySelector('#panel-mine .mine-left')?.textContent==='모두 끝냄'&&document.querySelectorAll('#panel-mine .mine-row').length===1"],
    ['맡은 일이 없음', { participants: '박서연, 김민수', actions: "[{task:'가',owner:'김민수',due:null},{task:'나',owner:null,due:null}]" }, "document.querySelector('#panel-mine .mine-empty')?.textContent==='이 회의에서 내가 맡은 일은 없습니다.'&&!!document.querySelector('#panel-mine .mine-rest')?.textContent.includes('담당 미정 1건')&&!document.querySelector('#panel-mine .mine-left')"],
    ['내가 누구인지 모름', { participants: '박서연 대리, 김민수', actions: "[{task:'가',owner:'김민수',due:null}]" }, "document.querySelector('#panel-mine .who-lead')?.textContent==='이 회의에서 나는 누구인가요?'&&[...document.querySelectorAll('#panel-mine .who-button')].map(e=>e.textContent).join('|')==='1박서연 대리|2김민수'&&!document.querySelector('#panel-mine .mine-row,#panel-mine .who-clear')"],
    ['참석자도 담당자 이름도 없음', { participants: '', actions: "[{task:'가',owner:null,due:null},{task:'나',owner:null,due:null}]" }, "document.querySelector('#panel-mine .mine-empty')?.textContent==='참석자를 적지 않은 회의라 누가 맡았는지 알 수 없습니다.'&&!document.querySelector('#panel-mine .who-box')&&!!document.querySelector('#panel-mine .mine-all')"],
    ['참석자는 없고 담당자 이름만 있음', { participants: '', name: '', actions: "[{task:'가',owner:'김민수',due:null},{task:'나',owner:'박서연',due:null}]" }, "[...document.querySelectorAll('#panel-mine .who-button')].map(e=>e.textContent).join('|')==='김민수|박서연'&&!document.querySelector('#panel-mine .who-button .num')"],
    ['정리된 할 일이 없음', { participants: '', actions: '[]' }, "document.querySelector('#panel-mine .mine-empty')?.textContent==='이 회의에는 정리된 할 일이 없습니다.'&&!document.querySelector('#panel-mine .mine-all')"],
  ];
  const wrong = [];
  await prepare();
  for (const [label, { participants, actions, saved = '{}', name = '박서연' }, expect] of cases) {
    await evaluate(`__mock.todoActions=${actions};__mock.todoParticipants=${js(participants)};__mock.savedTodos=${saved}`); await myName(name);
    await tap('#history button'); await opened(); await wait(60);
    if (!(await evaluate(`${selected('mine')}&&(${expect})`))) wrong.push(label);
    await closeResult();
  }
  await tap('#history button:last-of-type'); await opened(); await wait(60);
  if (!(await evaluate(`document.getElementById('tab-mine')?.hidden===true&&${selected('minutes')}&&document.getElementById('panel-mine')?.hidden===true`))) wrong.push('정리본이 없는 회의');
  await closeResult();
  check('상태마다 다른 말로 보여 준다', wrong.length === 0, wrong.join(', '));

  await prepare({ extra: '__mock.todosUnreadable=true' }); await openFirst();
  const unreadableRows = await texts('#panel-mine .mine-task'), unreadableNote = await message();
  check('수정본을 읽지 못한 회의는 AI 결과로 내 일을 보여 주고 알린다', unreadableRows === js(['출시 일정표 수정본 공유', '초도 물량 발주서 변경']) && unreadableNote.includes('수정본을 읽지 못해'), unreadableNote);
  await evaluate('__mock.todosUnreadable=false'); await closeResult();

  // 누르는 곳의 크기와 가로 넘침을 폭마다 본다. 긴 글자는 2,000자 할 일과 200자 이름을 넣는다.
  const fits = "(()=>{const w=document.documentElement.clientWidth,res=document.getElementById('result'),out=[...document.querySelectorAll('#panel-mine *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.left<-0.5||r.right>w+0.5)}).length;return {over:document.documentElement.scrollWidth-w,inner:res.scrollWidth-res.clientWidth,out}})()";
  const LONG_TASK = '출시 일정표 수정본을 공유하고 확인을 받습니다 '.repeat(40).slice(0, 1700) + 'A'.repeat(300);
  const LONG_NAME = '박서연' + 'B'.repeat(197);
  for (const width of [360, 390, 412]) {
    await viewport(width); await prepare(); await openFirst();
    await hideMessage(); await shot(`내할일-${width}-내할일.png`);
    await press('#panel-mine .me-change');
    const sizes = await evaluate(`(()=>{const list=[...document.querySelectorAll('#result .result-tab:not([hidden])'),...document.querySelectorAll('#panel-mine .mine-row label'),...document.querySelectorAll('#panel-mine .who-button'),...document.querySelectorAll('#panel-mine .me-change,#panel-mine .mine-all')];const small=list.filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44}).map(e=>e.className+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height));return {n:list.length,small,...${fits}}})()`);
    check(width + 'px 누르는 곳은 44px 이상이고 가로로 넘치지 않는다', sizes.n >= 9 && sizes.small.length === 0 && sizes.over <= 0 && sizes.inner <= 0 && sizes.out === 0, js(sizes));
    await closeResult();
    await evaluate(`__mock.todoActions=${js([{ task: LONG_TASK, owner: '박서연', due: 'C'.repeat(200) }, { task: '남의 일', owner: LONG_NAME, due: null }])};__mock.todoParticipants=${js('박서연, ' + LONG_NAME)}`);
    await tap('#history button'); await opened(); await wait(60); await press('#panel-mine .me-change');
    const longPick = await evaluate(fits);
    await closeResult(); await myName(LONG_NAME); await tap('#history button'); await opened(); await wait(60);
    const longMe = await evaluate(fits);
    check(width + 'px 긴 글자도 줄을 바꿔 넘치지 않는다', [longPick, longMe].every(r => r.over <= 0 && r.inner <= 0 && r.out === 0) && await evaluate(`document.querySelector('#panel-mine .me-name')?.textContent===${js(LONG_NAME)}`), js({ longPick, longMe }));
    if (width === 390) { await hideMessage(); await shot('내할일-390-긴글자.png'); }
    await closeResult();
  }
  await evaluate('__mock.todoActions=null');
};
