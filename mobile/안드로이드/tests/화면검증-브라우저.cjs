// 모의 네이티브 브리지로 실제 화면 파일을 헤드리스 Chrome에 띄워 폭·순서·모달·포커스를 검증한다.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const assets = path.join(__dirname, '..', 'assets');
const outDir = process.argv[2] || path.join(os.tmpdir(), 'voicenote-screens');
const chromePath = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(outDir, { recursive: true });

const mock = "(() => {\n  const minutes={overview:'전체 방향 | 회의 내용을 보존합니다.',topics:[{title:'보관함',points:['원래 보관함에서 기록을 엽니다.']}],decisions:[],actions:[],openQuestions:[]};\n  const records=[\n    {id:'11111111-1111-1111-1111-111111111111',location:'p1',resultId:'1234',date:'2026-10-23',dailySequence:1,title:'옛 첫째',projectName:'홈페이지 개편',state:'complete',outputFormat:'tasks',createdAt:1,stars:4,notes:'이번 안건',analysis:{usage:[{model:'gpt-6-sol',inputTokens:18234,outputTokens:3120,totalTokens:21354,requests:3},{model:'gpt-transcribe',inputTokens:null,outputTokens:null,totalTokens:null,requests:1}]},audio:[]},\n    {id:'22222222-2222-2222-2222-222222222222',location:'p2',resultId:'legacy',date:'2026-10-22',dailySequence:1,title:'옛 둘째',projectName:'문서 정리',state:'complete',createdAt:1,audio:[]},\n    {id:'33333333-3333-3333-3333-333333333333',location:'main',date:'2026-10-21',dailySequence:1,title:'',state:'saved',createdAt:1,audio:[]}\n  ];\n  const models=[{id:'gpt-6.1-sol',label:'Sol 표준',maxOutputTokens:32000},{id:'gpt-6-luna',label:'Luna',maxOutputTokens:8000}];\n  const m=window.__mock={key:false,model:models[0].id,active:false,meeting:{},history:records,calls:[],draft:{},customFormat:null,access:null};\n  const connection=()=>({keyConfigured:m.key,keySource:m.key?'session':'none',models,summaryModel:m.model,active:m.active,...(m.access||{})});\n  window.Native={request(id,method,json){\n    const d=JSON.parse(json);m.calls.push({method,data:d});let value,error=null;\n    try{\n      switch(method){\n        case 'init':value={presets:[{name:'',title:'',context:'',outputFormat:'meeting'}],connection:connection(),customFormat:m.customFormat,settings:{defaultOutputFormat:'meeting'}};break;\n        case 'applySettings':m.model=models[1].id;m.customFormat=m.importEmpty?null:{name:'불러온 형식',sections:[{key:'overview',title:'요약'}],instruction:''};value={settings:{summaryModel:m.model,defaultOutputFormat:'custom'},connection:connection(),customFormat:m.customFormat,skipped:[]};break;\n        case 'status':value={active:m.active,meeting:m.meeting,connection:connection()};break;\n        case 'history':value={meetings:m.history,skipped:2};break;\n        case 'draft':value=m.draft;break;\n        case 'saveDraft':m.draft=d;value=true;break;\n        case 'key':if(m.active)throw Error('진행 중에는 키를 바꿀 수 없습니다.');m.key=true;value=connection();break;\n        case 'removeKey':m.key=false;value=connection();break;\n        case 'model':if(m.active)throw Error('진행 중에는 설정을 바꿀 수 없습니다.');m.model=d.model;value=connection();break;\n        case 'open':{\n          const record=m.history.find(r=>r.location===d.location&&r.id===d.id);if(!record)throw Error('보관함 연결 오류');\n          value={record,minutes:record.state==='complete'?minutes:null,transcript:'저장된 전사',resultId:record.resultId,versions:[],review:null};break;\n        }\n        case 'start':\n          if('slot' in d||'recordConsent' in d||'aiConsent' in d)throw Error('옛 시작 요청을 보냈습니다.');\n          m.active=true;m.meeting={id:'44444444-4444-4444-4444-444444444444',location:'main',state:'recording',createdAt:Date.now(),message:'회의 녹음 중'};m.draft={};value={id:m.meeting.id};break;\n        case 'finish':m.meeting.state='analyzing';value=true;break;\n        case 'analyze':if(d.location!=='p1')throw Error('원래 보관함이 아닙니다.');value={id:d.id};break;\n        case 'copy':case 'share':if(d.location!=='p1'||d.resultId!=='1234')throw Error('결과 연결 오류');value=true;break;\n        case 'saveCustomFormat':m.customFormat=d.customFormat;value=d.customFormat;break;\n        case 'deleteCustomFormat':m.customFormat=null;value=null;break;\n        default:throw Error('지원하지 않는 요청 '+method);\n      }\n    }catch(ex){error=ex.message;}setTimeout(()=>window.receive(id,{value,error}),0);\n  }};\n})();";

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
    await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:mock});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
    const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
    const viewport=(width,height=820)=>send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true});
    const load=async()=>{await send('Page.navigate',{url:base});await wait(450);};
    const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(outDir,name),Buffer.from(r.data,'base64'));};
    const key=async()=>{await click('#open-settings');await evaluate("document.getElementById('api-key').value='sk-test-00000000000000000000'");await click('#save-key');await wait(60);await click('#close-settings');};
    for(const width of [360,390,412]){
      await viewport(width);await load();await click('#prepare');
      const fit=await evaluate("({scroll:document.documentElement.scrollWidth,width:innerWidth})");
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
    check('내 형식이 없으면 저장 안내와 시작 잠금',await evaluate("document.getElementById('start').disabled&&!document.getElementById('custom-editor').hidden&&document.getElementById('blocker-list').innerText.includes('내 형식')"));
    await evaluate("document.getElementById('custom-name').value='주간 보고'");await click('#custom-save');await wait(60);
    check('내 형식 저장 후 선택지와 예시를 갱신한다',await evaluate("document.querySelector('#output-format option[value=custom]').textContent.includes('주간 보고')&&!document.getElementById('start').disabled"));
    await shot('모바일-390-내형식.png');await click('#start');await wait(60);
    check('시작 요청에 내 형식 정의와 고른 형식을 보존한다',await evaluate("(()=>{const d=__mock.calls.filter(c=>c.method==='start').at(-1).data;return d.outputFormat==='custom'&&d.customFormat.name==='주간 보고'})()"));
    await load();await evaluate("__mock.access={accessMode:'trial',mustRegister:false,trialLimit:3,trialRemaining:1}");await wait(1600);
    check('체험 연결 상태 갱신 뒤 시작 가능 여부가 맞다',await evaluate("document.getElementById('connection').textContent==='체험 1회'&&!document.getElementById('start').disabled"));
    await evaluate("__mock.access={accessMode:'exhausted',mustRegister:true,trialLimit:3,trialRemaining:0}");await wait(1600);
    check('체험 소진 뒤 시작과 재분석 안내를 갱신한다',await evaluate("document.getElementById('start').disabled&&document.getElementById('blocker-list').innerText.includes('새로운 API키를 등록하세요.')"));
    await click('#history button');await wait(40);await evaluate("document.querySelector('#result details.more').open=true");await click('#retry');await wait(40);
    check('분석할 키가 없으면 요청 대신 설정을 연다',await evaluate("document.getElementById('settings').open&&__mock.calls.filter(c=>c.method==='analyze').length===0"));

    await load();await key();
    await evaluate("window.__settingsBridgeForTest('applySettings',{token:'합성 확인'})");
    check('2판 적용 응답으로 모델·내 형식 표시를 함께 갱신한다',await evaluate("document.getElementById('model').value==='gpt-6-luna'&&document.querySelector('#output-format option[value=custom]').textContent.includes('불러온 형식')"));
    await click('#open-settings');await shot('모바일-390-2판-모델적용.png');await click('#close-settings');
    await click('#prepare');await evaluate("document.getElementById('output-format').value='custom';document.getElementById('output-format').dispatchEvent(new Event('change'));document.getElementById('custom-name').value='지울 형식'");await click('#custom-save');await wait(60);
    await evaluate("__mock.importEmpty=true;window.__settingsBridgeForTest('applySettings',{token:'합성 확인'})");
    check('2판 null 응답이면 남아 있던 내 형식 표시를 지운다',await evaluate("document.querySelector('#output-format option[value=custom]').textContent==='내 형식 (새로 만들기)'"));
    await shot('모바일-390-2판-형식삭제.png');

  }finally{if(ws)ws.close();proc.kill();server.close();await wait(250);try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
  const report=results.join('\n')+'\n'+(failures?'FAIL ':'PASS ')+(results.length-failures)+'/'+results.length+'\n';
  fs.writeFileSync(path.join(outDir,'브라우저검증결과.txt'),report,'utf8');process.stdout.write(report);process.exitCode=failures?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
