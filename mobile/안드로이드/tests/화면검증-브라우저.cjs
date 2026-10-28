// 모의 네이티브 브리지로 실제 화면 파일을 헤드리스 Chrome에 띄워 폭·순서·모달·포커스를 검증한다.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const assets = path.join(__dirname, '..', 'assets');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'voicenote-screens');
const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(outDir, { recursive: true });

const mock = "(() => {\n  const minutes={overview:'전체 방향 | 회의 내용을 보존합니다.',topics:[{title:'보관함',points:['원래 보관함에서 기록을 엽니다.']}],decisions:[],actions:[],openQuestions:[]};\n  const records=[\n    {id:'11111111-1111-1111-1111-111111111111',location:'p1',resultId:'1234',date:'2026-10-23',dailySequence:1,title:'옛 첫째',projectName:'홈페이지 개편',state:'complete',outputFormat:'tasks',createdAt:1,stars:4,notes:'이번 안건',analysis:{usage:[{model:'gpt-6-sol',inputTokens:18234,outputTokens:3120,totalTokens:21354,requests:3},{model:'gpt-transcribe',inputTokens:null,outputTokens:null,totalTokens:null,requests:1}]},audio:[]},\n    {id:'22222222-2222-2222-2222-222222222222',location:'p2',resultId:'legacy',date:'2026-10-22',dailySequence:1,title:'옛 둘째',projectName:'문서 정리',state:'complete',createdAt:1,audio:[]},\n    {id:'33333333-3333-3333-3333-333333333333',location:'main',date:'2026-10-21',dailySequence:1,title:'',state:'saved',createdAt:1,audio:[]}\n  ];\n  const models=[{id:'gpt-6.1-sol',label:'Sol 표준',maxOutputTokens:32000},{id:'gpt-6-luna',label:'Luna',maxOutputTokens:8000}];\n  const m=window.__mock={key:false,model:models[0].id,active:false,meeting:{},history:records,calls:[],draft:{},customFormat:null,access:null};\n  const connection=()=>({keyConfigured:m.key,keySource:m.key?'session':'none',models,summaryModel:m.model,active:m.active,...(m.access||{})});\n  window.Native={request(id,method,json){\n    const d=JSON.parse(json);m.calls.push({method,data:d});let value,error=null;\n    try{\n      switch(method){\n        case 'init':value={presets:[{name:'',title:'',context:'',outputFormat:'meeting'}],connection:connection(),customFormat:m.customFormat,settings:{defaultOutputFormat:'meeting'}};break;\n        case 'applySettings':m.model=models[1].id;m.customFormat=m.importEmpty?null:{name:'불러온 형식',sections:[{key:'overview',title:'요약'}],instruction:''};value={settings:{summaryModel:m.model,defaultOutputFormat:'custom'},connection:connection(),customFormat:m.customFormat,skipped:[]};break;\n        case 'status':value={active:m.active,meeting:m.meeting,connection:connection()};break;\n        case 'history':value={meetings:m.history,skipped:2};break;\n        case 'draft':if(new URL(location.href).searchParams.has('draftFailure'))throw Error('초안 읽기 실패');value=m.draft;break;\n        case 'saveDraft':m.draft=d;value=true;break;\n        case 'key':if(m.active)throw Error('진행 중에는 키를 바꿀 수 없습니다.');m.key=true;value=connection();break;\n        case 'removeKey':m.key=false;value=connection();break;\n        case 'model':if(m.active)throw Error('진행 중에는 설정을 바꿀 수 없습니다.');m.model=d.model;value=connection();break;\n        case 'open':{if(d.resultId===null)throw Error('JSON null 결과 선택 오류');\n          const record=m.history.find(r=>r.location===d.location&&r.id===d.id);if(!record)throw Error('보관함 연결 오류');\n          value={record,minutes:record.state==='complete'?minutes:null,transcript:'저장된 전사',resultId:record.resultId,versions:[],review:null};break;\n        }\n        case 'start':\n          if('slot' in d||'recordConsent' in d||'aiConsent' in d)throw Error('옛 시작 요청을 보냈습니다.');\n          m.active=true;m.meeting={id:'44444444-4444-4444-4444-444444444444',location:'main',state:'recording',createdAt:Date.now(),message:'회의 녹음 중'};m.draft={};value={id:m.meeting.id};break;\n        case 'finish':m.meeting.state='analyzing';value=true;break;\n        case 'analyze':if(d.location!=='p1')throw Error('원래 보관함이 아닙니다.');value={id:d.id};break;\n        case 'copy':case 'share':if(d.location!=='p1'||d.resultId!=='1234')throw Error('결과 연결 오류');value=true;break;\n        case 'saveCustomFormat':m.customFormat=d.customFormat;value=d.customFormat;break;\n        case 'deleteCustomFormat':m.customFormat=null;value=null;break;\n        default:throw Error('지원하지 않는 요청 '+method);\n      }\n    }catch(ex){error=ex.message;}setTimeout(()=>window.receive(id,{value,error}),0);\n  }};\n})();";

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname);
    const file = path.join(assets, name);
    if (!['index.html', 'app.js', 'flow.js', 'formats.js', 'app.css'].includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] }); if(name==='app.js'){res.end(fs.readFileSync(file,'utf8').replace('  window.receive =','  window.__settingsBridgeForTest = call;\n  window.receive ='));}else fs.createReadStream(file).pipe(res);
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

const results=[];let failures=0;
function check(label,ok,detail){results.push((ok?'PASS ':'FAIL ')+label+(detail?' — '+detail:''));if(!ok)failures++;}
(async()=>{
  const server=await serve(),base='http://127.0.0.1:'+server.address().port+'/index.html';
  const {proc,port,profile}=await chrome();let ws;
  try{
    const client=await connect(port);ws=client.ws;const send=client.send;
    await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:mock+require('./설정평가-모의브리지.cjs')});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    const until=async expression=>{const deadline=Date.now()+6500;while(Date.now()<deadline){if(await evaluate(expression))return true;await wait(50);}return false;};
    const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
    const viewport=(width,height=820)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    const load=async(query='')=>{await send('Page.navigate',{url:base+query});await wait(450);};
    const shot=async name=>{for(let n=0;n<65&&await evaluate("!document.getElementById('message').hidden");n++)await wait(100);const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(outDir,name),Buffer.from(r.data,'base64'));};
    const key=async()=>{await click('#open-settings');await evaluate("document.getElementById('api-key').value='sk-test-00000000000000000000'");await click('#save-key');await wait(60);await click('#close-settings');};
    await require('./후속검증-화면.cjs')({viewport,load,key,click,evaluate,until,wait,shot,check});
    for(const width of [360,390,412]){
      await viewport(width);await load();await key();await click('#history button');await wait(60);
      check(width+'px T1 의견 예시와 앞선 정리본을 보지 않는 안내',await evaluate("document.getElementById('review-comment').placeholder==='예) 담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다.'&&document.getElementById('review-help').textContent==='AI는 앞선 결과를 보지 않고 전사를 다시 읽습니다. 위치보다 무엇이 어떻게 틀렸는지 적어 주세요.'"));
      await evaluate("document.getElementById('review-panel').scrollIntoView()");await shot('보완-'+width+'-의견안내.png');await click('#close-result');
      await click('#open-settings');await click('[data-pick-folder=summary]');await wait(60);await click('#close-settings');
      await evaluate("__mock.copyReport={ok:false,written:[{kind:'summaryMd',name:'회의.md'}],failed:[{kind:'summaryTxt',message:'권한이 없습니다.'},{kind:'summaryTxt',message:'권한이 없습니다.'}],skipped:[]}");await click('#history button');await wait(60);
      check(width+'px T2 사본 일부 실패는 종류·이유·재시도를 한 번씩 안내',await evaluate("document.getElementById('copies-state').textContent.includes('고른 폴더의 사본을 확인하지 못했습니다: 요약본(.txt) — 권한이 없습니다. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.')"));
      await evaluate("document.getElementById('copies-panel').scrollIntoView()");await shot('보완-'+width+'-사본실패.png');
      await evaluate("__mock.copiesResult={ok:true,written:[],failed:[],skipped:[{kind:'summaryMd',reason:'이미 저장했습니다'}]}");await click('#save-copies');await wait(60);
      check(width+'px T2 이미 저장된 사본은 새 사본 없음 안내',await evaluate("document.getElementById('copies-state').textContent.includes('고른 폴더에 새로 저장할 사본이 없습니다.')"));
      await shot('보완-'+width+'-이미저장.png');
      await evaluate('__mock.copiesResult=null');await click('#save-copies');await wait(60);
      check(width+'px T2 성공한 사본 종류를 안내',await evaluate("document.getElementById('copies-state').textContent.includes('고른 폴더에 사본을 저장했습니다: 요약본(.md).')"));
      await click('#tab-transcript');
      check(width+'px T3 전사문 탭에는 사본 구역이 보이지 않음',await evaluate("document.getElementById('panel-minutes').contains(document.getElementById('copies-panel'))&&!document.getElementById('copies-panel').getClientRects().length"));
      await shot('보완-'+width+'-전사문탭.png');await click('#close-result');await click('#history button:last-of-type');await wait(60);
      check(width+'px T3 정리본 없는 회의에는 빈 사본 구역이 없음',await evaluate("document.getElementById('copies-panel').hidden"));await shot('보완-'+width+'-결과없음.png');await click('#close-result');
      await evaluate("__mock.versions=[{id:'1234',savedAt:Date.parse('2026-10-28T01:30:00Z'),outputFormat:'meeting'}]");await click('#history button');await wait(60);
      check(width+'px T4 결과 하나면 버전 선택을 숨김',await evaluate("document.getElementById('version-wrap').hidden&&document.getElementById('result-version').value==='1234'"));await shot('보완-'+width+'-결과하나.png');await click('#close-result');
      await evaluate("__mock.versions=[{id:'1233',savedAt:Date.parse('2026-10-28T01:30:00Z'),outputFormat:'meeting'},{id:'1234',savedAt:Date.parse('2026-10-28T02:30:00Z'),outputFormat:'meeting'}]");await click('#history button');await wait(60);
      check(width+'px T4 같은 형식의 결과도 저장 시각으로 구분',await evaluate("!document.getElementById('version-wrap').hidden&&document.getElementById('result-version').options[0].textContent==='1번째 결과 · 10월 28일 10:30 · 회의록'&&document.getElementById('result-version').options[1].textContent==='2번째 결과 · 10월 28일 11:30 · 회의록'"));await shot('보완-'+width+'-저장시각.png');
      await evaluate("document.getElementById('result-version').value='1233';document.getElementById('result-version').dispatchEvent(new Event('change'))");await wait(60);
      await evaluate("document.getElementById('review-comment').value='앞선 결과에서 쓴 의견을 그대로 둡니다';document.getElementById('review-comment').dispatchEvent(new Event('input'))");await click('#refine');
      await until("__mock.active&&document.getElementById('review-comment').disabled");
      await evaluate("__mock.active=false;__mock.meeting={...__mock.meeting,state:'failed',resultId:'1234',message:'API 잔액을 확인하세요.'}");
      await until("document.getElementById('meeting-status').textContent.includes('잔액')&&!document.getElementById('review-comment').disabled");
      check(width+'px T5 서비스 실패도 시작한 버전과 의견을 유지',await evaluate("document.getElementById('result-version').value==='1233'&&document.getElementById('review-comment').value==='앞선 결과에서 쓴 의견을 그대로 둡니다'&&document.getElementById('minutes').textContent.includes('앞선 결과입니다.')&&document.getElementById('review-state').textContent.includes('다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.')"));
      await evaluate("document.getElementById('review-panel').scrollIntoView()");await shot('보완-'+width+'-서비스실패.png');await click('#close-result');
      await load();await key();await click('#open-settings');await evaluate("__mock.importFile='설정_'+'x'.repeat(120)+'.json'");await click('#import-settings');await wait(60);
      check(width+'px T6 긴 파일 이름이 미리보기 안에서 줄바꿈',await evaluate("(()=>{const d=document.getElementById('settings-preview'),f=document.getElementById('preview-file');return d.open&&f.textContent.includes('x'.repeat(120))&&d.scrollWidth<=d.clientWidth&&f.scrollWidth<=f.clientWidth})()"));await shot('보완-'+width+'-긴파일이름.png');await click('#cancel-settings');await click('#close-settings');
      await click('#history button:nth-of-type(2)');await wait(60);await evaluate("document.getElementById('review-comment').value='두 번째 회의를 다시 정리합니다';document.getElementById('review-comment').dispatchEvent(new Event('input'))");await click('#refine');
      await until("__mock.active&&document.getElementById('review-comment').disabled");await evaluate("__mock.active=false;__mock.history[1].resultId='1235';__mock.meeting={...__mock.meeting,state:'complete',resultId:'1235',message:'회의록 저장 완료'}");
      await until("document.getElementById('result-version').value==='1235'&&!document.getElementById('review-comment').disabled");await click('#close-result');
      check(width+'px T7 다시 정리 뒤 닫으면 그 회의로 초점 복귀',await evaluate("document.activeElement.dataset.location==='p2'&&document.activeElement.dataset.id==='22222222-2222-2222-2222-222222222222'"));await shot('보완-'+width+'-초점복귀.png');
    }

    for(const width of [360,390,412]){
      await viewport(width);await load();await click('#prepare');
      const fit=await evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth})");
      check(width+'px 회의명 빈칸 안내 전체 표시',await evaluate("(()=>{const e=document.getElementById('title-hint');if(!e)return false;const r=e.getBoundingClientRect();return e.textContent.includes('비워 두면 AI가 회의 내용을 보고 정합니다')&&r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth})()"));
      check(width+'px 준비 화면 가로 넘침 없음',fit.scroll<=fit.width,JSON.stringify(fit));await shot('모바일-'+width+'-준비.png');
      await click('#prepare');await shot('모바일-'+width+'-첫화면.png');
    }
    await viewport(390);await load();
    check('프로젝트·동의 입력이 없고 회의명은 선택 입력으로 남는다',await evaluate("!document.querySelector('#open-projects,#projects,#record-consent,#ai-consent,#retry-consent')&&!!document.querySelector('#title')"));
    check('OpenAI 전송 시작 안내가 보인다',await evaluate("document.body.innerText.includes('녹음 전에 참석자에게 녹음과 AI 분석(OpenAI 전송)을 알려 주세요.')"));
    check('옛 보관함과 새 회의를 하나의 목록으로 읽고 손상 기록 수를 알린다',await evaluate("document.querySelectorAll('#history button').length===3&&document.getElementById('history').innerText.includes('읽지 못한 기록 2개')"));
    check('옛 프로젝트 꼬리표·별점·제목 미정 표시를 읽을 수 있다',await evaluate("(()=>{const t=document.getElementById('history').innerText;return t.includes('이전 프로젝트: 홈페이지 개편')&&t.includes('★')&&t.includes('제목 미정 회의')})()"));
    check('유휴 상태에는 진행 중 설정 잠금 안내를 숨긴다',await evaluate("document.getElementById('settings-lock').hidden"));
    await key();check('키만 등록한 기본 상태에서 회의 시작 가능',await evaluate("!document.getElementById('start').disabled"));
    const hasHistory=await evaluate("!!document.querySelector('#history button')");
    if(hasHistory){
      await click('#history button');await wait(90);
      check('옛 보관함의 결과 본문을 연다',await evaluate("!document.getElementById('result').hidden&&document.getElementById('meeting-title').textContent==='옛 첫째'&&document.getElementById('minutes').innerText.includes('회의 내용을 보존')"));
      await click('#copy-result');await click('#share-result');await wait(80);
      check('복사·공유가 보고 있는 보관함과 결과를 보낸다',await evaluate("__mock.calls.filter(c=>['copy','share'].includes(c.method)).length===2&&__mock.calls.filter(c=>['copy','share'].includes(c.method)).every(c=>c.data.location==='p1'&&c.data.resultId==='1234'&&!('slot' in c.data))"));
      await click('#close-result');await wait(30);
      check('결과를 닫으면 원래 목록 항목으로 초점 복귀',await evaluate("document.activeElement===document.querySelector('#history button')"));
    }else check('옛 결과 열기·복사·공유 경로',false,'목록 항목이 없습니다');
    await click('#prepare');await evaluate("document.getElementById('notes').value='이번 안건';document.getElementById('notes').dispatchEvent(new Event('input',{bubbles:true}))");
    await click('#start');await wait(120);
    check('시작 요청에 메모는 있고 프로젝트·동의 칸은 없다',await evaluate("(()=>{const d=__mock.calls.filter(c=>c.method==='start').at(-1)?.data;return d&&d.notes==='이번 안건'&&d.title===''&&!('slot' in d)&&!('recordConsent' in d)&&!('aiConsent' in d)})()"));
    check('녹음 중 상태와 종료 버튼 표시',await evaluate("!document.getElementById('finish').hidden&&document.body.classList.contains('recording')"));
    await click('#open-settings');await wait(40);
    check('진행 중 키·모델·내 형식 변경 잠금',await evaluate("!document.getElementById('settings-lock').hidden&&document.getElementById('save-key').disabled&&document.getElementById('api-key').disabled&&[...document.querySelectorAll('input[name=persist]')].every(e=>e.disabled)&&document.getElementById('model').disabled&&document.getElementById('custom-save').disabled"));
    await shot('모바일-390-녹음중-설정.png');await click('#close-settings');
    await load();await key();await click('#prepare');await evaluate("document.getElementById('notes').value='a'.repeat(4001);document.getElementById('notes').dispatchEvent(new Event('input',{bubbles:true}))");
    check('4,001자 메모는 화면에서 시작을 막는다',await evaluate("document.getElementById('start').disabled"));
    await viewport(360,420);await load();await click('#open-settings');await evaluate("document.getElementById('api-key').focus()");
    check('작은 화면의 설정 창이 화면 안에 들어온다',await evaluate("(()=>{const r=document.getElementById('settings').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()"));
    await shot('모바일-360-설정.png');
    await viewport(390,820);await load();await key();
    await click('#history button');await wait(60);
    check('출력 형식에 맞는 결과 제목과 복사 버튼',await evaluate("document.getElementById('minutes').innerText.startsWith('업무 요약')&&document.getElementById('copy-result').textContent.includes('업무 정리 복사')"));
    await click('#tab-transcript');
    check('전사문 탭은 저장된 원문과 글자 수를 보여 준다',await evaluate("!document.getElementById('panel-transcript').hidden&&document.getElementById('transcript').textContent==='저장된 전사'&&document.getElementById('transcript-meta').textContent.includes('자')"));
    await click('#copy-result');await click('#share-result');await wait(40);
    check('전사문 복사·공유도 같은 결과와 전사 종류를 보낸다',await evaluate("__mock.calls.filter(c=>['copy','share'].includes(c.method)).every(c=>c.data.kind==='transcript'&&c.data.location==='p1'&&c.data.resultId==='1234')"));
    await evaluate("document.querySelector('#result details.more').open=true");await click('#share-all');await wait(30);
    check('음성 포함 내보내기도 원래 보관함을 보낸다',await evaluate("__mock.calls.filter(c=>c.method==='share').at(-1).data.kind==='all'&&__mock.calls.filter(c=>c.method==='share').at(-1).data.location==='p1'"));
    check('준비 메모와 모델별 사용량이 결과에 남는다',await evaluate("document.getElementById('meeting-notes').textContent==='이번 안건'&&document.getElementById('usage').innerText.includes('18,234')&&document.getElementById('usage').innerText.includes('미제공')"));
    await shot('모바일-390-결과.png');await click('#close-result');
    await click('#open-settings');
    check('설정 모달에 초점이 들어가고 뒤로 가기로 복귀한다',await evaluate("document.getElementById('settings').contains(document.activeElement)&&window.handleBack()"));
    await wait(20);check('설정 닫기 후 설정 버튼으로 초점 복귀',await evaluate("document.activeElement.id==='open-settings'"));
    await click('#prepare');await evaluate("document.getElementById('output-format').value='custom';document.getElementById('output-format').dispatchEvent(new Event('change'))");
    check('내 형식이 없으면 설정 안내와 시작 잠금',await evaluate("document.getElementById('start').disabled&&!document.getElementById('custom-missing').hidden&&document.getElementById('blocker-list').innerText.includes('내 형식')"));
    await click('#open-format-settings');
    await evaluate("document.getElementById('custom-name').value='주간 보고'");await click('#custom-save');await wait(60);
    check('내 형식 저장 후 선택지와 예시를 갱신한다',await evaluate("document.querySelector('#output-format option[value=custom]').textContent.includes('주간 보고')&&!document.getElementById('start').disabled"));
    await shot('모바일-390-내형식.png');await click('#close-settings');await click('#start');await wait(60);
    check('시작 요청에 내 형식 정의와 고른 형식을 보존한다',await evaluate("(()=>{const d=__mock.calls.filter(c=>c.method==='start').at(-1).data;return d.outputFormat==='custom'&&d.customFormat.name==='주간 보고'})()"));
    await load();await evaluate("__mock.access={accessMode:'trial',mustRegister:false,trialLimit:3,trialRemaining:1}");
    check('체험 연결 상태 갱신 뒤 시작 가능 여부가 맞다',await until("document.getElementById('connection').textContent==='체험 1회'&&!document.getElementById('start').disabled"),JSON.stringify(await evaluate("({chip:document.getElementById('connection').textContent,disabled:document.getElementById('start').disabled,blockers:document.getElementById('blocker-list').innerText,statusCalls:__mock.calls.filter(c=>c.method==='status').length})")));
    await evaluate("__mock.access={accessMode:'exhausted',mustRegister:true,trialLimit:3,trialRemaining:0}");
    check('체험 소진 뒤 시작과 재분석 안내를 갱신한다',await until("document.getElementById('start').disabled&&document.getElementById('blocker-list').innerText.includes('새로운 API키를 등록하세요.')"),JSON.stringify(await evaluate("({chip:document.getElementById('connection').textContent,disabled:document.getElementById('start').disabled,blockers:document.getElementById('blocker-list').innerText,statusCalls:__mock.calls.filter(c=>c.method==='status').length})")));
    await click('#history button');await wait(40);await evaluate("document.querySelector('#result details.more').open=true");await click('#retry');await wait(40);
    check('분석할 키가 없으면 요청 대신 설정을 연다',await evaluate("document.getElementById('settings').open&&__mock.calls.filter(c=>c.method==='analyze').length===0"));

    await load();await key();
    await evaluate("window.__settingsBridgeForTest('applySettings',{token:'합성 확인'})");
    check('2판 적용 응답으로 모델·내 형식 표시를 함께 갱신한다',await evaluate("document.getElementById('model').value==='gpt-6-luna'&&document.querySelector('#output-format option[value=custom]').textContent.includes('불러온 형식')"));
    await click('#open-settings');await shot('모바일-390-2판-모델적용.png');await click('#close-settings');
    await click('#open-settings');await evaluate("document.getElementById('custom-name').value='지울 형식'");await click('#custom-save');await wait(60);await click('#close-settings');
    await evaluate("__mock.importEmpty=true;window.__settingsBridgeForTest('applySettings',{token:'합성 확인'})");
    check('2판 null 응답이면 남아 있던 내 형식 표시를 지운다',await evaluate("document.querySelector('#output-format option[value=custom]').textContent==='내 형식 (새로 만들기)'"));
    await shot('모바일-390-2판-형식삭제.png');

    await load();await key();await click('#history button:last-child');await wait(60);
    check('결과 없는 회의를 열 때 null 결과 칸을 보내지 않는다',await evaluate("!document.getElementById('result').hidden&&!document.getElementById('retry').disabled&&__mock.calls.filter(c=>c.method==='open').every(c=>!('resultId' in c.data))"));
    await load('?draftFailure=1');
    check('초안 읽기 실패 뒤에도 목록·상태를 불러온다',await evaluate("document.querySelectorAll('#history button').length===3&&__mock.calls.some(c=>c.method==='status')"));

    await load();await key();await click('#open-settings');
    check('설정은 네 구역이며 내 형식은 회의 준비 밖에 있다',await evaluate("document.querySelectorAll('#settings .settings-section').length===4&&document.querySelector('#settings #custom-editor')&&!document.querySelector('#prep #custom-editor')&&document.getElementById('settings-title').textContent==='설정'"));
    await evaluate("document.getElementById('default-format').value='tasks';document.getElementById('default-format').dispatchEvent(new Event('change'))");await wait(60);
    check('기본 출력 형식을 저장하고 새 회의에 적용한다',await evaluate("__mock.calls.some(c=>c.method==='saveSettings'&&c.data.defaultOutputFormat==='tasks')&&document.getElementById('output-format').value==='tasks'"));
    await click('[data-pick-folder=summary]');await wait(60);
    check('폴더 고르기는 pickFolder를 부르고 고른 폴더 이름을 보여 준다',await evaluate("__mock.calls.some(c=>c.method==='pickFolder'&&c.data.kind==='summary')&&document.getElementById('folder-summary').textContent.includes('회의 기록을 오래 보관하는 폴더 summary')"));
    await evaluate('__mock.cancelFolder=true');await click('[data-pick-folder=audio]');await wait(60);
    check('폴더 선택 취소는 다른 저장 위치를 바꾸지 않는다',await evaluate("document.getElementById('folder-audio').textContent==='사용 안 함'&&document.getElementById('folder-summary').textContent.includes('summary')"));
    await click('#export-settings');await wait(40);await click('#import-settings');await wait(60);
    check('불러오기 미리보기는 적용 전 값과 저장 위치 제외를 알린다',await evaluate("document.getElementById('settings-preview').open&&document.getElementById('settings-preview-body').textContent.includes('불러온 형식')&&document.getElementById('settings-preview-body').textContent.includes('Android에서는 저장 위치를 적용하지 않습니다')&&!__mock.calls.some(c=>c.method==='applySettings')"));
    await click('#apply-settings');await wait(60);
    check('확인한 설정만 토큰으로 적용한다',await evaluate("__mock.calls.some(c=>c.method==='applySettings'&&c.data.token==='검토-합성')&&!document.getElementById('settings-preview').open&&document.getElementById('model').value==='gpt-6-luna'"));
    await click('[data-clear-folder=summary]');await wait(60);
    check('사용 안 함은 해당 종류만 해제한다',await evaluate("__mock.calls.some(c=>c.method==='clearFolder'&&c.data.kind==='summary')&&document.getElementById('folder-summary').textContent==='사용 안 함'"));
    await click('#close-settings');await click('#history button');await wait(60);
    check('저장 위치가 없으면 다시 저장 버튼 대신 안내한다',await evaluate("document.getElementById('save-copies').hidden&&!document.getElementById('copies-guide').hidden"));
    await click('[data-stars="4"]');await click('[data-stars="4"]');
    check('같은 별을 다시 누르면 선택을 해제한다',await evaluate("[...document.querySelectorAll('[data-stars]')].every(e=>e.getAttribute('aria-pressed')==='false')&&document.getElementById('save-review').disabled"));
    await evaluate("document.getElementById('review-comment').value='  담당자를 확인해 주세요.  ';document.getElementById('review-comment').dispatchEvent(new Event('input'))");
    check('의견이 있을 때만 요금 안내와 다시 정리가 활성화된다',await evaluate("!document.getElementById('refine').disabled&&!document.getElementById('refine-cost').hidden"));
    await click('#save-review');await wait(60);
    check('평가는 보고 있는 결과에 앞뒤 공백을 지워 저장한다',await evaluate("__mock.calls.filter(c=>c.method==='review').at(-1).data.resultId==='1234'&&__mock.reviews['1234'].comment==='담당자를 확인해 주세요.'"));
    await evaluate("document.getElementById('review-comment').value='x'.repeat(1001);document.getElementById('review-comment').dispatchEvent(new Event('input'))");
    check('1,001자 의견은 평가와 다시 정리를 막는다',await evaluate("document.getElementById('save-review').disabled&&document.getElementById('refine').disabled"));
    await evaluate("document.getElementById('result-version').value='1233';document.getElementById('result-version').dispatchEvent(new Event('change'))");await wait(60);
    check('앞선 버전은 본문·형식·평가와 의견 반영 표시가 바뀐다',await evaluate("document.getElementById('minutes').textContent.includes('앞선 결과입니다.')&&document.getElementById('copy-result').textContent.includes('핵심 요약')&&!document.getElementById('refined-badge').hidden&&document.getElementById('review-comment').value===''"));
    await evaluate("document.getElementById('result-version').value='1234';document.getElementById('result-version').dispatchEvent(new Event('change'))");await wait(60);
    check('최신 버전으로 돌아오면 그 평가를 다시 연다',await evaluate("document.getElementById('review-comment').value==='담당자를 확인해 주세요.'&&document.getElementById('refined-badge').hidden"));
    await evaluate('__mock.delay=180');await click('#refine');await wait(35);
    check('평가 저장을 기다리는 동안 버전과 결과 조작을 잠근다',await evaluate("document.getElementById('result-version').disabled&&document.getElementById('copy-result').disabled&&document.getElementById('save-review').disabled"));
    await wait(430);
    check('의견 반영은 평가 저장 뒤 다듬은 의견으로 요청한다',await evaluate("(()=>{const c=__mock.calls,r=c.findLastIndex(x=>x.method==='refine');return r>0&&c.slice(0,r).filter(x=>!['history','status','saveDraft'].includes(x.method)).at(-1)?.method==='review'&&c[r].data.feedback==='담당자를 확인해 주세요.'&&c[r].data.resultId==='1234'&&!c.some(x=>x.method==='analyze')})()"));

    await load();await key();await evaluate('__mock.noTranscript=true');await click('#history button');await wait(60);
    await evaluate("document.getElementById('review-comment').value='고쳐 주세요';document.getElementById('review-comment').dispatchEvent(new Event('input'))");await click('#refine');await wait(60);
    check('전사가 없어도 평가부터 저장하고 재전사 없이 안내한다',await evaluate("__mock.calls.some(c=>c.method==='review')&&!__mock.calls.some(c=>c.method==='refine'||c.method==='analyze')&&document.getElementById('message').textContent.includes('저장된 전사가 없어')"));
    await load();await click('#history button');await wait(60);await evaluate("document.getElementById('review-comment').value='고쳐 주세요';document.getElementById('review-comment').dispatchEvent(new Event('input'))");await click('#refine');await wait(60);
    check('키가 없어도 평가는 남기고 AI 연결을 연다',await evaluate("__mock.calls.some(c=>c.method==='review')&&!__mock.calls.some(c=>c.method==='refine')&&document.getElementById('settings').open"));

    await load();await key();await click('#prepare');await evaluate("document.getElementById('output-format').value='summary';document.getElementById('output-format').dispatchEvent(new Event('change'))");await click('#open-settings');
    await evaluate("document.getElementById('custom-name').value='아직 저장 안 한 초안';__mock.delay=160");await click('[data-pick-folder=audio]');await wait(25);
    check('폴더 선택 중에는 모델·내 형식·파일·시작을 모두 잠근다',await evaluate("document.getElementById('model').disabled&&document.getElementById('custom-save').disabled&&document.getElementById('export-settings').disabled&&document.getElementById('default-format').disabled&&document.getElementById('start').disabled&&[...document.querySelectorAll('[data-pick-folder]')].every(e=>e.disabled)"));await wait(180);
    check('폴더 변경은 미저장 형식 초안과 이번 회의 형식을 덮지 않는다',await evaluate("document.getElementById('custom-name').value==='아직 저장 안 한 초안'&&document.getElementById('output-format').value==='summary'"));
    await evaluate('__mock.delay=0;__mock.unknownModel=true');await click('#import-settings');await wait(50);
    check('없는 모델은 적용하지 않는 이유를 미리 알린다',await evaluate("document.getElementById('settings-preview-body').textContent.includes('목록에 없어 적용하지 않습니다')"));await click('#cancel-settings');await wait(40);
    check('미리보기 취소는 적용하지 않고 불러온 토큰을 버린다',await evaluate("__mock.calls.some(c=>c.method==='cancelSettings')&&!__mock.calls.some(c=>c.method==='applySettings')&&document.activeElement.id==='import-settings'"));
    await evaluate('__mock.legacyImport=true');await click('#import-settings');await wait(40);
    check('1판 파일은 기존 설정을 유지한 채 이유를 알린다',await evaluate("!document.getElementById('settings-preview').open&&document.getElementById('message').textContent.includes('이전 버전의 프로젝트 설정')&&!__mock.calls.some(c=>c.method==='applySettings')"));await click('#close-settings');
    await click('#history button');await wait(40);await click('[data-stars="5"]');
    check('별점만 남길 때는 비용 안내와 다시 정리를 숨기거나 잠근다',await evaluate("!document.getElementById('save-review').disabled&&document.getElementById('refine').disabled&&document.getElementById('refine-cost').hidden"));await click('#save-review');await wait(40);await click('#close-result');
    check('평가 뒤 목록이 갱신되어도 같은 회의로 초점이 돌아온다',await evaluate("document.activeElement===document.querySelector('#history button')&&__mock.reviews['1234'].stars===5"));
    await click('#history button');await wait(40);await evaluate("__mock.failReview=true;document.getElementById('review-comment').value='고쳐 주세요';document.getElementById('review-comment').dispatchEvent(new Event('input'))");await click('#refine');await wait(40);
    check('평가를 저장하지 못하면 유료 재정리를 요청하지 않는다',await evaluate("!__mock.calls.some(c=>c.method==='refine')&&document.getElementById('message').textContent==='평가 저장 실패'"));
    await evaluate('__mock.failReview=false;__mock.failRefine=true');await click('#refine');await wait(40);
    check('재정리 요청 실패에도 이전 결과와 저장된 평가는 남는다',await evaluate("document.getElementById('result-version').value==='1234'&&document.getElementById('minutes').textContent.includes('회의 내용을 보존')&&__mock.reviews['1234'].comment==='고쳐 주세요'&&document.getElementById('message').textContent.includes('요약 요청에 실패')"));
    await evaluate('__mock.failRefine=false');await click('#refine');await wait(40);
    check('요약이 진행 중이면 평가와 설정 변경을 잠근다',await evaluate("document.getElementById('save-review').disabled&&document.getElementById('result-version').disabled&&document.getElementById('meeting-status').textContent.includes('정리 중')"));
    await evaluate("__mock.active=false;__mock.history[0].resultId='1235';__mock.meeting={...__mock.meeting,state:'complete',resultId:'1235',message:'회의록을 저장했습니다.'}");
    check('재정리 완료 뒤 새 버전과 의견 반영 표시를 열고 평가는 비워 둔다',await until("document.getElementById('result-version').value==='1235'&&document.getElementById('result-version').options.length===3&&!document.getElementById('refined-badge').hidden&&!document.getElementById('review-comment').disabled&&document.getElementById('review-comment').value===''&&document.getElementById('save-review').disabled&&document.getElementById('refine').disabled"));
    await click('[data-stars="4"]');await click('#save-review');await wait(50);
    check('새 버전에 남긴 평가는 앞선 버전의 평가와 따로 저장한다',await evaluate("__mock.reviews['1235'].stars===4&&__mock.reviews['1234'].comment==='고쳐 주세요'&&__mock.calls.filter(c=>c.method==='review').at(-1).data.resultId==='1235'"));

    for(const width of [360,390,412]){
      await viewport(width);await load();await key();await click('#open-settings');await shot('모바일-'+width+'-설정-AI.png');
      await evaluate("document.getElementById('settings-format').scrollIntoView()");await shot('모바일-'+width+'-설정-출력형식.png');
      await click('[data-pick-folder=summary]');await wait(60);await evaluate("document.getElementById('settings-storage').scrollIntoView()");await shot('모바일-'+width+'-설정-저장위치.png');
      check(width+'px 설정 내용 가로 넘침 없음',await evaluate("document.getElementById('settings').scrollWidth<=document.getElementById('settings').clientWidth"));
      check(width+'px 설정 머리글과 닫기가 화면 안에 남는다',await evaluate("(()=>{const e=document.getElementById('close-settings'),r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()"));
      await click('#close-settings');await evaluate("__mock.copyReport={ok:false,written:[{kind:'summaryMd',name:'회의.md'}],failed:[{kind:'summaryTxt',message:'고른 폴더를 찾을 수 없거나 권한이 끊겨 다시 골라야 합니다'}],skipped:[]}");await click('#history button');await wait(60);
      await evaluate("document.getElementById('result-version').focus()");await shot('모바일-'+width+'-결과버전.png');
      await evaluate("document.getElementById('review-comment').value='담당자가 틀렸습니다. 문서 정리는 담당자가 다음 주까지 하기로 했습니다.';document.getElementById('review-comment').dispatchEvent(new Event('input'));document.getElementById('review-panel').scrollIntoView()");await shot('모바일-'+width+'-평가.png');
      await evaluate("document.getElementById('copies-panel').scrollIntoView()");await shot('모바일-'+width+'-사본실패.png');
      check(width+'px 결과와 의견 구역 가로 넘침 없음',await evaluate("document.getElementById('result').scrollWidth<=document.getElementById('result').clientWidth"));
      check(width+'px 실패 종류와 원인을 표시한다',await evaluate("document.getElementById('copies-state').textContent.includes('요약본(.txt)')&&document.getElementById('copies-state').textContent.includes('권한')&&!document.getElementById('save-copies').hidden"));
      await click('#save-copies');await wait(60);
      check(width+'px 사본 재시도는 선택 결과를 보존한다',await evaluate("__mock.calls.filter(c=>c.method==='copies').at(-1).data.resultId==='1234'&&document.getElementById('copies-state').textContent.includes('회의.md')"));
    }
  }finally{if(ws)ws.close();proc.kill();server.close();await wait(250);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
  const report=results.join('\n')+'\n'+(failures?'FAIL ':'PASS ')+(results.length-failures)+'/'+results.length+'\n';
  fs.writeFileSync(path.join(outDir,'브라우저검증결과.txt'),report,'utf8');process.stdout.write(report);process.exitCode=failures?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
