// Task 7 화면 확인: 결과 창의 결과 버전·의견 반영본 표시·요약 평가·사본 저장 실패 상태를 세 폭에서 캡처한다. 외부 AI는 부르지 않는다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const repo = process.argv[3] || 'C:/DEV/VoiceNote';
const { createMeetingServer } = require(path.join(repo, 'desktop/앱/서버.cjs'));
const { chromium } = require('C:/DEV/11_로컬작업물/_잡다파일/node_modules/테스트체크리스트_20260727/playwright-core');
const shell = fs.readdirSync(path.join(process.env.LOCALAPPDATA, 'ms-playwright')).filter(name => name.startsWith('chromium_headless_shell-')).sort().at(-1);
const chrome = path.join(process.env.LOCALAPPDATA, 'ms-playwright', shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const out = process.argv[2];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-screen-'));
  const summary = path.join(dir, '요약본 사본');
  fs.mkdirSync(summary);
  // 요약본(.txt) 사본만 권한 오류로 실패하게 해 결과 창의 사본 실패 상태를 만든다.
  const copyFs = { ...fs, linkSync(from, to) { if (String(to).endsWith('-요약.txt')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.linkSync(from, to); },
    openSync(file, flags, mode) { if (String(file).endsWith('-요약.txt')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); return fs.openSync(file, flags, mode); } };
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile: path.join(dir, 'AI설정.json'), copyFs, apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const api = async (route, body) => (await fetch(origin + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) })).json();
  await api('/api/key', { apiKey: 'mock-only', persist: false });
  await api('/api/settings', { storage: { summary } });
  const recordingId = randomUUID();
  await api(`/api/recordings/main/${recordingId}`, { title: '', date: '2026-10-22', participants: '김과장, 이대리', expectedParts: 1 });
  const base = { recordingId, title: '견적 검토와 시안 일정', date: '2026-10-22', participants: '김과장, 이대리', transcript: '김과장: 견적 검토는 이대리가 맡아 주세요. 시안은 금요일까지 확정합니다.', outputFormat: 'meeting' };
  const first = await api('/api/meetings/main', { ...base, id: randomUUID(), minutes: { overview: '전체 방향 | 시안 A로 진행합니다.', topics: [{ title: '일정', points: ['금요일까지 시안을 확정합니다.'] }], decisions: ['시안 A 채택'], actions: [{ task: '견적 검토', owner: '김과장', due: null }], openQuestions: [] } });
  await api(`/api/meetings/main/${first.meeting.id}/review`, { stars: 2, comment: '담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다.' });
  await new Promise(resolve => setTimeout(resolve, 20));
  await api('/api/meetings/main', { ...base, id: randomUUID(), feedback: '담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다.', minutes: { overview: '전체 방향 | 시안 A로 진행하고 견적 검토는 이대리가 맡습니다.', topics: [{ title: '일정', points: ['금요일까지 시안을 확정합니다.'] }], decisions: ['시안 A 채택'], actions: [{ task: '견적 검토', owner: '이대리', due: null }], openQuestions: [] } });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  for (const [name, width, height] of [['1280', 1280, 900], ['960', 960, 1000], ['390', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/#${meeting.token}`);
    await page.waitForFunction(() => document.querySelectorAll('#meeting-history .history-button').length === 1);
    await page.click('#meeting-history .history-button');
    await page.waitForSelector('#meeting-detail[open]');
    await page.screenshot({ path: path.join(out, `${name}-결과-의견반영본과버전.png`) });
    await page.locator('#review').scrollIntoViewIfNeeded();
    await page.click('#review-star-4');
    await page.fill('#review-comment', '기한이 빠졌어요. 시안 확정은 금요일까지입니다.');
    await page.locator('#review').screenshot({ path: path.join(out, `${name}-결과-평가입력.png`) });
    await page.click('#copy-again');
    await page.waitForFunction(() => document.getElementById('copy-status').textContent.includes('저장하지 못했습니다'));
    await page.locator('#copy-block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `${name}-결과-사본실패.png`) });
    const versionIds = await page.$$eval('#result-versions option', options => options.map(option => option.value));
    await page.selectOption('#result-versions', versionIds[0]);
    await page.waitForFunction(id => document.getElementById('result-versions').value === id && document.getElementById('review-comment').value.length > 0, versionIds[0]);
    await page.locator('#meeting-detail .modal-body').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: path.join(out, `${name}-결과-앞선버전.png`) });
    const info = await page.evaluate(() => {
      const overflow = [...document.querySelectorAll('#meeting-detail *')].filter(node => node.offsetParent !== null && node.scrollWidth > node.clientWidth + 1).map(node => node.id || node.className);
      return {
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, overflowInside: overflow,
        versions: [...document.querySelectorAll('#result-versions option')].map(option => option.textContent),
        badge: !document.getElementById('refined-badge').hidden, pressed: [1, 2, 3, 4, 5].filter(n => document.getElementById(`review-star-${n}`).getAttribute('aria-pressed') === 'true'),
        comment: document.getElementById('review-comment').value, copy: document.getElementById('copy-status').textContent, toast: document.getElementById('status').textContent,
      };
    });
    console.log(name, JSON.stringify(info, null, 1), errors.length ? `오류: ${errors.join(' / ')}` : '오류 없음');
    await page.close();
  }
  await browser.close();
  meeting.server.closeAllConnections();
  await new Promise(resolve => meeting.server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
