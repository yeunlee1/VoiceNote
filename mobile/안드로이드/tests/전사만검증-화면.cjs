// 휴대폰 회의 종료·녹음 파일 불러오기·다시 분석에서 회의록까지/전사까지만을 고르는 창과 전사만 저장한 회의 표시를 모의 브리지로 검증한다.
module.exports = async ({ viewport, load, key, tap, evaluate, until, wait, shot, check }) => {
  const js = value => JSON.stringify(value);
  const RECORDING = '44444444-4444-4444-4444-444444444444';
  const press = selector => evaluate(`(()=>{const e=document.querySelector(${js(selector)});if(e)e.click();return !!e})()`);
  // 없는 요소는 누르지 않고 false를 돌려준다. 그때는 아래 확인이 실패로 남고 다른 검사는 이어 간다.
  const calls = name => evaluate(`__mock.calls.filter(c=>c.method===${js(name)}).map(c=>c.data)`);
  const choiceOpen = note => until(`document.getElementById('finish-choice')?.open&&document.getElementById('finish-choice-note').textContent===${js(note)}`);
  const record = async test => {
    await load(); await key();
    await evaluate(`__mock.modeTest=${js(test)};true`);
    await press('#start'); await until("!document.getElementById('finish').hidden&&!document.getElementById('finish').disabled");
  };
  // 녹음을 시작해 종료 단추가 눌릴 수 있을 때까지 기다린다. modeTest는 종료·분석 응답을 흉내 내는 방식이다.

  await viewport(390);
  await record({ stale: 4 }); await press('#finish'); await wait(250);
  const early = { open: await evaluate("document.getElementById('finish-choice')?.open||false"), analyze: (await calls('analyze')).length, finish: (await calls('finish')).at(-1) || null };
  check('회의 종료는 hold로 녹음 저장만 요청하고 같은 회의의 저장을 확인하기 전에는 창도 분석도 없다', early.finish?.hold === true && !early.open && early.analyze === 0, js(early));
  const shown = await choiceOpen('음성은 저장했습니다.');
  check('저장을 확인하면 고르는 창이 뜨고 처음 초점은 회의록까지 만들기다', shown && await evaluate("document.activeElement?.id==='finish-minutes'"), await evaluate("document.activeElement?.id||''"));
  await shot('모바일-390-회의종료-고르는창.png');
  await press('#finish-transcript'); await press('#finish-minutes');
  await until("__mock.calls.some(c=>c.method==='analyze')"); await wait(150);
  const first = await calls('analyze');
  check('전사까지만을 고르면 그 회의에 transcript 방식과 시도 번호로 분석을 한 번만 요청한다', first.length === 1 && first[0].mode === 'transcript' && first[0].id === RECORDING && first[0].location === 'main' && !!first[0].attemptId, js(first));
  const opened = await until("!document.getElementById('result').hidden&&!!document.querySelector('#minutes .make-minutes')");
  const end = await evaluate(`({state:document.getElementById('record-state').textContent,stage:document.querySelector('#stage [aria-current]')?.dataset.stage||'',notice:document.querySelector('#minutes .transcript-only')?.innerText||'',label:[...document.querySelectorAll('#history button')].find(b=>b.dataset.id===${js(RECORDING)})?.innerText||''})`);
  check('전사만 끝나면 결과를 열어 정리본 탭에 안내와 회의록 만들기를 보이고 끝 문구·목록 꼬리표가 전사만이다', opened && end.state === '전사 저장 완료' && end.stage === 'done' && end.notice.includes('전사만 저장한 회의입니다.') && end.label.includes('전사만'), js(end));
  await shot('모바일-390-전사만-정리본.png');
  await press('#minutes .make-minutes'); await press('#minutes .make-minutes');
  await until("__mock.calls.filter(c=>c.method==='analyze').length>=2"); await wait(500);
  const second = await calls('analyze');
  check('회의록 만들기는 빠르게 두 번 눌러도 한 번만 묻지 않고 회의록까지 요청한다', second.length === 2 && second[1].mode === 'minutes' && second[1].id === RECORDING, js(second));
  check('회의록까지 끝나면 결과를 다시 열어 정리본을 보여 준다', await until("document.getElementById('minutes').innerText.includes('회의 내용을 보존')"));

  await record({ stale: 1, fast: true }); await press('#finish'); await choiceOpen('음성은 저장했습니다.');
  await press('#finish-transcript'); await until("!document.getElementById('result').hidden"); await wait(800);
  const fast = { opens: (await calls('open')).filter(d => d.id === RECORDING).length, state: await evaluate("document.getElementById('record-state').textContent") };
  check('첫 상태 조회 전에 끝나는 빠른 분석도 시도 번호로 결과를 한 번 열고 끝 문구를 낸다', fast.opens === 1 && fast.state === '전사 저장 완료', js(fast));

  await record({ stale: 1, fail: true }); await press('#finish'); await choiceOpen('음성은 저장했습니다.');
  await press('#finish-transcript'); await until("!document.getElementById('result').hidden"); await wait(300);
  await evaluate("(()=>{const d=document.querySelector('#result details.more');if(d)d.open=true;return true})()"); await press('#retry'); await wait(500);
  const again = await calls('analyze');
  check('전사까지만이 일부 전사 뒤 실패해도 다시 분석은 창 없이 전사까지만으로 이어 간다', !await evaluate("document.getElementById('finish-choice').open") && again.length === 2 && again[1].mode === 'transcript' && again[1].id === RECORDING, js(again));

  await record({ stale: 1 }); await press('#finish'); await choiceOpen('음성은 저장했습니다.');
  await press('#finish-choice [data-close]'); await wait(900);
  const closed = await evaluate(`({analyze:__mock.calls.filter(c=>c.method==='analyze').length,workflow:document.getElementById('workflow').textContent,result:!document.getElementById('result').hidden,label:[...document.querySelectorAll('#history button')].find(b=>b.dataset.id===${js(RECORDING)})?.innerText||''})`);
  check('고르는 창을 닫으면 분석하지 않고 저장 안내를 남기며 결과를 열지 않는다', closed.analyze === 0 && closed.workflow === '음성을 저장했습니다. 회의 기록에서 열어 분석할 수 있습니다.' && !closed.result && closed.label.includes('음성 저장'), js(closed));

  await record({ stale: 1, saveFails: true }); await press('#finish'); await wait(1500);
  const failed = await evaluate("({open:document.getElementById('finish-choice').open,analyze:__mock.calls.filter(c=>c.method==='analyze').length,workflow:document.getElementById('workflow').textContent})");
  check('녹음 저장이 실패하면 고르는 창을 띄우지 않고 실패 안내를 보인다', !failed.open && failed.analyze === 0 && failed.workflow.includes('녹음이 너무 짧거나'), js(failed));

  await record({ stale: 1 }); await evaluate("__mock.key=false;true"); await press('#finish');
  const noKey = await until("document.getElementById('settings').open");
  check('키가 없으면 고르는 창 대신 설정을 열고 분석하지 않는다', noKey && !await evaluate("document.getElementById('finish-choice').open") && (await calls('analyze')).length === 0);

  await load(); await key(); await press('#import-audio');
  check('녹음 파일 불러오기는 파일을 고르기 전에 고르는 창을 띄운다', await choiceOpen('녹음 파일을 고르기 전에 어디까지 만들지 정합니다.') && (await calls('importAudio')).length === 0);
  await press('#finish-transcript'); await until("__mock.calls.some(c=>c.method==='importAudio')");
  const imported = (await calls('importAudio')).at(-1) || {};
  check('불러오기에서 전사까지만을 고르면 그 방식과 시도 번호를 불러오기 요청에 싣는다', imported.mode === 'transcript' && !!imported.attemptId, js(imported));
  await load(); await key(); await press('#import-audio'); await choiceOpen('녹음 파일을 고르기 전에 어디까지 만들지 정합니다.');
  await press('#finish-choice [data-close]'); await wait(400);
  check('불러오기 창을 닫으면 파일 선택을 시작하지 않는다', (await calls('importAudio')).length === 0);

  const AUDIO_ONLY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', HEARD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await load(); await key();
  await evaluate(`__mock.modeTest={};__mock.history.unshift({id:${js(AUDIO_ONLY)},location:'main',date:'2026-11-17',dailySequence:4,title:'음성만 회의',state:'saved',createdAt:2,audio:['원음-001.m4a'],noTranscript:true},{id:${js(HEARD)},location:'main',date:'2026-11-17',dailySequence:5,title:'전사만 회의',state:'transcribed',createdAt:3,audio:['원음-001.m4a']});true`);
  await press('#refresh'); await until(`!!document.querySelector('#history button[data-id=${js(HEARD)}]')`);
  const labels = await evaluate(`[${js(AUDIO_ONLY)},${js(HEARD)}].map(id=>document.querySelector('#history button[data-id="'+id+'"]')?.innerText||'')`);
  check('목록 꼬리표는 전사만 저장한 회의가 전사만, 음성만 있는 회의가 음성 저장이다', labels[0].includes('음성 저장') && labels[1].includes('전사만'), js(labels));
  await press(`#history button[data-id="${AUDIO_ONLY}"]`); await until("!document.getElementById('result').hidden");
  await evaluate("(()=>{const d=document.querySelector('#result details.more');if(d)d.open=true;return true})()"); await press('#retry');
  const asked = await choiceOpen('저장된 음성으로 만듭니다.');
  await press('#finish-minutes'); await until("__mock.calls.some(c=>c.method==='analyze')");
  const retried = (await calls('analyze')).at(-1) || {};
  check('전사가 없는 회의의 다시 분석은 고르는 창을 띄우고 고른 방식으로 요청한다', asked && retried.mode === 'minutes' && retried.id === AUDIO_ONLY, js(retried));
  await until("document.getElementById('minutes').innerText.includes('회의 내용을 보존')"); await press('#close-result'); await wait(100);
  // 다시 분석이 끝나 결과가 저절로 다시 열린 뒤에 다음 회의를 연다.
  await press(`#history button[data-id="${HEARD}"]`); await until("!document.getElementById('result').hidden");
  await evaluate("(()=>{const d=document.querySelector('#result details.more');if(d)d.open=true;return true})()"); await press('#retry'); await wait(400);
  const direct = (await calls('analyze')).at(-1) || {};
  check('전사가 있는 회의의 다시 분석은 묻지 않고 회의록까지 요청한다', !await evaluate("document.getElementById('finish-choice').open") && direct.mode === 'minutes' && direct.id === HEARD, js(direct));

  await load(); await key();
  await evaluate(`__mock.modeTest={fast:true};__mock.history.unshift({id:${js(HEARD)},location:'main',date:'2026-11-17',dailySequence:5,title:'전사만 회의',state:'transcribed',createdAt:3,audio:['원음-001.m4a']});true`);
  await press('#refresh'); await until(`!!document.querySelector('#history button[data-id=${js(HEARD)}]')`);
  await press(`#history button[data-id="${HEARD}"]`); await until("!!document.querySelector('#minutes .make-minutes')");
  await press('#minutes .make-minutes');
  check('녹음을 보지 않은 기존 회의에서 첫 조회 전에 끝나는 회의록 만들기도 결과를 다시 열어 정리본을 보인다', await until("document.getElementById('minutes').innerText.includes('회의 내용을 보존')"));
  // 활성 상태를 한 번도 보지 못해도 시도 번호로 이번 분석의 끝을 알아봐야 결과를 다시 연다.

  for (const width of [360, 412]) {
    await viewport(width); await record({ stale: 0 }); await press('#finish'); await choiceOpen('음성은 저장했습니다.'); await wait(200);
    const box = await evaluate("(()=>{const d=document.getElementById('finish-choice').getBoundingClientRect();const buttons=[...document.querySelectorAll('#finish-choice .choice-button')].map(b=>Math.round(b.getBoundingClientRect().height));return {left:Math.round(d.left),right:Math.round(d.right),width:innerWidth,scroll:document.documentElement.scrollWidth,buttons}})()");
    check(`${width}폭에서 고르는 창이 넘치지 않고 두 단추 높이가 44px 이상이다`, box.left >= 0 && box.right <= box.width && box.scroll <= box.width && box.buttons.length === 2 && box.buttons.every(h => h >= 44), js(box));
    await shot(`모바일-${width}-회의종료-고르는창.png`);
    await press('#finish-choice [data-close]'); await wait(200);
  }
};
