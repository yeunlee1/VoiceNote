// 휴대폰 결과 화면의 내 할 일 탭, 나 고르기·선택 지우기, 지난 회의 목록의 내 일 수를 모의 브리지로 검증한다.
module.exports = async ({ viewport, load, key, tap, evaluate, until, wait, shot, check }) => {
  const MEETING = '11111111-1111-1111-1111-111111111111';
  const js = value => JSON.stringify(value);
  const ACTIONS = "[{task:'출시 일정표 수정본 공유',owner:'박서연',due:'11월 12일'},{task:'전파 인증 진행 상황 확인',owner:'김민수',due:'11월 14일'},{task:'초도 물량 발주서 변경',owner:'박서연',due:'다음 주 화요일까지'},{task:'온라인 행사 대행사 견적 비교',owner:null,due:null}]";
  const item = (task, owner, due, done) => ({ task, owner, due, done });
  const FIRST_DONE = js({ 1234: { finalized: false, items: [item('출시 일정표 수정본 공유', '박서연', '11월 12일', true), item('전파 인증 진행 상황 확인', '김민수', '11월 14일', false), item('초도 물량 발주서 변경', '박서연', '다음 주 화요일까지', false), item('온라인 행사 대행사 견적 비교', null, null, false)] } });
  // 첫 일(박서연)을 이미 끝낸 수정본이다. 안 끝낸 일이 먼저 보이는지 본다.
  const myName = name => evaluate(`window.__settingsBridgeForTest('saveSettings',{myName:${js(name)}}).then(()=>true)`);
  // 설정의 내 이름은 앱을 열 때 읽으므로, 설정 저장 요청으로 모의 값을 바꾸고 그 응답으로 화면에 다시 알린다.
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

  // 짝 검증 3의 A-3. 체크 저장이 실패해 되돌릴 때, 그사이 패널 밖으로 옮긴 초점은 빼앗지 않는다.
  await prepare(); await openFirst();
  await evaluate(`(()=>{__mock.todoFail=true;__mock.delay=900;const c=document.querySelector('#panel-mine [data-todo-focus="mine:0"]');c?.focus();c?.click();document.getElementById('tab-mine').focus();__mock.delay=0;return true})()`);
  await until("document.getElementById('message').textContent.includes('디스크 오류')"); await wait(60);
  check('체크 저장이 실패하는 사이 패널 밖으로 옮긴 초점은 빼앗지 않는다', await evaluate(`document.activeElement===document.getElementById('tab-mine')&&document.querySelector('#panel-mine [data-todo-focus="mine:0"]')?.checked===false`), await evaluate("document.activeElement?.id||document.activeElement?.dataset?.todoFocus||document.activeElement?.tagName"));
  await evaluate('__mock.todoFail=false'); await hideMessage(); await closeResult();

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
  const LONG_TASK = '출시 일정표 수정본을 공유하고 확인을 받습니다 '.repeat(80).slice(0, 1700) + 'A'.repeat(300);
  check('긴 글자 확인의 할 일은 할 일 상한인 2,000자다', LONG_TASK.length === 2000, String(LONG_TASK.length));
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

  // 사람별 할 일 복사: 담당자가 있는 남은 일이 있으면 내 일 아래와 정리본 할 일 아래에서 창을 연다.
  await viewport(390); await prepare(); await openFirst();
  const inMine = await evaluate("!!document.querySelector('#panel-mine .share-open')");
  await press('#tab-minutes');
  const inMinutes = await evaluate("!!document.querySelector('#minutes .todo-share')");
  await closeResult(); await myName(''); await openFirst();
  const whenUnknown = await evaluate("!!document.querySelector('#panel-mine .who-box')&&!!document.querySelector('#panel-mine .share-open')");
  check('사람별 할 일 복사는 내 일 아래와 정리본 할 일 아래에 있고 나를 몰라도 보인다', inMine && inMinutes && whenUnknown, js({ inMine, inMinutes, whenUnknown }));
  await closeResult();
  await evaluate(`__mock.savedTodos=${js({ 1234: { finalized: false, items: [item('출시 일정표 수정본 공유', '박서연', '11월 12일', true), item('전파 인증 진행 상황 확인', '김민수', '11월 14일', true), item('초도 물량 발주서 변경', '박서연', '다음 주 화요일까지', true), item('온라인 행사 대행사 견적 비교', null, null, false)] } })}`);
  await myName('박서연'); await openFirst();
  const noneInMine = await evaluate("!document.querySelector('#panel-mine .share-open')"); await press('#tab-minutes');
  check('담당자가 있는 남은 일이 없으면 감춘다', noneInMine && await evaluate("!document.querySelector('#minutes .todo-share')"));
  await closeResult(); await evaluate('__mock.savedTodos={}');

  const firstCopy = "document.querySelectorAll('#share-list .copy-row')[0]?.querySelector('.copy-button')";
  await openFirst(); await press('#panel-mine .share-open');
  const shareRows = await evaluate("JSON.stringify([...document.querySelectorAll('#share-list .copy-row')].map(r=>[r.querySelector('.num')?.textContent||'',r.querySelector('.copy-name')?.textContent||'',r.querySelector('.copy-count')?.textContent||'']))");
  check('복사 창은 남은 일이 있는 사람만 번호순으로 보여 주고 나는 (나)로 표시한다', await evaluate("document.getElementById('share')?.open===true") && shareRows === js([['1', '박서연 (나)', '2건'], ['2', '김민수', '1건']]), shareRows);
  await evaluate("document.querySelectorAll('#share-list .copy-show')[1]?.click()");
  check('보기를 누르면 그 사람에게 갈 글을 보여 준다', await evaluate(`document.getElementById('share-preview-title')?.textContent==='김민수 님에게 갈 글'&&document.getElementById('share-preview')?.textContent===${js('[옛 첫째] 2026-10-23\n김민수 님이 맡은 일 1건\n- 전파 인증 진행 상황 확인 · 기한 11월 14일')}&&document.querySelectorAll('#share-list .copy-row')[1]?.dataset.current==='true'&&document.querySelectorAll('#share-list .copy-show')[1]?.getAttribute('aria-pressed')==='true'`));
  await evaluate(`(()=>{window.__copy=${firstCopy};window.__copy?.focus();window.__copy?.click();return true})()`);
  const SHARE_TEXT = '[옛 첫째] 2026-10-23\n박서연 님이 맡은 일 2건\n- 출시 일정표 수정본 공유 · 기한 11월 12일\n- 초도 물량 발주서 변경 · 기한 다음 주 화요일까지';
  check('복사하면 정해진 모양의 글을 넘기고 복사함으로 바꾼다', await until(`__mock.copied===${js(SHARE_TEXT)}&&!!window.__copy?.isConnected&&window.__copy.textContent==='복사함'&&document.activeElement===window.__copy&&document.getElementById('share-status').textContent==='박서연 님 할 일을 복사했습니다. 메신저에 붙여 넣으세요.'`), await evaluate('String(__mock.copied)'));
  await press('[data-close=share]'); await press('#panel-mine .share-open');
  check('창을 닫았다 열면 복사함 표시가 지워진다', await evaluate("document.querySelectorAll('#share-list .copy-button').length===2&&[...document.querySelectorAll('#share-list .copy-button')].every(b=>b.textContent==='복사')&&document.getElementById('share-status').textContent===''"));
  await evaluate('__mock.copyFail=true'); await evaluate(`${firstCopy}?.click()`);
  check('복사에 실패하면 알리고 복사함으로 바꾸지 않는다', await until("document.getElementById('share-status')?.textContent.includes('복사하지 못했습니다')") && await evaluate(`${firstCopy}?.textContent==='복사'`));
  await evaluate('__mock.copyFail=false'); await press('[data-close=share]'); await closeResult();
  // 짝 검증 3의 A-1. 닫았다 다시 연 복사 창에 이전 창에서 누른 복사의 늦은 응답이 나타나면 안 된다.
  await openFirst(); await press('#panel-mine .share-open');
  await evaluate(`(()=>{__mock.delay=900;${firstCopy}?.click();__mock.delay=0;return true})()`);
  await press('[data-close=share]'); await press('#panel-mine .share-open'); await wait(1100);
  check('복사 창을 닫았다 다시 열면 그 사이 끝난 이전 복사는 새 창에 표시하지 않는다', await evaluate("document.getElementById('share').open&&document.getElementById('share-status').textContent===''&&[...document.querySelectorAll('#share-list .copy-button')].every(b=>b.textContent==='복사')"), await evaluate("document.getElementById('share-status').textContent"));
  await press('[data-close=share]'); await closeResult();
  // 짝 검증 3의 A-2. 나를 저장하는 사이 연 설정 창을 닫으면, 응답으로 다시 그린 같은 단추(설정에 내 이름 적어 두기)로 돌아간다.
  await prepare({ name: '', extra: `__mock.me={${js(MEETING)}:'김민수'}` }); await openFirst(); await press('#panel-mine .me-change');
  await evaluate("(()=>{__mock.delay=900;document.querySelector('#panel-mine .who-clear')?.click();window.__opener=document.querySelector('#panel-mine .who-settings');window.__opener?.focus();window.__opener?.click();__mock.delay=0;return true})()");
  await until('!!window.__opener&&!window.__opener.isConnected'); await press('#close-settings'); await wait(60);
  check('나를 저장하는 사이 연 설정 창을 닫으면 다시 그린 같은 단추로 돌아간다', await evaluate("!document.getElementById('settings').open&&document.activeElement?.dataset?.todoFocus==='who-settings'&&document.activeElement.isConnected"), await evaluate("document.activeElement?.dataset?.todoFocus||document.activeElement?.id||document.activeElement?.tagName"));
  await closeResult(); await prepare();
  await evaluate(`__mock.todoActions=${js(Array.from({ length: 60 }, (_, i) => ({ task: '가'.repeat(1990) + i, owner: '박서연', due: null })))}`);
  await openFirst(); await press('#panel-mine .share-open'); await evaluate(`${firstCopy}?.click()`);
  check('10만 자를 넘는 글은 실패로 알린다', await until("document.getElementById('share-status')?.textContent.includes('입력이 너무 큽니다')") && await evaluate(`${firstCopy}?.textContent==='복사'`));
  await press('[data-close=share]'); await closeResult(); await evaluate(`__mock.todoActions=${ACTIONS}`);
  await myName(''); await openFirst(); await press('#panel-mine .who-button');
  await until("!document.getElementById('message').hidden&&document.getElementById('message').textContent==='이 회의에서 나는 박서연입니다.'");
  await press('#panel-mine .share-open');
  check('알림이 떠 있을 때 복사 창을 열면 알림을 치운다', await evaluate("document.getElementById('share')?.open===true&&document.getElementById('message').hidden"));
  await press('[data-close=share]'); await closeResult(); await myName('박서연');
  for (const width of [360, 390, 412]) {
    await viewport(width); await openFirst(); await press('#panel-mine .share-open'); await hideMessage();
    const sheet = await evaluate("(()=>{const d=document.getElementById('share');if(!d)return {open:false};const r=d.getBoundingClientRect(),w=document.documentElement.clientWidth;return {open:d.open,left:Math.round(r.left),right:Math.round(r.right),w,inner:d.scrollWidth-d.clientWidth,out:[...d.querySelectorAll('*')].filter(e=>{const q=e.getBoundingClientRect();return q.width>0&&(q.left<r.left-0.5||q.right>r.right+0.5)}).length,small:[...d.querySelectorAll('button')].filter(b=>{const q=b.getBoundingClientRect();return q.width<44||q.height<44}).map(b=>b.textContent)}})()");
    check(width + 'px 복사 창은 화면 안에 들어오고 가로로 넘치지 않는다', sheet.open && sheet.left >= 0 && sheet.right <= sheet.w && sheet.inner <= 0 && sheet.out === 0 && sheet.small.length === 0, js(sheet));
    await shot(`내할일-${width}-복사창.png`);
    await press('[data-close=share]'); await closeResult();
  }

  // 텍스트 파일로 저장: 정리본 탭에서만 보이고, 글은 네이티브가 저장된 결과로 만든다.
  await viewport(390); await prepare(); await openFirst();
  const saveOnMine = await evaluate("!document.getElementById('save-text')?.getClientRects().length"); await press('#tab-transcript');
  const saveOnTranscript = await evaluate("!document.getElementById('save-text')?.getClientRects().length"); await press('#tab-minutes');
  const saveOnMinutes = await evaluate("!!document.getElementById('save-text')?.getClientRects().length&&!document.getElementById('save-text').disabled");
  check('텍스트 파일로 저장은 정리본 탭에만 있다', saveOnMine && saveOnTranscript && saveOnMinutes, js({ saveOnMine, saveOnTranscript, saveOnMinutes }));
  await hideMessage(); await shot('내할일-390-정리본저장.png');
  await press('#save-text'); await until("__mock.calls.some(c=>c.method==='saveText')");
  check('누르면 회의와 결과만 가리켜 요청하고 글은 싣지 않는다', await evaluate(`(()=>{const d=${last('saveText')};return !('text' in d)&&d.location==='p1'&&d.id===${js(MEETING)}&&d.resultId==='1234'})()`));
  check('저장이 끝나면 알린다', await until("!document.getElementById('message').hidden&&document.getElementById('message').textContent.includes('저장했습니다')"));
  await hideMessage(); await evaluate('__mock.saveTextCancel=true'); await press('#save-text'); await wait(200);
  check('취소하면 아무것도 알리지 않는다', await evaluate("document.getElementById('message').hidden&&__mock.calls.filter(c=>c.method==='saveText').length===2"));
  await evaluate('__mock.saveTextCancel=false;__mock.saveTextFail=true'); await press('#save-text');
  check('실패하면 실패했다고 알린다', await until("!document.getElementById('message').hidden&&document.getElementById('message').textContent.includes('저장하지 못했습니다')"));
  await evaluate('__mock.saveTextFail=false'); await closeResult();

  // 설정의 내 이름: AI 연결 다음 구역이고, 저장하면 지난 회의 목록과 열린 내 할 일을 다시 계산한다.
  await prepare(); await press('#open-settings'); await wait(40);
  const layout = await evaluate("JSON.stringify({nav:[...document.querySelectorAll('#settings [data-settings-section]')].map(b=>b.dataset.settingsSection),sections:[...document.querySelectorAll('#settings .settings-section')].map(s=>s.id)})");
  const filled = await evaluate("document.getElementById('my-name')?.value||''"), readsBeforeName = await calls('history');
  await evaluate("(()=>{const i=document.getElementById('my-name');if(!i)return false;i.value='  김민수  ';i.dispatchEvent(new Event('input'));return true})()"); await press('#my-name-save');
  check('설정의 내 이름은 AI 연결 다음에 있고 저장하면 목록과 내 할 일을 다시 계산한다', layout === js({ nav: ['ai', 'me', 'format', 'storage', 'file'], sections: ['settings-ai', 'settings-me', 'settings-format', 'settings-storage', 'settings-file'] }) && filled === '박서연' && await until(`${last('saveSettings')}.myName==='김민수'&&__mock.calls.filter(c=>c.method==='history').length>${readsBeforeName}&&document.getElementById('my-name-status')?.textContent==='내 이름을 저장했습니다.'&&document.getElementById('my-name').value==='김민수'`), layout);
  await press('#close-settings');
  await myName(''); await openFirst(); await press('#panel-mine .who-settings'); await wait(60);
  const fromWho = await evaluate("document.getElementById('settings').open&&document.activeElement===document.getElementById('my-name')");
  await evaluate("(()=>{const i=document.getElementById('my-name');if(!i)return false;i.value='박서연';i.dispatchEvent(new Event('input'));return true})()"); await press('#my-name-save');
  await until("document.getElementById('my-name-status')?.textContent==='내 이름을 저장했습니다.'"); await press('#close-settings'); await wait(60);
  check('나 고르기 상자에서 설정의 내 이름 칸으로 갈 수 있다', fromWho && await evaluate("document.querySelector('#panel-mine .me-name')?.textContent==='박서연'&&!document.querySelector('#panel-mine .who-box')&&!!document.activeElement?.classList.contains('me-change')"), js({ fromWho }));
  await closeResult();
  await prepare(); await evaluate("(()=>{const n=document.getElementById('notes');n.value='진행 중 잠금 확인';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()"); await press('#start');
  await until("document.body.classList.contains('recording')"); await press('#open-settings'); await wait(40);
  check('진행 중에는 내 이름을 바꿀 수 없다', await evaluate("!!document.getElementById('my-name')?.disabled&&!!document.getElementById('my-name-save')?.disabled&&!document.getElementById('settings-lock').hidden"));
  await press('#close-settings');
  await prepare(); await evaluate('__mock.myNameFail=true'); await press('#open-settings'); await wait(40);
  await evaluate("(()=>{const i=document.getElementById('my-name');if(!i)return false;i.value='최유진';i.dispatchEvent(new Event('input'));return true})()"); await press('#my-name-save');
  check('내 이름 저장이 실패하면 적은 글자를 그대로 두고 알린다', await until("document.getElementById('my-name-status')?.textContent.includes('저장하지 못했습니다')") && await evaluate("document.getElementById('my-name').value==='최유진'&&__mock.myName==='박서연'"));
  await press('#close-settings');
  await evaluate('__mock.todoActions=null');
};
