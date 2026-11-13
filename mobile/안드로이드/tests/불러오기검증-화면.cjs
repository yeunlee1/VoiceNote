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
  check('불러오기 요청에 회의명·날짜·참석자·상세 내용·출력 형식을 싣는다', data.title === '거래처 통화' && /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') && data.participants === '김민수, 박서연' && data.notes === '계약 조건 재확인' && data.outputFormat === 'meeting', js(data));
  const preparing = await workflow('녹음 파일을 준비하는 중');
  s = await buttons();
  check('시작되면 칸을 비우고 진행 문구를 보여 주며 불러오기 단추를 감춘다', preparing && await fields() === js(['', '', '']) && !s.shown, js({ fields: await fields(), s }));
  await shot('모바일-390-녹음파일불러오기-준비중.png');
  await evaluate("__mock.active=false;__mock.meeting={state:'failed',message:'파일을 읽지 못했습니다. 다시 골라 주세요.'};true");
  check('담는 중에 실패하면 서비스 상태의 안내를 보여 준다', await workflow('파일을 읽지 못했습니다'));

  await load(); await key(); await mode('failFast'); await press();
  check('회의를 만들기 전에 곧바로 실패해도 첫 상태 조회에서 그 안내를 보여 준다', await workflow('저장 공간이 부족'), await evaluate("document.getElementById('workflow').textContent"));

  for (const width of [360, 390]) {
    await viewport(width); await load(); await key();
    const box = await evaluate("(()=>{const button=document.getElementById('import-audio'),help=document.getElementById('import-help');if(!button||!help)return null;const b=button.getBoundingClientRect(),h=help.getBoundingClientRect();return {height:Math.round(b.height),right:Math.ceil(Math.max(b.right,h.right)),width:innerWidth,scroll:document.documentElement.scrollWidth}})()");
    check(`${width}폭에서 불러오기 단추와 설명이 넘치지 않고 단추 높이가 44px 이상이다`, !!box && box.height >= 44 && box.right <= box.width && box.scroll <= box.width, js(box));
    await shot(`모바일-${width}-녹음파일불러오기.png`);
  }
};
