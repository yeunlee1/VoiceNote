// Task 3 화면 확인: 보관함 구조로 바꾼 데스크톱 화면을 합성 자료로 세 폭에서 캡처한다. 외부 AI는 부르지 않는다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const repo = process.argv[3] || 'C:/DEV/VoiceNote';
const { createMeetingServer } = require(path.join(repo, 'desktop/앱/서버.cjs'));
const { legacyMeeting } = require(path.join(repo, 'desktop/tests/옛기록.cjs'));
const { chromium } = require('C:/DEV/11_로컬작업물/_잡다파일/node_modules/테스트체크리스트_20260727/playwright-core');
const shell = fs.readdirSync(path.join(process.env.LOCALAPPDATA, 'ms-playwright')).filter(name => name.startsWith('chromium_headless_shell-')).sort().at(-1);
const chrome = path.join(process.env.LOCALAPPDATA, 'ms-playwright', shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const out = process.argv[2];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-screen-'));
  const data = path.join(dir, '회의자료');
  legacyMeeting(data, 1, { projectName: '홈페이지 개편', title: '디자인 시안 검토', date: '2026-09-18', dailySequence: 2 });
  fs.writeFileSync(path.join(data, '프로젝트-01', `회의-${randomUUID()}.json`), '{broken');
  const meeting = createMeetingServer({ dataDir: data, apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const api = async (route, body) => (await fetch(origin + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) })).json();
  await api('/api/key', { apiKey: 'mock-only', persist: false });
  const minutes = { overview: '전체 방향 | 이번 주 업무를 점검했습니다.', topics: [{ title: '일정', points: ['다음 주 금요일까지 시안을 확정합니다.'] }], decisions: ['시안 A 채택'], actions: [{ task: '상세 화면 만들기', owner: '이대리', due: '10월 30일' }], openQuestions: [] };
  const saved = await api('/api/meetings/main', { id: randomUUID(), title: '주간 업무 점검', date: '2026-10-22', participants: '김과장, 이대리', transcript: '발언', minutes });
  await api(`/api/meetings/main/${saved.meeting.id}/review`, { stars: 4, comment: '담당자가 맞습니다.' });
  await api(`/api/recordings/main/${randomUUID()}`, { title: '', date: '2026-10-23', participants: '', expectedParts: 1 });
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  for (const [name, width, height] of [['데스크톱', 1440, 900], ['태블릿', 900, 1100], ['휴대폰', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/#${meeting.token}`);
    await page.waitForFunction(() => document.querySelectorAll('#meeting-history .history-button').length === 3);
    await page.screenshot({ path: path.join(out, `${name}-기본.png`), fullPage: true });
    await page.click('#prepare');
    await page.waitForFunction(() => !document.getElementById('meeting-setup').hidden);
    await page.screenshot({ path: path.join(out, `${name}-회의준비.png`), fullPage: true });
    const info = await page.evaluate(() => ({
      start: document.getElementById('start').disabled ? '막힘' : '눌림', hint: document.getElementById('start-hint').textContent.trim(),
      history: document.getElementById('history-status').textContent, items: [...document.querySelectorAll('#meeting-history .history-button')].map(button => button.innerText.replace(/\n/g, ' / ')),
      notice: document.getElementById('consent-notice')?.offsetParent !== null, titleNote: document.querySelector('label:has(#title) .field-note')?.textContent,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    console.log(name, JSON.stringify(info, null, 1), errors.length ? `오류: ${errors.join(' / ')}` : '오류 없음');
    await page.close();
  }
  await browser.close();
  meeting.server.closeAllConnections();
  await new Promise(resolve => meeting.server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exit(1); });
