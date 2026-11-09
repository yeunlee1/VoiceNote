// 앱 업데이트 안내 줄과 프로그램 정보(지금 버전·업데이트·버전별 바뀐 점)를 실제 화면에서 검사한다. 상태는 업데이트-모의브리지가 정한다.
module.exports = async ({ viewport, load, click, evaluate, until, wait, shot, check }) => {
  const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const shown = id => evaluate(`!document.getElementById(${JSON.stringify(id)}).hidden`);
  // 프로그램 정보 안의 보이는 요소가 모두 화면 폭 안에 있고 문서도 가로로 밀리지 않는지 본다.
  const fits = "(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll('#about *')].every(e=>{const r=e.getBoundingClientRect();return r.width===0||(r.left>=-0.5&&r.right<=w+0.5)})})()";
  const closeAbout = () => click('[data-close=about]');
  // 단추 글자가 한 줄에 다 들어가는지 본다. 글자 상자의 줄 위치가 하나여야 한다.
  const oneLine = id => evaluate(`(()=>{const b=document.getElementById(${JSON.stringify(id)});if(b.hidden)return false;const r=document.createRange();r.selectNodeContents(b);return new Set([...r.getClientRects()].filter(x=>x.width>0).map(x=>Math.round(x.top))).size===1})()`);
  const typeTitle = value => evaluate(`(()=>{const t=document.getElementById('title');t.value=${JSON.stringify(value)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  for (const [width, height] of [[360, 800], [412, 915]]) {
    await viewport(width, height);

    // 최신이면 첫 화면에 안내 줄이 없고, 설정 머리의 프로그램 정보로 버전과 바뀐 점을 본다.
    await load('?update=latest');
    check(width + 'px 최신이면 새 버전 안내 줄을 숨긴다', !(await shown('update-note')));
    await click('#open-settings');
    check(width + 'px 설정 머리의 프로그램 정보 단추가 누르기 쉬운 크기로 화면 안에 있다', await evaluate("(()=>{const r=document.getElementById('open-about').getBoundingClientRect(),c=document.getElementById('close-settings').getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&c.right<=document.documentElement.clientWidth&&r.right<=c.left+0.5})()"));
    await click('#open-about');
    check(width + 'px 프로그램 정보가 설정 위에 열린다', await evaluate("document.getElementById('about').open&&document.getElementById('settings').open"));
    check(width + 'px 지금 버전과 최신 안내를 보인다', (await text('about-version')) === '1.6.0' && /1\.6\.0 버전이 최신/.test(await text('update-state')));
    check(width + 'px 버전별 바뀐 점을 최신부터 보이고 지금 버전에 표시를 붙인다', await evaluate("(()=>{const items=[...document.querySelectorAll('#release-list > li')];return items.length===window.VoiceNoteReleaseNotes.NOTES.length&&items[0].dataset.current==='true'&&items[0].textContent.includes('지금 버전')&&items.slice(1).every(i=>i.dataset.current==='false')&&items.every(i=>i.querySelectorAll('.release-items li').length>0)})()"));
    check(width + 'px 최신이면 업데이트 단추 없이 다시 확인만 보인다', !(await shown('update-action')) && (await shown('update-check')) && await evaluate("!document.getElementById('update-check').disabled"));
    check(width + 'px 업데이트 상태 문장은 상태 알림 영역이다', await evaluate("document.getElementById('update-state').getAttribute('role')==='status'"));
    check(width + 'px 프로그램 정보 가로 넘침 없음', await evaluate(fits));
    await shot('업데이트-' + width + '-정보최신.png');
    check(width + 'px 바뀐 점 끝까지 내려도 머리글과 닫기가 보인다', await evaluate("(()=>{const d=document.getElementById('about');d.scrollTop=1e6;const h=d.querySelector('.modal-head').getBoundingClientRect(),r=d.getBoundingClientRect();return d.scrollTop>0&&h.top>=r.top-0.5&&h.top<=r.top+2})()"));
    await shot('업데이트-' + width + '-바뀐점.png');
    await closeAbout();
    // 대화상자의 close 이벤트는 다음 작업으로 미뤄져 오므로 잠시 기다려 본다.
    check(width + 'px 프로그램 정보를 닫으면 연 단추로 초점이 돌아간다', await until("document.activeElement===document.getElementById('open-about')&&document.getElementById('settings').open"), await evaluate("(document.activeElement.id||document.activeElement.tagName)+' / settings '+document.getElementById('settings').open"));
    await click('#close-settings');

    // 새 버전이 있으면 첫 화면 본문 흐름 안에 안내 줄을 보이고, 누르면 프로그램 정보가 열린다.
    await load('?update=available');
    check(width + 'px 새 버전이 있으면 첫 화면에 안내 줄을 보인다', (await shown('update-note')) && (await text('update-note-label')) === '새 버전 1.6.1');
    check(width + 'px 안내 줄은 조작부 위 본문 흐름 안에 있고 가로로 넘치지 않는다', await evaluate("(()=>{const e=document.getElementById('update-note'),n=e.getBoundingClientRect(),c=document.querySelector('.console').getBoundingClientRect(),w=document.documentElement.clientWidth;return n.bottom<=c.top+0.5&&n.left>=0&&n.right<=w&&n.height>=44&&document.documentElement.scrollWidth<=w&&getComputedStyle(e).position==='static'})()"));
    check(width + 'px 안내 줄은 읽기 프로그램에 무엇을 여는지 알린다', await evaluate("document.getElementById('update-note').getAttribute('aria-label')==='새 버전 1.6.1, 프로그램 정보 열기'"));
    await shot('업데이트-' + width + '-새버전안내.png');
    await click('#update-note');
    check(width + 'px 안내 줄을 누르면 프로그램 정보가 열린다', await evaluate("document.getElementById('about').open"));
    check(width + 'px 새 버전 안내 문장과 지금 업데이트 단추', /1\.6\.1 버전이 나왔습니다/.test(await text('update-state')) && (await text('update-action')) === '지금 업데이트' && await evaluate("!document.getElementById('update-action').disabled") && (await shown('update-fine')) && !(await shown('update-lock')));
    check(width + 'px 새 버전 화면 가로 넘침 없음', await evaluate(fits));
    check(width + 'px 지금 업데이트와 다시 확인 단추 글자가 한 줄에 들어간다', (await oneLine('update-action')) && (await oneLine('update-check')));
    await shot('업데이트-' + width + '-정보새버전.png');
    // 한 번 누르면 받고, 받기가 끝나면 다시 누르지 않아도 휴대폰 설치 화면으로 넘어간다.
    await click('#update-action');
    check(width + 'px 지금 업데이트를 누르면 받기를 시작한다', await until("!document.getElementById('update-progress-row').hidden"));
    await evaluate("__mock.setUpdate('ready')");
    check(width + 'px 받기가 끝나면 누름 없이 설치 확인으로 넘어간다', await until("__mock.updateCalls.includes('updateInstall')&&document.getElementById('update-note-label').textContent==='설치 확인 대기'"));
    await closeAbout();

    // 받는 동안 녹음이 시작됐다가 받기 전에 끝나도, 받은 뒤에는 사람이 설치를 다시 누르게 한다.
    await load('?update=available');
    await click('#update-note');
    await click('#update-action');
    await until("!document.getElementById('update-progress-row').hidden");
    await evaluate('__mock.active=true');
    await wait(1700);
    await evaluate("__mock.active=false;__mock.setUpdate('ready')");
    check(width + 'px 받는 동안 회의가 끼면 받은 뒤 자동 설치하지 않고 설치 단추를 보인다', await until("document.getElementById('update-action').textContent==='설치'&&!document.getElementById('update-action').disabled") && await evaluate("!__mock.updateCalls.includes('updateInstall')"));
    await closeAbout();

    // 받아 둔 업데이트가 있어도 사라질 입력이 있으면 설치를 잠그고 이유를 단추 가까이에 보인다.
    await load('?update=ready');
    await click('#open-settings');
    await evaluate("document.getElementById('api-key').value='sk-test-typed-not-saved'");
    await click('#open-about');
    check(width + 'px 저장 안 한 입력이 있으면 설치를 잠그고 이유를 보인다', (await text('update-action')) === '설치' && await evaluate("document.getElementById('update-action').disabled") && /API 키/.test(await text('update-lock')));
    check(width + 'px 설치 잠김 화면 가로 넘침 없음', await evaluate(fits));
    await shot('업데이트-' + width + '-설치잠김.png');
    await closeAbout();
    await evaluate("document.getElementById('api-key').value=''");
    await click('#close-settings');

    // 받는 중에는 받은 정도를 안내 줄과 진행 막대로 보이고 다시 확인은 숨긴다.
    await load('?update=downloading');
    check(width + 'px 받는 중 안내 줄은 받은 정도를 보인다', (await text('update-note-label')) === '받는 중 40%');
    await click('#update-note');
    check(width + 'px 받는 중에는 진행 막대와 받은 양을 보이고 다시 확인을 숨긴다', (await shown('update-progress-row')) && (await text('update-progress-text')) === '12.0 MB / 30.0 MB' && !(await shown('update-check')) && !(await shown('update-action')));
    await shot('업데이트-' + width + '-받는중.png');
    await closeAbout();

    // 설치 허용이 꺼져 있으면 허용 설정으로 안내한다.
    await load('?update=permission');
    await click('#update-note');
    check(width + 'px 설치 허용이 꺼져 있으면 허용 켜기 단추와 안내를 보인다', (await text('update-action')) === '설치 허용 켜기' && /설치 허용/.test(await text('update-state')));
    check(width + 'px 설치 허용 켜기 글자가 한 줄에 들어간다', await oneLine('update-action'));
    await shot('업데이트-' + width + '-설치허용.png');
    await click('#update-action');
    check(width + 'px 허용 켜기는 휴대폰 설정을 연다', await until("__mock.updateCalls.includes('updatePermission')"));
    await closeAbout();

    // 설치 확인 화면을 기다리는 동안에는 새 회의를 시작하지 못하고, 확인 화면이 닫혔으면 다시 연다.
    await load('?update=confirming');
    check(width + 'px 설치 확인 대기 안내 줄', (await text('update-note-label')) === '설치 확인 대기');
    check(width + 'px 설치 확인을 기다리는 동안 새 회의 시작을 잠근다', await evaluate("document.getElementById('start').disabled"));
    await click('#update-note');
    check(width + 'px 설치 화면이 닫혔으면 설치 계속 단추를 보인다', (await text('update-action')) === '설치 계속');
    await click('#update-action');
    check(width + 'px 설치 계속은 설치 확인 화면을 다시 연다', await until("__mock.updateCalls.includes('updateConfirm')"));
    await closeAbout();
    // 설치 계속도 앱이 곧 닫히므로, 저장하지 않은 내 형식이 있으면 잠그고 이유를 보인다.
    await click('#open-settings');
    await evaluate("(()=>{const n=document.getElementById('custom-name');n.value='주간 보고';n.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click('#open-about');
    check(width + 'px 설치 계속도 저장하지 않은 내 형식이 있으면 잠그고 이유를 보인다', (await evaluate("document.getElementById('update-action').disabled&&document.getElementById('update-action').textContent==='설치 계속'")) && /내 형식/.test(await text('update-lock')), await text('update-lock'));
    await closeAbout();
    await click('#close-settings');

    // 앱에서 바로 설치할 수 없으면 깃허브에서 받도록 안내한다.
    await load('?update=manual');
    await click('#update-note');
    check(width + 'px 직접 받아야 하면 깃허브 안내를 보이고 설치 단추를 숨긴다', !(await shown('update-action')) && /깃허브/.test(await text('update-detail')) && (await shown('update-page')));
    await shot('업데이트-' + width + '-직접받기.png');
    await click('#update-page');
    check(width + 'px 깃허브에서 보기는 릴리즈 페이지를 연다', await until("__mock.updateCalls.includes('updatePage')"));
    await closeAbout();

    // 확인에 실패해도 첫 화면을 가리지 않고, 프로그램 정보에서 이유와 다시 확인을 보인다.
    await load('?update=unknown');
    check(width + 'px 확인 실패는 첫 화면에 안내 줄을 띄우지 않는다', !(await shown('update-note')));
    await click('#open-settings');
    await click('#open-about');
    check(width + 'px 확인 실패 이유와 다시 확인 단추를 보인다', /인터넷/.test(await text('update-state')) && (await shown('update-check')) && await evaluate("!document.getElementById('update-check').disabled"));
    await closeAbout();
    await click('#close-settings');
  }

  // 회의 준비 저장을 기다리는 사이 새로 적은 내용도 저장된 뒤에야 설치로 넘긴다.
  await viewport(412, 915);
  await load('?update=ready');
  await typeTitle('제목1');
  await evaluate('__mock.holdDraft=true');
  await wait(700);
  check('412px 첫 회의 준비 저장을 붙잡아 둔다', await evaluate('__mock.heldDrafts.length===1'));
  await click('#update-note');
  await click('#update-action');
  await closeAbout();
  await typeTitle('제목2');
  await evaluate('__mock.releaseDrafts()');
  check('412px 저장을 기다리는 사이 새로 적은 회의 준비를 저장한 뒤에 설치로 넘긴다', (await until("__mock.sequence.includes('updateInstall')")) && await evaluate("(()=>{const s=__mock.sequence,last=s.lastIndexOf('saveDraft:제목2');return last>=0&&last<s.indexOf('updateInstall')&&__mock.draft.title==='제목2'})()"), await evaluate('JSON.stringify(__mock.sequence)'));

  // 회의 준비 저장이 한 번 실패해도 설치 단추는 잠그지 않고, 누르면 다시 저장한 뒤에 설치한다.
  await load('?update=ready');
  await evaluate('__mock.failDraft=1');
  await typeTitle('제목3');
  await wait(700);
  await click('#update-note');
  check('412px 회의 준비 저장이 실패해도 설치 단추를 누를 수 있다', await evaluate("__mock.sequence.includes('saveDraft-failed:제목3')&&!document.getElementById('update-action').disabled&&document.getElementById('update-action').textContent==='설치'"));
  await click('#update-action');
  check('412px 설치를 누르면 실패한 저장을 다시 한 뒤에 설치로 넘긴다', (await until("__mock.sequence.includes('updateInstall')")) && await evaluate("(()=>{const s=__mock.sequence;return s.indexOf('saveDraft:제목3')>s.indexOf('saveDraft-failed:제목3')&&s.indexOf('saveDraft:제목3')<s.indexOf('updateInstall')})()"), await evaluate('JSON.stringify(__mock.sequence)'));
  await closeAbout();

  // 다시 저장해도 실패하면 설치로 넘기지 않고 이유를 보인다.
  await load('?update=ready');
  await evaluate('__mock.failDraft=2');
  await typeTitle('제목4');
  await wait(700);
  await click('#update-note');
  await click('#update-action');
  await wait(300);
  check('412px 다시 저장해도 실패하면 설치하지 않고 이유를 보인다', await evaluate("!__mock.sequence.includes('updateInstall')&&__mock.sequence.filter(x=>x==='saveDraft-failed:제목4').length===2&&!document.getElementById('update-detail').hidden&&document.getElementById('update-detail').textContent.includes('저장하지 못했습니다')"), await evaluate("JSON.stringify(__mock.sequence)+' / '+document.getElementById('update-detail').textContent"));
  await closeAbout();
};
