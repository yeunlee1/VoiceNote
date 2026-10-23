// Windows 앱의 검증된 Sol 요청 양식을 출력 형식(회의록·핵심 요약·업무 정리)별로 추출하며 실제 API는 호출하지 않는다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createMeetingServer}=require(path.resolve(process.argv[3]||path.join(__dirname,'../../desktop/앱/서버.cjs')));
const destination=process.argv[2];
if(!destination)throw new Error('빌드 자산 경로가 필요합니다.');
const formats=['meeting','summary','tasks'],captured={};
let current='';
const server=createMeetingServer({dataDir:path.join(destination,'임시검증'),apiFetch:async(url,options)=>{const body=JSON.parse(options.body);captured[current]=JSON.parse(body.input.find(item=>item.role==='user').content);body.input=body.input.filter(item=>item.role==='system');fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,`summary-${current}.json`),JSON.stringify(body));return Response.json({status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({suggestedTitle:'시험',overview:'시험',topics:[],decisions:[],actions:[],openQuestions:[]})}]}]});}});
(async()=>{await new Promise(resolve=>server.server.listen(0,'127.0.0.1',resolve));try{const origin=`http://127.0.0.1:${server.server.address().port}`,headers={Origin:origin,'X-Meeting-Token':server.token,'Content-Type':'application/json'};await fetch(origin+'/api/key',{method:'POST',headers,body:JSON.stringify({apiKey:'mock-only',persist:false})});
  for(const format of formats){current=format;const response=await fetch(origin+'/api/summary',{method:'POST',headers:{...headers,'X-Operation-Id':crypto.randomUUID(),'X-AI-Consent':'yes'},body:JSON.stringify({title:'시험',date:'2026-09-30',participants:'',context:'',outputFormat:format,text:'요약 양식만 확인합니다.'})});if(!response.ok)throw new Error(`${format} 요약 양식 추출 실패`);}
  // 서버가 형식을 무시하면 세 양식이 같아지므로 빌드를 멈춘다.
  const bodies=formats.map(format=>fs.readFileSync(path.join(destination,`summary-${format}.json`),'utf8'));
  if(new Set(bodies).size!==formats.length)throw new Error('데스크톱 서버가 출력 형식별 지침을 만들지 않았습니다.');
  // 휴대폰 Ai.java는 사용자 메시지를 context·title·date·participants·transcript(+notes·previousMinutes)로 직접 만든다. 데스크톱이 형식별로 다른 필드를 보내면 빌드를 멈춘다.
  const fields=formats.map(format=>Object.keys(captured[format]||{}).sort().join(','));
  if(new Set(fields).size!==1||fields[0]!=='context,date,participants,title,transcript')throw new Error('데스크톱 요약 사용자 메시지 필드가 휴대폰과 다릅니다: '+fields.join(' / '));
  console.log('Sol 요청 양식 3종 추출 완료');}finally{await new Promise(resolve=>server.server.close(resolve));}})().catch(error=>{console.error(error.message);process.exitCode=1;});
