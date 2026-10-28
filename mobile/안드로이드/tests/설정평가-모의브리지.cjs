// 설정·평가·결과 버전의 합성 응답을 기존 화면 시험 브리지에 덧붙인다.
module.exports = '(' + function () {
  const m = window.__mock, previous = window.Native.request.bind(window.Native);
  m.storage = { audio: {uri:'',name:''}, transcript:{uri:'',name:''}, summary:{uri:'',name:''} };
  m.defaultOutputFormat = 'meeting'; m.reviews = {}; m.copyReport = {ok:true,written:[],skipped:[],failed:[]};
  const settings = () => ({summaryModel:m.model,defaultOutputFormat:m.defaultOutputFormat,storage:m.storage});
  Object.defineProperty(window, '__settingsResponse', {value:settings});
  window.Native.request = function (id, method, json) {
    const d = JSON.parse(json);
    const reply = (value, error) => setTimeout(() => window.receive(id,{value,error}), m.delay || 0);
    const handled = ['saveSettings','pickFolder','clearFolder','exportSettings','importSettings','cancelSettings','review','refine','copies','open','applySettings'];
    if (!handled.includes(method)) {
      if (method === 'init') {
        const receive = window.receive;
        window.receive = function (rid,payload) { if(rid===id) {payload.value.settings=settings();window.receive=receive;} receive(rid,payload); };
      }
      return previous(id,method,json);
    }
    m.calls.push({method,data:d});
    try {
      if (method==='saveSettings') {m.defaultOutputFormat=d.defaultOutputFormat;reply({settings:settings()});}
      else if (method==='pickFolder') {if(!m.cancelFolder)m.storage[d.kind]={uri:'content://test/tree/'+d.kind,name:'회의 기록을 오래 보관하는 폴더 '+d.kind};reply({settings:settings(),cancelled:!!m.cancelFolder});}
      else if (method==='clearFolder') {m.storage[d.kind]={uri:'',name:''};reply({settings:settings()});}
      else if (method==='exportSettings' || method==='cancelSettings') reply(true);
      else if (method==='importSettings') {if(m.legacyImport)throw Error('이전 버전의 프로젝트 설정 파일입니다. 프로젝트 기능이 없어져 불러올 수 없습니다.');reply({token:'검토-합성',file:m.importFile||'합성-설정.json',preview:{summaryModel:{value:m.unknownModel?'없는 모델':'gpt-6-luna',apply:!m.unknownModel,reason:'이 앱의 요약 모델 목록에 없어 적용하지 않습니다.'},defaultOutputFormat:{value:'custom',apply:true},customFormat:{name:m.importEmpty?null:'불러온 형식',apply:true},storageIgnored:true}});}
      else if (method==='applySettings') {
        m.model='gpt-6-luna';m.defaultOutputFormat='custom';m.customFormat=m.importEmpty?null:{name:'불러온 형식',sections:[{key:'overview',title:'요약'}],instruction:''};
        reply({settings:settings(),connection:{keyConfigured:m.key,keySource:m.key?'session':'none',models:[{id:'gpt-6.1-sol',label:'Sol 표준'},{id:'gpt-6-luna',label:'Luna'}],summaryModel:m.model},customFormat:m.customFormat,skipped:[]});
      } else if (method==='open') {
        if(d.resultId===null)throw Error('JSON null 결과 선택 오류');
        const original=m.history.find(r=>r.location===d.location&&r.id===d.id);if(!original)throw Error('보관함 연결 오류');
        const record={...original}, selected=d.resultId||record.resultId;
        if(selected)record.resultId=selected;
        if(selected==='1233'||selected==='1235'){record.outputFormat='summary';record.feedback='담당자를 확인해 주세요.';}
        const minutes=record.state==='complete'?{overview:selected==='1233'?'앞선 결과입니다.':'전체 방향 | 회의 내용을 보존합니다.',topics:[{title:'보관함',points:['원래 보관함에서 기록을 엽니다.']}],decisions:[],actions:[],openQuestions:[]}:null;
        const versions=selected?[{id:'1233',savedAt:2,outputFormat:'summary',refined:true},{id:selected==='legacy'?'legacy':'1234',savedAt:3,outputFormat:'tasks',refined:false}]:[];
        if(original.resultId==='1235')versions.push({id:'1235',savedAt:4,outputFormat:'summary',refined:true});
        reply({record,minutes,transcript:m.noTranscript?'':'저장된 전사',resultId:selected||null,versions:m.versions||versions,review:m.reviews[selected]||null,copies:m.copyReport});
      } else if (method==='review') {if(m.failReview)throw Error('평가 저장 실패');const r={stars:d.stars,comment:d.comment,savedAt:'2026-10-23T00:00:00Z'};m.reviews[d.resultId]=r;reply(r);}
      else if (method==='refine') {
        if(m.failRefine)throw Error('요약 요청에 실패했습니다.');
        m.active=true;m.meeting={id:d.id,location:d.location,attemptId:d.attemptId,state:'analyzing',createdAt:Date.now(),message:'의견을 반영해 정리 중'};
        const terminal=()=>{m.active=false;m.meeting={...m.meeting,state:m.refineOutcome==='success'?'complete':'failed',resultId:m.refineOutcome==='success'?'1235':'1234',message:'합성 서비스 종료'};if(m.refineOutcome==='success')m.history.find(r=>r.id===d.id).resultId='1235';};
        if(['failure','success'].includes(m.refineOutcome))terminal();
        reply({id:d.id,attemptId:d.attemptId});
      }
      else if (method==='copies') {if(m.failCopies)throw Error('사본 저장 실패');m.copyReport=m.copiesResult||{ok:true,written:[{kind:'summaryMd',name:'회의.md'}],skipped:[],failed:[]};reply(m.copyReport);}
    } catch(error) {reply(null,error.message);}
  };
}.toString() + ')();';
