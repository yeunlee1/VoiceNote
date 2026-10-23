// 모의 네이티브 브리지로 실제 화면 파일을 헤드리스 Chrome에 띄워 폭·순서·모달·포커스를 검증한다.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const assets = path.join(__dirname, '..', 'assets');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'voicenote-screens');
const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(outDir, { recursive: true });

const mock = String.raw`(() => {
  const models = [{ id: 'gpt-6-sol', label: 'Sol 표준', maxOutputTokens: 12000 }, { id: 'gpt-6-sol-mini', label: 'Sol 경량', maxOutputTokens: 8000 }];
  const presets = Array.from({ length: 3 }, (_, i) => ({ slot: i + 1, name: '', title: '회의', context: '', outputFormat: 'meeting' }));
  const importFile = Array.from({ length: 3 }, (_, i) => ({ slot: i + 1, name: i === 0 ? '예시 프로젝트 문서 표준화' : i === 2 ? '업무 점검' : '', title: '', contextLength: i === 0 ? 1200 : 0, outputFormat: i === 2 ? 'tasks' : 'meeting' }));
  const tasksRecord = { id: '44444444-4444-4444-4444-444444444444', slot: 1, date: '2026-09-29', dailySequence: 1, title: '업무 형식 회의', state: 'complete', message: '회의록 저장 완료', outputFormat: 'tasks', createdAt: 0, audio: [] };
  const usageRecord = { id: '11111111-1111-1111-1111-111111111111', slot: 1, date: '2026-10-01', dailySequence: 2, title: '제조지시서 화면 검토', state: 'complete', message: '회의록 저장 완료', notes: '1. 탭 구조 결정\n2. 기존 DB 재사용 여부', createdAt: 2, audio: ['원음-001.m4a'],
    analysis: { usage: [{ model: 'gpt-6-sol', inputTokens: 18234, outputTokens: 3120, totalTokens: 21354, requests: 3 }, { model: 'gpt-transcribe', inputTokens: null, outputTokens: null, totalTokens: null, requests: 1 }] } };
  const oldRecord = { id: '22222222-2222-2222-2222-222222222222', slot: 1, date: '2026-09-30', dailySequence: 1, title: '이전 버전에서 분석한 회의', state: 'failed', message: 'API 잔액 또는 사용 한도를 확인하세요. 전사와 녹음은 저장되어 있습니다.', createdAt: 1, audio: [] };
  const minutes = { overview: '전체 방향 | 제조지시서를 먼저 구현합니다.\n주요 결정 | 기존 DB를 사용합니다.', topics: [{ title: '문서 연결', points: ['생산 중 문서를 반복해서 확인하므로 이동을 단순하게 합니다.'] }], decisions: ['기존 DB 활용'], actions: [{ task: '화면 기획', owner: '이연', due: null }], openQuestions: ['탭 방식은 미정'] };
  const m = window.__mock = { key: '', keySource: 'none', model: 'gpt-6-sol', presets, drafts: {}, active: false, calls: [], startError: null, history: [usageRecord, oldRecord, tasksRecord], meeting: {}, pending: null, importError: null, importCancel: false, customFormat: null };
  const connection = () => ({ keyConfigured: !!m.key, keySource: m.keySource, models, summaryModel: m.model, active: m.active, ...(m.access || {}) });
  window.Native = { request(id, method, json) {
    const d = JSON.parse(json); m.calls.push({ method, data: d }); let value = null, error = null;
    try {
      switch (method) {
        case 'init': value = { presets: m.presets, connection: connection(), customFormat: m.customFormat }; break;
        case 'saveCustomFormat': if (!d.customFormat || !String(d.customFormat.name || '').trim()) throw new Error('내 형식 이름을 입력하세요.'); m.customFormat = d.customFormat; value = d.customFormat; break;
        case 'deleteCustomFormat': m.customFormat = null; value = null; break;
        case 'status': value = { active: m.active, meeting: m.meeting, connection: connection() }; break;
        case 'history': value = d.slot === 1 ? m.history : []; break;
        case 'draft': value = m.drafts[d.slot] || {}; break;
        case 'saveDraft': m.drafts[d.slot] = d; value = true; break;
        case 'savePreset': if (!d.name.trim()) throw new Error('프로젝트 이름을 입력하세요.'); m.presets[d.slot - 1] = { slot: d.slot, name: d.name, title: d.title, context: d.context, outputFormat: d.outputFormat }; value = m.presets; break;
        case 'key': if (d.key === 'UNLOCK-TEST') { m.access = { ...m.access, accessMode: 'unlimited', mustRegister: false, unlocked: true }; value = { ...connection(), unlockApplied: true }; break; } if (m.active) throw new Error('녹음이나 분석이 끝난 뒤 키를 바꿀 수 있습니다.'); if (!d.key.startsWith('sk-') || d.key.length < 20) throw new Error('API 키 형식을 확인하세요. sk-로 시작하는 키 전체를 붙여 넣으세요.'); m.key = d.key; m.keySource = d.persist ? 'saved' : 'session'; value = connection(); break;
        case 'removeKey': m.key = ''; m.keySource = 'none'; value = connection(); break;
        case 'model': if (!models.some(x => x.id === d.model)) throw new Error('지원하지 않는 요약 모델입니다.'); m.model = d.model; value = connection(); break;
        case 'start': if (m.startError) throw new Error(m.startError); if (!d.recordConsent || !d.aiConsent) throw new Error('녹음 동의와 외부 AI 분석 동의를 모두 확인하세요.'); m.active = true; m.meeting = { id: '33333333-3333-3333-3333-333333333333', slot: d.slot, state: 'recording', createdAt: Date.now(), message: '회의 녹음 중 · 종료 버튼을 누르면 자동 분석합니다.' }; value = { id: m.meeting.id }; break;
        case 'finish': m.meeting = { ...m.meeting, state: 'analyzing', message: 'Sol 회의록 분석 중 · 1 / 1' }; value = true; break;
        case 'open': { const record = m.history.find(r => r.id === d.id); value = { record, minutes: record.state === 'complete' ? minutes : null, transcript: record.state === 'complete' ? '전사 원문 예시' : '' }; break; }
        case 'analyze': if (!d.aiConsent) throw new Error('외부 AI 분석 동의를 확인하세요.'); value = { id: d.id }; break;
        case 'share': value = true; break;
        case 'copy': value = true; break;
        case 'exportSettings': if (m.active) throw new Error('녹음이나 분석이 끝난 뒤 설정 파일을 내보내거나 불러올 수 있습니다.'); value = { saved: true, file: '2026-10-01-VoiceNote-프로젝트설정.json' }; break;
        case 'importSettings': if (m.importError) throw new Error(m.importError); if (m.importCancel) { value = { cancelled: true }; break; } m.pending = importFile; value = { token: 't1', file: '예시-프로젝트설정.json', projects: importFile.map(p => ({ ...p, currentName: m.presets[p.slot - 1].name, changed: p.name !== m.presets[p.slot - 1].name })) }; break;
        case 'applySettings': if (d.token !== 't1' || !m.pending) throw new Error('불러온 설정이 없습니다.'); m.presets = m.pending.map(p => ({ slot: p.slot, name: p.name, title: p.title, context: p.slot === 1 ? '예시 프로젝트 기준' : '', outputFormat: p.outputFormat })); m.pending = null; value = m.presets; break;
        case 'cancelSettings': m.pending = null; value = true; break;
        default: throw new Error('지원하지 않는 요청입니다.');
      }
    } catch (e) { error = e.message; }
    setTimeout(() => window.receive(id, { value, error }), 5);
  } };
})();`;

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname);
    const file = path.join(assets, name);
    if (!['index.html', 'app.js', 'flow.js', 'formats.js', 'app.css'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function chrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-chrome-'));
  const proc = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let text = ''; const timer = setTimeout(() => reject(new Error('Chrome 시작 시간 초과')), 20000);
    proc.stderr.on('data', chunk => { text += chunk; const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
  });
  return { proc, port, profile };
}
async function connect(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', e => { const msg = JSON.parse(e.data); if (waiting.has(msg.id)) { const { resolve, reject } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; waiting.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}

const results = []; let failures = 0;
function check(label, ok, detail) { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failures++; }

(async () => {
  const server = await serve(), base = `http://127.0.0.1:${server.address().port}/index.html`;
  const { proc, port, profile } = await chrome();
  try {
    const { ws, send } = await connect(port);
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: mock });
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    const load = async () => { await send('Page.navigate', { url: base }); await wait(700); };
    const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64')); };
    const click = sel => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.click();return true})()`);
    const startDisabled = () => evaluate(`document.getElementById('start').disabled`);
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });

    // 폭별 가로 넘침과 터치 크기
    const targetsJs = `(()=>{const bad=[];for(const el of document.querySelectorAll('button,select,input:not([type=checkbox]):not([type=radio]),textarea,label.check')){const r=el.getBoundingClientRect();if(!r.width||!r.height||el.closest('[hidden]'))continue;if(getComputedStyle(el).visibility==='hidden')continue;if(r.height<44-0.5||r.width<44-0.5)bad.push((el.id||el.className||el.tagName)+':'+Math.round(r.width)+'x'+Math.round(r.height));}return bad})()`;
    const overflowJs = `(()=>{const w=document.documentElement.clientWidth;const wide=[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>w+0.5&&!el.closest('[hidden]')&&getComputedStyle(el).position!=='fixed'}).map(el=>el.id||el.className||el.tagName).slice(0,5);return {scroll:document.documentElement.scrollWidth,width:w,wide}})()`;
    for (const width of [360, 390, 412]) {
      await viewport(width, 800); await load();
      await click('#prepare'); await wait(100);
      const of = await evaluate(overflowJs);
      check(`${width}px 가로 넘침 없음`, of.scroll <= of.width && !of.wide.length, JSON.stringify(of));
      const small = await evaluate(targetsJs);
      check(`${width}px 터치 대상 44px 이상`, !small.length, small.join(', '));
      await shot(`모바일-${width}-준비열림.png`);
      await evaluate(`window.scrollTo(0,0)`); await click('#prepare'); await wait(50); await shot(`모바일-${width}-첫화면.png`);
      await click('#open-projects'); await wait(60); await evaluate(`__mock.presets[1].name='표준 문서 구현 프로젝트 이름이 아주 긴 경우';document.querySelector('#presets button').click();true`); await wait(120); await evaluate(`document.getElementById('project-settings').open=true;true`);
      const pickSmall = await evaluate(targetsJs), pickOf = await evaluate(`(()=>{const d=document.getElementById('projects');return {scroll:d.scrollWidth,width:d.clientWidth}})()`);
      check(`${width}px 프로젝트 선택 창 44px·넘침 없음`, !pickSmall.length && pickOf.scroll <= pickOf.width, pickSmall.join(', '));
      await shot(`모바일-${width}-프로젝트선택.png`); await evaluate(`document.getElementById('projects').close();true`);
    }

    // 시작 조건: 준비는 동의 없이 열리고, 순서와 무관하게 마지막 조건 즉시 활성
    await viewport(390, 820);
    const steps = {
      key: async () => { await click('#open-settings'); await evaluate(`document.getElementById('api-key').value='sk-test-0000000000000000';true`); await click('#save-key'); await wait(60); await evaluate(`document.getElementById('settings').close();true`); },
      name: async () => { await evaluate(`(()=>{const el=document.getElementById('name');el.value='검증 프로젝트';el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); },
      record: async () => { await click('#record-consent'); },
      ai: async () => { await click('#ai-consent'); }
    };
    const orders = [['record', 'ai', 'name', 'key'], ['key', 'name', 'ai', 'record'], ['ai', 'key', 'record', 'name'], ['name', 'record', 'key', 'ai']];
    for (const order of orders) {
      await load();
      await click('#prepare'); await wait(30);
      const prepOpen = await evaluate(`!document.getElementById('prep').hidden`);
      check(`동의 없이 회의 준비 열림 (${order.join('→')})`, prepOpen);
      const order0 = await evaluate(`(()=>{const p=document.getElementById('prep'),b=document.getElementById('prepare').getBoundingClientRect(),c=p.querySelector('fieldset.consents').getBoundingClientRect(),t=document.getElementById('title').getBoundingClientRect();return {first:p.firstElementChild.classList.contains('consents'),gap:Math.round(c.top-b.bottom),beforeTitle:c.bottom<=t.top}})()`);
      check(`동의 2개가 준비 버튼 바로 아래·회의명보다 먼저 (${order.join('→')})`, order0.first && order0.gap >= 0 && order0.gap <= 16 && order0.beforeTitle, JSON.stringify(order0));
      await evaluate(`document.querySelector('#project-settings').open=true;true`);
      let ok = true, trace = [];
      for (let i = 0; i < order.length; i++) {
        await steps[order[i]](); await wait(20);
        const disabled = await startDisabled(); trace.push(`${order[i]}:${disabled ? '막힘' : '가능'}`);
        if (disabled !== (i < order.length - 1)) ok = false;
      }
      check(`마지막 조건 충족 즉시 시작 활성 (${order.join('→')})`, ok, trace.join(' '));
    }
    const blockers = await evaluate(`document.querySelector('#blockers .needs-title').textContent`);
    check('조건 충족 시 준비 완료 안내', blockers === '준비 완료', blockers);
    await evaluate(`document.getElementById('notes').value='안건 A';document.getElementById('notes').dispatchEvent(new Event('input',{bubbles:true}));true`);
    await click('#start'); await wait(150);
    const startCall = await evaluate(`__mock.calls.filter(c=>c.method==='start').pop().data`);
    check('시작 요청에 회의별 상세 내용과 동의 2개 전달', startCall.notes === '안건 A' && startCall.recordConsent === true && startCall.aiConsent === true, JSON.stringify(startCall));
    await wait(1700);
    const recording = await evaluate(`({finish:!document.getElementById('finish').disabled,start:document.getElementById('start').disabled,state:document.getElementById('record-state').textContent,cls:document.body.classList.contains('recording'),consent:document.getElementById('record-consent').checked,needsHidden:document.getElementById('blockers').hidden,startHidden:document.getElementById('start').hidden,finishVisible:!document.getElementById('finish').hidden,stage:document.querySelector('#stage [aria-current=step]').dataset.stage,projectLocked:document.getElementById('open-projects').disabled})`);
    check('녹음 중 종료 활성·시작 잠금·동의 초기화', recording.finish && recording.start && recording.cls && !recording.consent && recording.needsHidden && recording.startHidden && recording.finishVisible && recording.stage === 'record' && recording.projectLocked, JSON.stringify(recording));
    await shot('모바일-390-녹음중.png');
    // 녹음 중 설정 변경: 키 변경은 이유를 보여 막고 모델 변경은 다음 분석부터 적용
    await click('#open-settings'); await wait(60);
    const lockInfo = await evaluate(`({notice:!document.getElementById('settings-lock').hidden,save:document.getElementById('save-key').disabled,model:document.getElementById('model').disabled})`);
    check('녹음 중 키 변경 잠금 안내, 모델 선택 가능', lockInfo.notice && lockInfo.save && !lockInfo.model, JSON.stringify(lockInfo));
    await evaluate(`(()=>{const s=document.getElementById('model');s.value='gpt-6-sol-mini';s.dispatchEvent(new Event('change'));return true})()`); await wait(80);
    const modelSaved = await evaluate(`({mock:__mock.model,limit:document.getElementById('model-limit').textContent,toast:document.getElementById('message').textContent})`);
    check('요약 모델 선택 저장과 안내', modelSaved.mock === 'gpt-6-sol-mini' && modelSaved.limit.includes('Sol 경량') && !modelSaved.limit.includes('토큰') && modelSaved.toast.includes('다음 분석부터'), JSON.stringify(modelSaved));
    await evaluate(`document.getElementById('settings').close();true`);

    // 보이는 실패 이유
    await load(); await steps.key(); await steps.name(); await click('#prepare'); await steps.record(); await steps.ai();
    await evaluate(`__mock.startError='녹음하려면 마이크 권한이 필요합니다.';true`); await click('#start'); await wait(120);
    const toast = await evaluate(`({hidden:document.getElementById('message').hidden,text:document.getElementById('message').textContent,role:document.getElementById('message').getAttribute('role')})`);
    check('시작 실패 이유를 알림으로 표시', !toast.hidden && toast.text.includes('마이크 권한') && toast.role === 'alert', JSON.stringify(toast));
    await evaluate(`(()=>{document.getElementById('api-key').value='bad';document.getElementById('open-settings').click();return true})()`); await wait(40);
    await evaluate(`document.getElementById('api-key').value='bad';true`); await click('#save-key'); await wait(60);
    const keyErr = await evaluate(`document.getElementById('message').textContent`);
    check('잘못된 키 형식 이유 표시', keyErr.includes('형식'), keyErr);
    await evaluate(`document.getElementById('settings').close();true`);

    // 키보드가 열린 상태의 AI 설정 모달
    for (const width of [360, 412]) {
      await viewport(width, 380); await load(); await click('#open-settings'); await wait(60);
      await evaluate(`document.getElementById('api-key').focus();true`); await wait(30);
      const fit = await evaluate(`(()=>{const d=document.getElementById('settings').getBoundingClientRect(),i=document.getElementById('api-key').getBoundingClientRect(),dlg=document.getElementById('settings');const save=document.getElementById('save-key');save.scrollIntoView({block:'nearest'});const s=save.getBoundingClientRect();return {top:d.top,bottom:d.bottom,h:innerHeight,inputVisible:i.top>=0&&i.bottom<=innerHeight,saveVisible:s.top>=0&&s.bottom<=innerHeight,scrollable:dlg.scrollHeight>dlg.clientHeight,focused:document.activeElement.id}})()`);
      check(`${width}px 키보드 열린 모달이 화면 안에 맞고 스크롤로 버튼 도달`, fit.top >= 0 && fit.bottom <= fit.h + 0.5 && fit.inputVisible && fit.saveVisible && fit.focused === 'api-key', JSON.stringify(fit));
      await evaluate(`document.getElementById('settings').scrollTop=0;document.getElementById('api-key').focus();true`);
      await shot(`모바일-${width}-키보드-AI설정.png`);
    }
    // 키보드가 열린 준비 입력 상태: 하단 조작부가 입력칸을 가리지 않음
    await viewport(390, 420); await load(); await click('#prepare'); await evaluate(`document.getElementById('notes').focus();document.getElementById('notes').scrollIntoView({block:'center'});true`); await wait(60);
    const typing = await evaluate(`({typing:document.body.classList.contains('typing'),dock:getComputedStyle(document.querySelector('.dock')).display})`);
    check('입력 중 하단 조작부 숨김', typing.typing && typing.dock === 'none', JSON.stringify(typing));
    await shot('모바일-390-키보드-안건입력.png');

    // 포커스 표시와 모달 포커스 가두기
    await viewport(390, 820); await load();
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const focus = await evaluate(`({id:document.activeElement.id,outline:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth})`);
    check('키보드 포커스가 보이는 외곽선', focus.outline !== 'none' && parseFloat(focus.width) >= 2, JSON.stringify(focus));
    await click('#open-settings'); await wait(40);
    const modal = await evaluate(`({open:document.getElementById('settings').open,modal:document.getElementById('settings').matches(':modal'),inside:document.getElementById('settings').contains(document.activeElement)})`);
    check('AI 설정은 모달로 열리고 포커스가 안에 있음', modal.open && modal.modal && modal.inside, JSON.stringify(modal));
    const back = await evaluate(`window.handleBack()`); await wait(20);
    check('뒤로 가기로 모달 닫힘', back === true && !(await evaluate(`document.getElementById('settings').open`)));
    await wait(30); const restored = await evaluate(`document.activeElement.id`);
    check('설정을 닫으면 연 버튼으로 포커스 복원', restored === 'open-settings', restored);
    const numerals = await evaluate(`(()=>{const t=getComputedStyle(document.getElementById('timer'));return {family:t.fontFamily,variant:t.fontVariantNumeric,georgia:[...document.querySelectorAll('*')].some(el=>/Georgia/i.test(getComputedStyle(el).fontFamily))}})()`);
    const logo = await evaluate(`(()=>{const sym=document.getElementById('i-logo');return {view:sym.getAttribute('viewBox'),rect:!!sym.querySelector('rect'),strokes:[...sym.querySelectorAll('path')].map(p=>p.getAttribute('stroke')),first:sym.querySelector('path').getAttribute('d')}})()`);
    check('상단 로고는 브랜드 원본 V자 음성 파형(배경 없음)', logo.view === '0 0 64 64' && !logo.rect && logo.strokes.join() === '#0F7A72,#22B5A6' && logo.first === 'M10 8.5V24.5M54 8.5V24.5M21 18.5V40.5M43 18.5V40.5', JSON.stringify(logo));
    check('타이머는 산세리프 고정폭 숫자, Georgia 미사용', !numerals.georgia && numerals.variant.includes('tabular-nums'), JSON.stringify(numerals));

    // 지난 회의 상세: 상세 안건, 모델별 사용량, 미제공
    await click('#history button'); await wait(120);
    await evaluate(`document.querySelector('#result details.more').open=true;true`);
    const detail = await evaluate(`({open:!document.getElementById('result').hidden,notes:document.getElementById('meeting-notes').textContent,rows:[...document.querySelectorAll('#usage tbody tr')].map(tr=>tr.innerText.replace(/\\s+/g,' ')),retry:document.getElementById('retry').disabled})`);
    check('상세에서 준비한 안건 표시', detail.open && detail.notes.includes('탭 구조'), detail.notes);
    check('모델별 입력/출력/합계와 미제공 표시', detail.rows.length === 2 && detail.rows[0].includes('18,234') && detail.rows[0].includes('21,354') && detail.rows[1].includes('미제공'), JSON.stringify(detail.rows));
    check('재분석은 동의 체크 전 잠금', detail.retry === true);
    await shot('모바일-390-지난회의-상세.png');
    await evaluate(`document.getElementById('result').hidden=true;true`);
    await evaluate(`(async()=>{document.querySelectorAll('#history button')[1].click();})()`); await wait(120);
    await evaluate(`document.querySelector('#result details.more').open=true;true`);
    const old = await evaluate(`({usage:document.getElementById('usage').innerText,notesHidden:document.getElementById('meeting-notes-wrap').hidden})`);
    check('사용량 없는 옛 기록은 미제공', old.usage.includes('미제공') && old.notesHidden, JSON.stringify(old));
    const firstScreen = await evaluate(`({minutesPanel:!!document.querySelector('main #minutes'),exportOnFirst:!!document.querySelector('main #share-all'),aiCard:!!document.querySelector('main .connection-settings'),tiles:!!document.querySelector('main #presets'),stepCards:document.querySelectorAll('main .step').length,promo:/집중하세요|준비하고, 시작하고/.test(document.body.innerText),dockButtons:[...document.querySelectorAll('.dock button')].filter(b=>!b.hidden).length})`);
    check('첫 화면: 빈 회의록·AI 상시카드·3x3 타일·단계 카드·홍보 문구 없음, 하단 행동 1개', !firstScreen.minutesPanel && !firstScreen.exportOnFirst && !firstScreen.aiCard && !firstScreen.tiles && !firstScreen.stepCards && !firstScreen.promo && firstScreen.dockButtons === 1, JSON.stringify(firstScreen));

    // 출력 형식: 업무 정리 기록은 목록·상세·내보내기 제목을 형식에 맞춘다
    await viewport(390, 820); await load();
    const tasksLabel = await evaluate(`[...document.querySelectorAll('#history button')][2].querySelector('.state').textContent`);
    check('완료 기록 목록에 출력 형식 이름 표시', tasksLabel === '업무 정리', tasksLabel);
    await evaluate(`document.querySelectorAll('#history button')[2].click();true`); await wait(150);
    const tasksDetail = await evaluate(`({heads:[...document.querySelectorAll('#minutes h3, #minutes .summary strong')].map(e=>e.textContent),items:[...document.querySelectorAll('#minutes li')].map(e=>e.textContent),share:document.getElementById('share-result').textContent.trim()})`);
    check('업무 정리 상세: 할 일 먼저, 없는 담당·기한은 미정', tasksDetail.heads[0] === '업무 요약' && tasksDetail.heads[1] === '할 일' && tasksDetail.items.some(t => t.includes('담당 이연') && t.includes('기한 미정')) && tasksDetail.share === '업무 정리 공유', JSON.stringify(tasksDetail));
    await shot('모바일-390-업무정리-상세.png');
    await click('#close-result'); await wait(40);
    await evaluate(`document.getElementById('history').querySelector('button').click();true`); await wait(150);
    const meetingShare = await evaluate(`document.getElementById('share-result').textContent.trim()`);
    check('회의록 형식 기록은 공유 버튼 이름이 회의록 그대로', meetingShare === '회의록 공유', meetingShare);
    // 결과 페이지: 정리본이 먼저 보이고, 전사문 탭과 보고 있는 탭의 복사·공유
    const firstTab = await evaluate(`({minutes:!document.getElementById('panel-minutes').hidden,transcript:!document.getElementById('panel-transcript').hidden,selected:document.querySelector('[role=tab][aria-selected=true]').id,copy:document.getElementById('copy-result').textContent.trim(),actionsAbovePanel:document.querySelector('.result-actions').getBoundingClientRect().top<document.getElementById('panel-minutes').getBoundingClientRect().top})`);
    check('결과 페이지는 정리본 탭과 위쪽 복사·공유로 시작', firstTab.minutes && !firstTab.transcript && firstTab.selected === 'tab-minutes' && firstTab.copy === '회의록 복사' && firstTab.actionsAbovePanel, JSON.stringify(firstTab));
    await click('#copy-result'); await wait(60);
    const copiedSummary = await evaluate(`({call:__mock.calls.filter(c=>c.method==='copy').pop()?.data,toast:document.getElementById('message').textContent})`);
    check('정리본 복사는 정리본 내용을 요청하고 안내', copiedSummary.call && copiedSummary.call.kind === 'summary' && copiedSummary.toast.includes('복사했습니다'), JSON.stringify(copiedSummary));
    await click('#tab-transcript'); await wait(40);
    const transcriptTab = await evaluate(`({panel:!document.getElementById('panel-transcript').hidden,text:document.getElementById('transcript').textContent,meta:document.getElementById('transcript-meta').textContent,share:document.getElementById('share-result').textContent.trim()})`);
    check('전사문 탭은 전사 원문과 글자 수를 바로 보여 줌', transcriptTab.panel && transcriptTab.text === '전사 원문 예시' && transcriptTab.meta.includes('자') && transcriptTab.share === '전사문 공유', JSON.stringify(transcriptTab));
    for (const width of [360, 412]) { await viewport(width, 800); await wait(40); const small = await evaluate(targetsJs), of = await evaluate(overflowJs); check(`${width}px 결과 페이지 44px·넘침 없음`, !small.length && of.scroll <= of.width && !of.wide.length, small.join(', ') + JSON.stringify(of)); }
    await viewport(390, 820); await shot('모바일-390-결과-전사문.png');
    await click('#share-result'); await wait(60); await click('#copy-result'); await wait(60);
    const transcriptCalls = await evaluate(`({share:__mock.calls.filter(c=>c.method==='share').pop()?.data,copy:__mock.calls.filter(c=>c.method==='copy').pop()?.data})`);
    check('전사문 탭의 공유·복사는 전사문을 요청', transcriptCalls.share.kind === 'transcript' && transcriptCalls.copy.kind === 'transcript', JSON.stringify(transcriptCalls));
    await click('#tab-minutes'); await wait(40);
    await click('#close-result'); await wait(40);

    // 출력 형식: 프로젝트 저장은 형식을 바꾸지 않고, 회의 준비에서 고른 형식과 내 형식을 시작 요청에 싣는다
    await load(); await click('#open-projects'); await wait(60);
    await evaluate(`(()=>{document.getElementById('project-settings').open=true;document.getElementById('name').value='형식 시험';return true})()`);
    await click('#save-preset'); await wait(80);
    const savedFormat = await evaluate(`__mock.calls.filter(c=>c.method==='savePreset').pop().data`);
    check('프로젝트 저장은 출력 형식을 바꾸지 않음', savedFormat.outputFormat === 'meeting' && savedFormat.title === '회의', JSON.stringify(savedFormat));
    const placement = await evaluate(`({inProject:!!document.querySelector('#project-settings #output-format'),inPrep:!!document.querySelector('#prep #output-format'),options:[...document.querySelectorAll('#output-format option')].map(o=>o.value).join(',')})`);
    check('출력 형식은 회의 준비에 있고 선택지 4종', !placement.inProject && placement.inPrep && placement.options === 'meeting,summary,tasks,custom', JSON.stringify(placement));
    await evaluate(`document.getElementById('projects').close();true`); await click('#prepare'); await wait(40);
    await evaluate(`(()=>{const s=document.getElementById('output-format');s.value='summary';s.dispatchEvent(new Event('change'));return true})()`); await click('#format-help'); await wait(60);
    const example = await evaluate(`({open:!document.getElementById('format-example').hidden,editor:!document.getElementById('custom-editor').hidden,headings:[...document.querySelectorAll('#format-example-body strong,#format-example-body h3')].map(h=>h.textContent).join('/')})`);
    check('예시 보기는 고른 형식의 예시를 보여 줌', example.open && !example.editor && example.headings.startsWith('핵심 요약/주요 내용'), JSON.stringify(example));
    for (const width of [360, 412]) { await viewport(width, 800); await wait(40); const small = await evaluate(targetsJs), of = await evaluate(overflowJs); check(`${width}px 출력 형식 예시 44px·넘침 없음`, !small.length && of.scroll <= of.width && !of.wide.length, small.join(', ') + JSON.stringify(of)); }
    await viewport(390, 820); await shot('모바일-390-출력형식-예시.png');
    await evaluate(`(()=>{const s=document.getElementById('output-format');s.value='custom';s.dispatchEvent(new Event('change'));return true})()`); await wait(60);
    const customBlocked = await evaluate(`({editor:!document.getElementById('custom-editor').hidden,blockers:document.getElementById('blocker-list').innerText,start:document.getElementById('start').disabled})`);
    check('내 형식이 없으면 편집 칸과 시작 전 안내', customBlocked.editor && customBlocked.blockers.includes('내 형식을 먼저 저장') && customBlocked.start, JSON.stringify(customBlocked));
    await evaluate(`(()=>{document.getElementById('custom-name').value='주간 보고';document.querySelector('#custom-section-list li:nth-child(2) input[type=checkbox]').click();document.querySelector('#custom-section-list li:nth-child(4) .move').click();return true})()`); await wait(40);
    for (const width of [360, 412]) { await viewport(width, 800); await wait(40); const small = await evaluate(targetsJs), of = await evaluate(overflowJs); check(`${width}px 내 형식 편집 44px·넘침 없음`, !small.length && of.scroll <= of.width && !of.wide.length, small.join(', ') + JSON.stringify(of)); }
    await viewport(390, 820);
    await click('#custom-save'); await wait(80);
    const savedCustom = await evaluate(`({mock:__mock.customFormat,option:document.querySelector('#output-format option[value=custom]').textContent,headings:[...document.querySelectorAll('#format-example-body strong,#format-example-body h3')].map(h=>h.textContent).join('/')})`);
    check('내 형식 저장: 고른 항목·순서와 예시 반영', savedCustom.mock && savedCustom.mock.name === '주간 보고' && savedCustom.mock.sections.map(x=>x.key).join() === 'overview,actions,decisions,openQuestions' && savedCustom.option.includes('주간 보고') && savedCustom.headings === '핵심 요약/할 일/결정 사항/확인 필요', JSON.stringify(savedCustom));
    await shot('모바일-390-내형식-편집.png');
    await steps.key(); await steps.record(); await steps.ai(); await wait(40); await click('#start'); await wait(120);
    const started = await evaluate(`__mock.calls.filter(c=>c.method==='start').pop()?.data`);
    check('회의 시작에 고른 형식과 내 형식 정의 전달', !!started && started.outputFormat === 'custom' && started.customFormat.name === '주간 보고', JSON.stringify(started));
    await evaluate(`__mock.active=false;__mock.meeting={};true`);
    await load(); await click('#open-projects'); await wait(60);
    await evaluate(`(()=>{document.getElementById('project-settings').open=true;document.getElementById('name').value='형식 시험';return true})()`); await click('#save-preset'); await wait(80);
    // 내보내기: 저장 안 한 변경이 있으면 막고 안내, 저장된 설정은 내보내기 호출
    await evaluate(`document.getElementById('settings-file').open=true;document.getElementById('context').value='저장 안 한 설명';true`);
    const exportBefore = await evaluate(`__mock.calls.filter(c=>c.method==='exportSettings').length`);
    await click('#export-settings'); await wait(60);
    const unsaved = await evaluate(`({calls:__mock.calls.filter(c=>c.method==='exportSettings').length,toast:document.getElementById('message').textContent})`);
    check('저장 전 내보내기는 먼저 저장 안내, 파일 작업 없음', unsaved.calls === exportBefore && unsaved.toast.includes('먼저 저장'), JSON.stringify(unsaved));
    await click('#save-preset'); await wait(80); await click('#export-settings'); await wait(80);
    const exported = await evaluate(`({calls:__mock.calls.filter(c=>c.method==='exportSettings').length,toast:document.getElementById('message').textContent})`);
    check('저장된 설정 내보내기 호출과 결과 안내', exported.calls === exportBefore + 1 && exported.toast.includes('저장했습니다'), JSON.stringify(exported));
    for (const width of [360, 412]) {
      await viewport(width, 800); await wait(40);
      const small = await evaluate(targetsJs), of = await evaluate(`(()=>{const d=document.getElementById('projects');return {scroll:d.scrollWidth,width:d.clientWidth}})()`);
      check(`${width}px 설정 파일 영역 44px·넘침 없음`, !small.length && of.scroll <= of.width, small.join(', '));
    }
    await viewport(390, 820); await shot('모바일-390-설정파일.png');

    // 불러오기: 미리보기 → 취소는 무변경, 뒤로 가기는 미리보기만 닫음, 교체 확인 시에만 전체 교체
    const presetsBefore = await evaluate(`JSON.stringify(__mock.presets)`);
    await click('#import-settings'); await wait(80);
    const preview = await evaluate(`({open:document.getElementById('import-preview').open,rows:document.querySelectorAll('#import-list li').length,first:document.querySelector('#import-list li').innerText.replace(/\\s+/g,' '),file:document.getElementById('import-file').textContent,focus:document.getElementById('import-preview').contains(document.activeElement)})`);
    check('불러오기 미리보기 3개 슬롯과 파일 이름', preview.open && preview.rows === 3 && preview.first.includes('예시 프로젝트') && preview.file.includes('예시-프로젝트설정.json') && preview.focus, JSON.stringify(preview));
    for (const width of [360, 412]) {
      await viewport(width, 640); await wait(40);
      const small = await evaluate(targetsJs), of = await evaluate(`(()=>{const d=document.getElementById('import-preview');return {scroll:d.scrollWidth,width:d.clientWidth}})()`);
      check(`${width}px 미리보기 44px·넘침 없음`, !small.length && of.scroll <= of.width, small.join(', '));
    }
    await viewport(390, 820); await shot('모바일-390-설정불러오기-미리보기.png');
    await evaluate(`window.handleBack()`); await wait(60);
    const afterBack = await evaluate(`({preview:document.getElementById('import-preview').open,projects:document.getElementById('projects').open,cancel:__mock.calls.filter(c=>c.method==='cancelSettings').length,presets:JSON.stringify(__mock.presets),apply:__mock.calls.filter(c=>c.method==='applySettings').length,focus:document.activeElement.id})`);
    check('뒤로 가기는 미리보기만 닫고 저장 없이 취소', !afterBack.preview && afterBack.projects && afterBack.cancel === 1 && afterBack.presets === presetsBefore && afterBack.apply === 0 && afterBack.focus === 'import-settings', JSON.stringify(afterBack));
    await click('#import-settings'); await wait(80); await click('#import-cancel'); await wait(60);
    const afterCancel = await evaluate(`({cancel:__mock.calls.filter(c=>c.method==='cancelSettings').length,presets:JSON.stringify(__mock.presets),toast:document.getElementById('message').textContent})`);
    check('취소 버튼은 무변경', afterCancel.cancel === 2 && afterCancel.presets === presetsBefore && afterCancel.toast.includes('그대로'), JSON.stringify(afterCancel));
    await evaluate(`__mock.importError='설정 파일을 불러올 수 없습니다. 프로젝트는 3개까지만 쓸 수 있습니다. 기존 설정은 바뀌지 않았습니다.';true`);
    await click('#import-settings'); await wait(80);
    const invalid = await evaluate(`({preview:document.getElementById('import-preview').open,toast:document.getElementById('message').textContent,presets:JSON.stringify(__mock.presets)})`);
    check('잘못된 파일은 이유를 보여 주고 미리보기 없이 무변경', !invalid.preview && invalid.toast.includes('3개까지만') && invalid.presets === presetsBefore, JSON.stringify(invalid));
    await evaluate(`__mock.importError=null;__mock.importCancel=true;true`); await click('#import-settings'); await wait(80);
    const picked = await evaluate(`({preview:document.getElementById('import-preview').open,toast:document.getElementById('message').textContent})`);
    check('파일 선택 취소는 미리보기 없음', !picked.preview && picked.toast.includes('취소'), JSON.stringify(picked));
    await evaluate(`__mock.importCancel=false;true`); await click('#import-settings'); await wait(80); await click('#import-apply'); await wait(150);
    const applied = await evaluate(`({preview:document.getElementById('import-preview').open,name:document.getElementById('name').value,format:document.getElementById('output-format').value,list:[...document.querySelectorAll('#presets button')].map(b=>b.innerText.replace(/\\s+/g,' ')).join('/'),toast:document.getElementById('message').textContent})`);
    check('전체 교체 확인 후 설정과 형식 반영', !applied.preview && applied.name === '예시 프로젝트 문서 표준화' && applied.format === 'meeting' && applied.list.includes('업무 점검') && applied.toast.includes('바꿨습니다'), JSON.stringify(applied));
    await evaluate(`document.getElementById('projects').close();true`);

    // 녹음·분석 중에는 설정 파일 작업 잠금
    await evaluate(`__mock.active=true;__mock.meeting={id:'55555555-5555-5555-5555-555555555555',slot:1,state:'recording',createdAt:Date.now(),message:'녹음 중'};true`); await wait(1700);
    const lockedFile = await evaluate(`({exp:document.getElementById('export-settings').disabled,imp:document.getElementById('import-settings').disabled})`);
    check('녹음 중 설정 내보내기·불러오기 잠금', lockedFile.exp && lockedFile.imp, JSON.stringify(lockedFile));
    await evaluate(`__mock.active=false;__mock.meeting={};true`);

    // 공용 기본 키 체험: 남은 횟수 표시, 소진 후 재분석은 정확한 안내와 AI 설정 열기, 해제문자 입력
    const trialAccess = used => ({ accessMode: used >= 3 ? 'exhausted' : 'trial', trialLimit: 3, trialUsed: used, trialRemaining: Math.max(0, 3 - used), trialReserved: 0, mustRegister: used >= 3, unlocked: false, trialError: '' });
    await load(); await evaluate(`__mock.access=${JSON.stringify(trialAccess(2))};true`); await wait(1700);
    await steps.name(); await click('#prepare'); await steps.record(); await steps.ai(); await wait(40);
    const trialReady = await evaluate(`({chip:document.getElementById('connection').textContent,start:document.getElementById('start').disabled})`);
    check('체험 남은 1회: 개인 키 없이 시작 가능, 칩에 남은 횟수', trialReady.chip === '체험 1회' && trialReady.start === false, JSON.stringify(trialReady));
    await evaluate(`__mock.access=${JSON.stringify(trialAccess(3))};true`); await wait(1700);
    const exhausted = await evaluate(`({chip:document.getElementById('connection').textContent,start:document.getElementById('start').disabled,blockers:document.getElementById('blocker-list').innerText,link:!document.getElementById('blocker-settings').hidden})`);
    check('3회 소진: 상태 갱신으로 시작 잠금과 정확한 등록 안내', exhausted.chip === '키 필요' && exhausted.start && exhausted.blockers.includes('새로운 API키를 등록하세요.') && exhausted.link, JSON.stringify(exhausted));
    await click('#history button'); await wait(150); await click('#retry-consent'); await wait(20);
    const analyzeBefore = await evaluate(`__mock.calls.filter(c=>c.method==='analyze').length`);
    await click('#retry'); await wait(120);
    const retried = await evaluate(`({toast:document.getElementById('message').textContent,settings:document.getElementById('settings').open,calls:__mock.calls.filter(c=>c.method==='analyze').length,status:document.getElementById('key-status').textContent})`);
    check('소진 후 재분석: 문구 표시와 AI 설정 열림, 분석 요청 없음', retried.toast === '새로운 API키를 등록하세요.' && retried.settings && retried.calls === analyzeBefore && retried.status === '새로운 API키를 등록하세요.', JSON.stringify(retried));
    await shot('모바일-390-체험소진-AI설정.png');
    await evaluate(`document.getElementById('api-key').value='UNLOCK-TEST';true`); await click('#save-key'); await wait(80);
    const unlocked = await evaluate(`({toast:document.getElementById('message').textContent,chip:document.getElementById('connection').textContent,input:document.getElementById('api-key').value})`);
    check('해제문자 입력: 제한 해제 안내, 입력칸 비움', unlocked.toast.includes('횟수 제한 없이') && unlocked.chip === '준비됨' && unlocked.input === '', JSON.stringify(unlocked));
    await evaluate(`document.getElementById('settings').close();document.getElementById('result').hidden=true;__mock.access=null;true`);

    // 불러온 설명에 CRLF가 있어도 저장하지 않은 변경으로 보지 않고 바로 내보낸다
    await load(); await evaluate(`__mock.presets[0]={slot:1,name:'예시 프로젝트',title:'',context:'첫 줄\\r\\n둘째 줄',outputFormat:'meeting'};true`);
    await evaluate(`document.querySelectorAll('#presets button')[0].click();true`); await wait(150);
    const crlfBefore = await evaluate(`__mock.calls.filter(c=>c.method==='exportSettings').length`);
    await click('#export-settings'); await wait(100);
    const crlf = await evaluate(`({calls:__mock.calls.filter(c=>c.method==='exportSettings').length,toast:document.getElementById('message').textContent,saves:__mock.calls.filter(c=>c.method==='savePreset').length})`);
    check('CRLF 설명을 불러온 직후 바로 내보내기 가능', crlf.calls === crlfBefore + 1 && !crlf.toast.includes('먼저 저장'), JSON.stringify(crlf));

    // 실제 textarea: 설명을 고치지 않고 다른 필드만 저장하면 CRLF·앞뒤 공백 원문 그대로, 설명을 고치면 textarea 값 그대로 저장
    await load(); await evaluate(`__mock.presets[0]={slot:1,name:'원문',title:'',context:'  첫 줄\\r\\n둘째 줄  ',outputFormat:'meeting'};true`);
    await evaluate(`document.querySelectorAll('#presets button')[0].click();true`); await wait(150);
    await evaluate(`(()=>{const n=document.getElementById('name');n.value='원문 바꿈';n.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await click('#save-preset'); await wait(100);
    const kept = await evaluate(`__mock.calls.filter(c=>c.method==='savePreset').pop().data`);
    check('다른 필드만 저장하면 설명 원문(CRLF·앞뒤 공백) 보존', kept.context === '  첫 줄\r\n둘째 줄  ' && kept.name === '원문 바꿈' && kept.outputFormat === 'meeting', JSON.stringify(kept));
    await evaluate(`(()=>{const t=document.getElementById('context');t.value=t.value+'\\n셋째 줄';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await click('#save-preset'); await wait(100);
    const edited = await evaluate(`__mock.calls.filter(c=>c.method==='savePreset').pop().data`);
    check('설명을 고치면 textarea 값 그대로 저장', edited.context === '  첫 줄\n둘째 줄  \n셋째 줄', JSON.stringify(edited));
    ws.close();
  } finally {
    proc.kill(); server.close();
    await wait(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
  const report = results.join('\n') + `\n${failures ? 'FAIL' : 'PASS'} ${results.length - failures}/${results.length}\n`;
  fs.writeFileSync(path.join(outDir, '브라우저검증결과.txt'), report, 'utf8');
  process.stdout.write(report); process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
