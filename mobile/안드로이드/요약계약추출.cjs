// Windows 앱의 검증된 Sol 요청 양식을 출력 형식(회의록·핵심 요약·업무 정리)별로, 의견 반영 지시문은 따로 추출하며 실제 API는 호출하지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createMeetingServer}=require(path.resolve(process.argv[3]||path.join(__dirname,'../../desktop/앱/서버.cjs')));
const destination=process.argv[2];
if(!destination)throw new Error('빌드 자산 경로가 필요합니다.');
const formats=['meeting','summary','tasks'],sent={};
let current='';
const server=createMeetingServer({dataDir:path.join(destination,'임시검증'),apiFetch:async(url,options)=>{sent[current]=JSON.parse(options.body);return Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({suggestedTitle:'시험',overview:'시험',topics:[],decisions:[],actions:[],openQuestions:[]})}]}]});}});
const userFields=body=>Object.keys(JSON.parse(body.input.find(item=>item.role==='user').content)).sort().join(',');
const systems=body=>body.input.filter(item=>item.role==='system');
(async()=>{await new Promise(resolve=>server.server.listen(0,'127.0.0.1',resolve));try{const origin=`http://127.0.0.1:${server.server.address().port}`,headers={Origin:origin,'X-Meeting-Token':server.token,'Content-Type':'application/json'};await fetch(origin+'/api/key',{method:'POST',headers,body:JSON.stringify({apiKey:'mock-only',persist:false})});
  const summarize=async(name,extra)=>{current=name;const response=await fetch(origin+'/api/summary',{method:'POST',headers:{...headers,'X-Operation-Id':crypto.randomUUID()},body:JSON.stringify({title:'시험',date:'2026-09-30',participants:'',text:'요약 양식만 확인합니다.',...extra})});if(!response.ok)throw new Error(`${name} 요약 양식 추출 실패: ${await response.text()}`);};
  for(const format of formats)await summarize(format,{outputFormat:format});
  await summarize('feedback',{outputFormat:'meeting',feedback:'의견 양식만 확인합니다.'});
  fs.mkdirSync(destination,{recursive:true});
  for(const format of formats)fs.writeFileSync(path.join(destination,`summary-${format}.json`),JSON.stringify({...sent[format],input:systems(sent[format])}));
  // 서버가 형식을 무시하면 세 양식이 같아지므로 빌드를 멈춘다.
  const bodies=formats.map(format=>fs.readFileSync(path.join(destination,`summary-${format}.json`),'utf8'));
  if(new Set(bodies).size!==formats.length)throw new Error('데스크톱 서버가 출력 형식별 지침을 만들지 않았습니다.');
  // 휴대폰 Ai.java는 사용자 메시지를 title·date·participants·transcript(+notes·previousMinutes·feedback)로 직접 만든다. 데스크톱이 다른 필드를 보내면 빌드를 멈춘다.
  const fields=formats.map(format=>userFields(sent[format]));
  if(new Set(fields).size!==1||fields[0]!=='date,participants,title,transcript')throw new Error('데스크톱 요약 사용자 메시지 필드가 휴대폰과 다릅니다: '+fields.join(' / '));
  if(userFields(sent.feedback)!=='date,feedback,participants,title,transcript')throw new Error('데스크톱 의견 반영 요약 필드가 휴대폰과 다릅니다: '+userFields(sent.feedback));
  // 의견 반영 요청은 일반 회의록 요청에 의견 지시문 하나만 user 바로 앞에 더해야 휴대폰이 같은 자리에 넣을 수 있다.
  const plain=systems(sent.meeting),withFeedback=systems(sent.feedback),input=sent.feedback.input;
  try{assert.deepEqual(withFeedback.slice(0,-1),plain);}catch{throw new Error('의견 반영 요청의 기존 지침이 일반 요청과 다릅니다.');}
  if(withFeedback.length!==plain.length+1||input.at(-1).role!=='user'||input.at(-2)!==withFeedback.at(-1))throw new Error('의견 지시문이 user 바로 앞에 하나만 있지 않습니다.');
  fs.writeFileSync(path.join(destination,'summary-feedback.json'),JSON.stringify(withFeedback.at(-1)));
  console.log('요약 요청 양식 3종과 의견 지시문 추출 완료');}finally{await new Promise(resolve=>server.server.close(resolve));}})().catch(error=>{console.error(error.message);process.exitCode=1;});
