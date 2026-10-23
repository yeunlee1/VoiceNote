// 실제 헤드리스 브라우저에서 CRLF·앞뒤 공백이 있는 프로젝트 설명을 불러와도 변경으로 보지 않고 원문 그대로 내보내고 저장하는지 검증한다.
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

const original = '  [회의 목적]\r\n문서 표준화를 논의합니다.\r\n\r\n  들여쓴 줄\t\r\n끝 공백  \r\n';
const settingsFile = () => ({ format: 'voicenote-project-settings', version: 1, projects: Array.from({ length: 9 }, (_, i) => i === 0
  ? { slot: 1, name: '줄바꿈 시험', title: '주간 회의', context: original, outputFormat: 'summary' }
  : { slot: i + 1, name: '', title: '', context: '', outputFormat: 'meeting' }) });

test('CRLF·앞뒤 공백 설명을 불러온 뒤 손대지 않으면 원문 그대로 내보내고, 다른 항목 저장에도 설명을 보존하며, 실제 수정은 입력 그대로 저장한다', async t => {
  const tools = browserTools();
  if (!tools) return t.skip('헤드리스 브라우저 도구가 없습니다.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-browser-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  // 정리 단계는 브라우저보다 서버를 먼저 닫는다. 브라우저가 미리 열어 둔 연결이 남아도 멈추지 않도록 모두 끊고 닫는다.
  t.after(() => new Promise(resolve => { meeting.server.closeAllConnections(); meeting.server.close(resolve); }));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const api = async (route, body) => (await fetch(origin + route, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) })).json();
  const file = settingsFile();
  const imported = await api('/api/project-settings/import', { file: JSON.stringify(file), revisions: Array(3).fill(0) });
  assert.equal(imported.projects[0].context, original);

  const browser = await tools.chromium.launch({ headless: true, executablePath: tools.chrome });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
  await page.goto(`${origin}/#${meeting.token}`);
  await page.waitForFunction(() => document.querySelectorAll('#project-presets .preset-button').length === 1 && document.querySelector('#project-presets .preset-add') && document.getElementById('project-name').value);
  assert.equal(await page.$eval('#meeting-context', node => node.value.includes('\r')), false);

  // 손대지 않고 내보내면 확인 창 없이 원본 파일과 같은 내용이 내려온다.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-settings')]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.deepEqual(dialogs, []);
  assert.deepEqual(exported, file);
  assert.equal(exported.projects[0].context, original);

  // 회의명만 바꿔 저장해도 설명 원문은 바이트 그대로 남는다.
  await page.click('#prepare');
  await page.click('.preset-details summary');
  await page.fill('#title', '바뀐 회의명');
  await page.click('#save-preset');
  await page.waitForFunction(() => /프리셋을 저장했습니다/.test(document.getElementById('workflow-status').textContent));
  let saved = (await api('/api/projects')).projects[0];
  assert.equal(saved.title, '바뀐 회의명');
  assert.equal(saved.context, original);
  assert.equal(saved.outputFormat, 'summary');

  // 설명을 실제로 고치면 변경으로 보고, 저장하면 입력칸 내용을 자르지 않고 그대로 저장한다.
  const edited = '  고친 설명\n둘째 줄  ';
  await page.fill('#meeting-context', edited);
  await page.click('#export-settings');
  await page.waitForTimeout(200);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /저장되지 않아 파일에 들어가지 않습니다/);
  await page.click('#save-preset');
  for (let i = 0; i < 50 && (saved = (await api('/api/projects')).projects[0]).revision < 3; i++) await page.waitForTimeout(100);
  assert.equal(saved.context, edited);
  assert.equal(saved.revision, 3);
  const [again] = await Promise.all([page.waitForEvent('download'), page.click('#export-settings')]);
  assert.equal(dialogs.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(await again.path(), 'utf8')).projects[0].context, edited);
});
