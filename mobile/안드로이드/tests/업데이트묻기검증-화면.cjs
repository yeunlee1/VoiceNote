// 켤 때 새 버전이 확인되면 업데이트할지 묻는 창(tm 39)을 실제 화면에서 검사한다. 업데이트 상태는 업데이트-모의브리지가 정한다.
module.exports = async ({ viewport, load, tap, evaluate, until, wait, shot, check }) => {
  const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const open = id => evaluate(`document.getElementById(${JSON.stringify(id)}).open`);
  const asked = "document.getElementById('update-ask').open";
  // 묻는 창 안의 보이는 요소가 모두 화면 폭 안에 있고 문서도 가로로 밀리지 않는지 본다.
  const fits = "(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll('#update-ask *')].every(e=>{const r=e.getBoundingClientRect();return r.width===0||(r.left>=-0.5&&r.right<=w+0.5)})})()";
  const big = "[...document.querySelectorAll('#update-ask button')].every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44})";
  for (const [width, height] of [[360, 800], [412, 915]]) {
    await viewport(width, height);
    await load('?update=available');
    check(`${width}px 켜서 새 버전이 확인되면 업데이트할지 묻는 창을 연다`, await until(asked));
    check(`${width}px 묻는 창에 새 버전과 지금 버전, 묻는 말을 보인다`, (await text('update-ask-version')) === '1.7.1' && (await text('update-ask-current')) === '1.7.0' && /업데이트하시겠습니까/.test(await text('update-ask-question')));
    check(`${width}px 묻는 창 가로 넘침 없음`, await evaluate(fits));
    check(`${width}px 묻는 창의 단추는 누르기 충분히 크다`, await evaluate(big));
    await shot(`업데이트묻기-${width}.png`);
    await tap('#update-ask-later');
    check(`${width}px 나중에를 누르면 받지 않고 창을 닫으며 새 버전 안내 줄은 남긴다`, (await until(`!${asked}`)) && await evaluate("!__mock.updateCalls.includes('updateDownload')&&!document.getElementById('update-note').hidden"));
    await wait(1700);
    check(`${width}px 나중에 뒤에는 이번 실행에서 다시 묻지 않는다`, !(await open('update-ask')));
  }

  await viewport(412, 915);
  // 업데이트를 고르면 받기를 시작하고 프로그램 정보에서 받는 정도를 보이며, 받은 뒤 설치 확인으로 이어 간다.
  await load('?update=available');
  await until(asked);
  await tap('#update-ask-yes');
  check('412px 업데이트를 누르면 받기를 시작하고 프로그램 정보를 연다', await until(`__mock.updateCalls.includes('updateDownload')&&document.getElementById('about').open&&!${asked}&&!document.getElementById('update-progress-row').hidden`));
  await evaluate("__mock.setUpdate('ready')");
  check('412px 받기가 끝나면 누름 없이 설치 확인으로 넘어간다', await until("__mock.updateCalls.includes('updateInstall')"));

  // 사라질 입력이 있으면 받아 두기만 하고, 받은 뒤 설치는 이유를 보이며 잠근다.
  await load('?update=available');
  await until(asked);
  await evaluate("document.getElementById('api-key').value='sk-test-typed-not-saved'");
  await tap('#update-ask-yes');
  await until("__mock.updateCalls.includes('updateDownload')");
  await evaluate("__mock.setUpdate('ready')");
  check('412px 설치를 막는 입력이 있으면 받아 두기만 하고 이유를 보인다', (await until("document.getElementById('update-action').textContent==='설치'&&document.getElementById('update-action').disabled")) && await evaluate("!__mock.updateCalls.includes('updateInstall')&&/API 키/.test(document.getElementById('update-lock').textContent)"));

  // 바뀐 점 보기는 릴리즈 페이지를 열고 묻는 창은 그대로 둔다.
  await load('?update=available');
  await until(asked);
  await tap('#update-ask-notes');
  check('412px 바뀐 점 보기는 릴리즈 페이지를 열고 묻는 창은 그대로 둔다', (await until("__mock.updateCalls.includes('updatePage')")) && await open('update-ask'));

  // 앱에서 바로 받을 수 없거나 최신이거나 확인하지 못했으면 묻지 않는다.
  for (const preset of ['manual', 'unknown', 'latest']) {
    await load('?update=' + preset);
    await wait(600);
    check(`412px ${preset} 상태에서는 묻지 않는다`, !(await open('update-ask')));
  }

  // 녹음·분석 중이면 새 버전이 와도 묻지 않고, 끝나면 묻는다.
  await load('?update=latest');
  await evaluate("__mock.active=true;__mock.setUpdate('available')");
  await until("!document.getElementById('update-note').hidden");
  await wait(300);
  check('412px 녹음·분석 중에는 새 버전이 와도 묻지 않는다', !(await open('update-ask')));
  await evaluate('__mock.active=false');
  check('412px 녹음·분석이 끝나면 묻는다', await until(asked));

  // 다른 창이 열려 있으면 그 창을 닫은 뒤 묻는다.
  await load('?update=latest');
  await tap('#open-settings');
  await evaluate("__mock.setUpdate('available')");
  await until("!document.getElementById('update-note').hidden");
  await wait(300);
  check('412px 설정 창이 열려 있으면 묻지 않는다', !(await open('update-ask')));
  await tap('#close-settings');
  check('412px 설정 창을 닫으면 묻는다', await until(asked));

  // 프로그램 정보를 먼저 열어 업데이트를 보고 있었으면 따로 묻지 않는다.
  await load('?update=latest');
  await tap('#open-settings');
  await tap('#open-about');
  await evaluate("__mock.setUpdate('available')");
  await until("!document.getElementById('update-note').hidden");
  await tap('[data-close=about]');
  await tap('#close-settings');
  await wait(300);
  check('412px 프로그램 정보에서 새 버전을 이미 봤으면 따로 묻지 않는다', !(await open('update-ask')));
};
