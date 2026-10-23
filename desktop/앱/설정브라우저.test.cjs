// 실제 서버와 헤드리스 Chrome에서 설정 2판을 내보내고 값을 바꾼 뒤 다시 불러오면 처음 값이 화면과 서버에 돌아오는지 검증한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
// VN_SERVER로 이전 빌드의 서버(같은 폴더의 화면 포함)를 지정해 회귀 여부를 비교할 수 있다.
const { createMeetingServer } = require(process.env.VN_SERVER || './서버.cjs');

// 브라우저 도구는 이 PC의 설치 위치를 쓰고, 없으면 시험을 건너뛴다. VN_PLAYWRIGHT·VN_CHROME으로 바꿀 수 있다.
function browserTools() {
  const moduleDir = process.env.VN_PLAYWRIGHT || 'C:/DEV/11_로컬작업물/_잡다파일/node_modules/테스트체크리스트_20260727/playwright-core';
  let chrome = process.env.VN_CHROME;
  if (!chrome) {
    const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const shell = fs.existsSync(root) ? fs.readdirSync(root).filter(name => name.startsWith('chromium_headless_shell-')).sort().at(-1) : null;
    if (shell) chrome = path.join(root, shell, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  }
  if (!fs.existsSync(moduleDir) || !chrome || !fs.existsSync(chrome)) return null;
  return { chromium: require(moduleDir).chromium, chrome };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test('설정 2판을 내보내고 다시 불러오면 같은 값이 화면에 보인다', async t => {
  const tools = browserTools();
  if (!tools) return t.skip('헤드리스 브라우저 도구가 없습니다.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-browser-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const summaryFolder = path.join(dir, '요약 사본');
  fs.mkdirSync(summaryFolder);
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile: path.join(dir, 'AI설정.json'), apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  // 정리 단계는 브라우저보다 서버를 먼저 닫는다. 브라우저가 미리 열어 둔 연결이 남아도 멈추지 않도록 모두 끊고 닫는다.
  t.after(() => new Promise(resolve => { meeting.server.closeAllConnections(); meeting.server.close(resolve); }));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const api = async (route, body, method = body ? 'POST' : 'GET') => (await fetch(origin + route, { method,
    headers: { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  const custom = { name: '주간 보고', sections: [{ key: 'actions', title: '할 일' }, { key: 'overview', title: '요약' }], instruction: '담당자는 이름만 씁니다.' };
  const original = { summaryModel: 'gpt-6-luna', defaultOutputFormat: 'summary', storage: { audio: '', transcript: '', summary: summaryFolder } };
  await api('/api/settings', { summaryModel: original.summaryModel, defaultOutputFormat: original.defaultOutputFormat, storage: { summary: summaryFolder } });
  await api('/api/custom-format', custom);

  const browser = await tools.chromium.launch({ headless: true, executablePath: tools.chrome });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${origin}/#${meeting.token}`);
  await page.waitForFunction(() => document.getElementById('meeting-history').children.length > 0);
  await page.click('#open-settings');
  await page.waitForSelector('#settings[open]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-settings')]);
  assert.equal(download.suggestedFilename(), `${today()}-VoiceNote-설정.json`);
  const exportedPath = path.join(dir, download.suggestedFilename());
  await download.saveAs(exportedPath);
  const exported = JSON.parse(fs.readFileSync(exportedPath, 'utf8'));
  assert.deepEqual({ ...exported, customFormat: exported.customFormat.name }, { format: 'voicenote-settings', version: 2, ...original, customFormat: '주간 보고' });

  // 다른 값으로 바꾼 뒤, 화면의 설정 불러오기로 내보낸 파일을 다시 넣는다.
  await api('/api/settings', { summaryModel: 'gpt-6-astra', defaultOutputFormat: 'meeting', storage: { summary: '' } });
  await api('/api/custom-format', undefined, 'DELETE');
  await page.reload();
  await page.waitForFunction(() => document.getElementById('meeting-history').children.length > 0);
  await page.click('#open-settings');
  await page.waitForSelector('#settings[open]');
  assert.equal(await page.$eval('#default-format', node => node.value), 'meeting');
  await page.setInputFiles('#settings-file-input', exportedPath);
  await page.waitForSelector('#settings-import[open]');
  const shown = await page.$eval('#settings-preview', node => node.innerText);
  for (const text of ['핵심 요약', '주간 보고', summaryFolder]) assert.ok(shown.includes(text), text);
  await page.click('#confirm-import');
  await page.waitForFunction(() => !document.getElementById('settings-import').open);
  assert.equal(await page.$eval('#summary-model', node => node.value), 'gpt-6-luna');
  assert.equal(await page.$eval('#default-format', node => node.value), 'summary');
  assert.equal(await page.$eval('#storage-summary', node => node.textContent), summaryFolder);
  assert.equal(await page.$eval('#custom-name', node => node.value), '주간 보고');
  assert.deepEqual((await api('/api/settings')).settings, original);
  assert.equal((await api('/api/custom-format')).customFormat.name, '주간 보고');
  assert.deepEqual(errors, []);
});
