// Task 6 화면 확인: 설정 창 다섯 구역과 회의 준비의 내 형식 안내, 설정 불러오기 미리보기를 세 폭에서 캡처한다. 외부 AI는 부르지 않는다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const repo = process.argv[3] || 'C:/DEV/VoiceNote';
const { createMeetingServer } = require(path.join(repo, 'desktop/앱/서버.cjs'));
const { chromium } = require('C:/DEV/11_로컬작업물/_잡다파일/node_modules/테스트체크리스트_20260727/playwright-core');
const shell = fs.readdirSync(path.join(process.env.LOCALAPPDATA, 'ms-playwright')).filter(name => name.startsWith('chromium_headless_shell-')).sort().at(-1);
const chrome = path.join(process.env.LOCALAPPDATA, 'ms-playwright', shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const out = process.argv[2];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-screen-'));
  const audio = path.join(dir, '원음 사본');
  const summary = path.join(dir, '팀 공유 드라이브', '2026년 회의 기록', '요약본 사본 모음 폴더');
  fs.mkdirSync(audio, { recursive: true });
  fs.mkdirSync(summary, { recursive: true });
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile: path.join(dir, 'AI설정.json'), apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const api = async (route, body) => (await fetch(origin + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) })).json();
  await api('/api/key', { apiKey: 'mock-only', persist: false });
  await api('/api/settings', { storage: { audio, summary } });
  // 불러오기 미리보기용 파일: 목록에 없는 모델, 이 PC에 없는 폴더, 비운 전사문 위치를 담는다.
  const importFile = path.join(dir, '2026-10-20-VoiceNote-설정.json');
  fs.writeFileSync(importFile, JSON.stringify({ format: 'voicenote-settings', version: 2, summaryModel: 'gpt-5-old', defaultOutputFormat: 'tasks',
    customFormat: { name: '주간 보고', sections: [{ key: 'actions', title: '할 일' }, { key: 'overview', title: '요약' }], instruction: '' },
    storage: { audio: 'E:\\회의 원음\\2026', transcript: '', summary } }, null, 2));
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  for (const [name, width, height] of [['1280', 1280, 900], ['960', 960, 1000], ['390', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    // Windows 창 안과 같게 보이도록 웹뷰 메시지 통로를 흉내 낸다. 창은 폴더 선택 결과를 메시지로 돌려준다.
    await page.addInitScript(() => {
      window.chrome = window.chrome || {};
      window.chrome.webview = { posted: [], listeners: [], postMessage(message) { this.posted.push(message); }, addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); } };
    });
    await page.goto(`${origin}/#${meeting.token}`);
    await page.waitForFunction(() => document.getElementById('meeting-history').children.length > 0);
    await page.click('#prepare');
    await page.selectOption('#output-format', 'custom');
    await page.waitForFunction(() => !document.getElementById('custom-missing').hidden);
    await page.locator('#custom-missing').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${name}-회의준비-내형식없음.png`) });
    await page.click('#open-format-settings');
    await page.waitForSelector('#settings[open]');
    const focus = await page.evaluate(() => document.activeElement?.id);
    await page.screenshot({ path: path.join(out, `${name}-설정-출력형식.png`) });
    const body = page.locator('#settings .modal-body');
    await body.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: path.join(out, `${name}-설정-AI연결.png`) });
    await page.evaluate(() => window.chrome.webview.listeners.forEach(fn => fn({ data: { type: 'folder-picked', kind: 'transcript', path: null } })));
    await page.click('#pick-transcript');
    const posted = await page.evaluate(() => window.chrome.webview.posted.at(-1));
    await page.locator('#settings-storage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${name}-설정-저장위치.png`) });
    await page.locator('#settings-data').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${name}-설정-설정파일과회의자료.png`) });
    await page.setInputFiles('#settings-file-input', importFile);
    await page.waitForSelector('#settings-import[open]');
    await page.screenshot({ path: path.join(out, `${name}-설정-불러오기미리보기.png`) });
    const info = await page.evaluate(() => {
      const overflow = selector => [...document.querySelectorAll(selector)].filter(node => node.offsetParent !== null && node.scrollWidth > node.clientWidth + 1).map(node => node.id || node.className);
      const box = id => { const rect = document.getElementById(id).getBoundingClientRect(); return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }; };
      return {
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        settingsBox: box('settings'), importBox: box('settings-import'),
        overflowInside: overflow('#settings *, #settings-import *'),
        storage: ['audio', 'transcript', 'summary'].map(kind => document.getElementById(`storage-${kind}`).textContent),
        preview: document.getElementById('settings-preview').innerText.split('\n').filter(Boolean),
        sectionsShown: ['settings-ai', 'settings-format', 'settings-storage', 'settings-file', 'settings-data'].filter(id => !document.getElementById(id).hidden),
      };
    });
    console.log(name, JSON.stringify({ focus, posted, ...info }, null, 1), errors.length ? `오류: ${errors.join(' / ')}` : '오류 없음');
    await page.close();
  }
  await browser.close();
  meeting.server.closeAllConnections();
  await new Promise(resolve => meeting.server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
