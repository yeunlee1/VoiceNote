// Task 17 실제 창 확인: 설치형 실행 파일을 숨긴 창으로 띄우고 WebView2 디버깅 포트에 Playwright로 붙어 사용자 마우스·키보드 없이 확인한다.
// 확인 항목은 옛 기록 목록, 설정 창의 웹뷰 전용 구역, 폴더 선택 메시지 왕복(창은 UI 자동화로 바로 취소), 마이크 자동 허용 녹음 시작이다. 녹음은 저장하지 않고 프로세스를 끝낸다.
const fs = require('node:fs'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('C:/DEV/11_로컬작업물/_잡다파일/node_modules/테스트체크리스트_20260727/playwright-core');
const [exe, root, out] = process.argv.slice(2);
const port = 9300 + Math.floor(Math.random() * 90);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// 폴더 선택 창(#32770)을 찾으면 마우스 없이 창 닫기(WindowPattern.Close, 취소와 같음)로 닫는다.
function cancelFolderDialog(pid) {
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A=[System.Windows.Automation.AutomationElement]; $S=[System.Windows.Automation.TreeScope]
$c=New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, ${pid})), (New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')))
for($i=0;$i -lt 30;$i++){ $d=$A::RootElement.FindFirst($S::Descendants,$c); if($d){ $d.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close(); 'cancelled'; exit 0 }; Start-Sleep -Milliseconds 200 }
'not-found'`;
  const env = { ...process.env, PSModulePath: '' };
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { env, encoding: 'utf8', timeout: 20000 }).trim();
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { port, steps: [] };
  const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); console.log(ok ? '통과' : '실패', name, detail === undefined ? '' : JSON.stringify(detail)); };
  // 이 PC에는 마이크 장치가 없어 가상 장치를 쓴다. 허가 처리는 가상 승인(--use-fake-ui-for-media-stream) 없이 앱의 PermissionRequested가 맡는다.
  const child = spawn(exe, ['--data-root', root], { windowsHide: true, detached: false, stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --use-fake-device-for-media-stream` } });
  report.pid = child.pid;
  let browser;
  try {
    for (let i = 0; i < 60 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await wait(500); } }
    if (!browser) throw new Error('WebView2 디버깅 포트에 붙지 못했습니다.');
    let page;
    for (let i = 0; i < 60 && !page; i++) { page = browser.contexts().flatMap(context => context.pages()).find(p => p.url().startsWith('http://127.0.0.1')); if (!page) await wait(500); }
    if (!page) throw new Error('VoiceNote 화면을 찾지 못했습니다.');
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.waitForFunction(() => document.querySelectorAll('#meeting-history .history-button').length >= 3, null, { timeout: 30000 });
    const history = await page.$$eval('#meeting-history .history-button', buttons => buttons.map(button => button.innerText.replace(/\n/g, ' / ')));
    step('옛 프로젝트 기록과 새 회의가 한 목록에 보인다', history.length === 3 && history.some(text => text.includes('이전 프로젝트: 홈페이지 개편')) && history.some(text => text.includes('이전 프로젝트: 사내 교육')), history);
    await page.screenshot({ path: path.join(out, '2026-10-23-실제창-목록.png') }).catch(error => step('목록 캡처', false, String(error)));

    await page.click('#open-settings');
    await page.waitForSelector('#settings[open]');
    const sections = await page.evaluate(() => ({ data: !document.getElementById('settings-data').hidden, pick: ['audio', 'transcript', 'summary'].map(kind => !document.getElementById(`pick-${kind}`).hidden), webview: Boolean(window.chrome?.webview) }));
    step('웹뷰 안에서 회의자료 폴더 구역과 폴더 고르기 단추가 보인다', sections.webview && sections.data && sections.pick.every(Boolean), sections);
    await page.screenshot({ path: path.join(out, '2026-10-23-실제창-설정.png') }).catch(() => {});

    // 폴더 고르기: 창이 객체 메시지를 받아 폴더 선택 창을 띄우고, 취소하면 path null을 돌려줘 아무것도 저장하지 않아야 한다.
    await page.evaluate(() => { window.__hostMessages = []; window.chrome.webview.addEventListener('message', event => window.__hostMessages.push(event.data)); });
    await page.click('#pick-summary');
    const cancelled = cancelFolderDialog(child.pid);
    await page.waitForFunction(() => window.__hostMessages.length > 0, null, { timeout: 10000 }).catch(() => {});
    const reply = await page.evaluate(() => window.__hostMessages);
    const settingsFile = path.join(root, 'AI설정.json');
    const saved = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : null;
    step('폴더 고르기를 누르면 Windows 폴더 선택 창이 뜨고, 취소하면 path null로 답하며 저장하지 않는다',
      cancelled.startsWith('cancelled') && reply.length === 1 && reply[0]?.type === 'folder-picked' && reply[0]?.kind === 'summary' && reply[0]?.path === null && !saved?.storage?.summary,
      { cancelled, reply, storage: saved?.storage || null });
    await page.click('#settings [data-close]');

    // 마이크 자동 허용: 회의 시작을 누르면 허가 창 없이 녹음이 시작되어야 한다. 녹음은 저장하지 않는다.
    await page.click('#start');
    const started = await page.waitForFunction(() => !document.getElementById('stop').hidden || /오류|허용|실패/.test(document.getElementById('status').textContent), null, { timeout: 15000 }).then(() => true).catch(() => false);
    const recording = await page.evaluate(() => ({ stopVisible: !document.getElementById('stop').hidden, state: document.getElementById('record-state').textContent, status: document.getElementById('status').textContent, hint: document.getElementById('start-hint').textContent.trim() }));
    await page.waitForTimeout(1500);
    const level = await page.evaluate(() => document.getElementById('level-meter').getAttribute('aria-valuenow'));
    step('회의 시작을 누르면 마이크 허가 창 없이 바로 녹음한다', started && recording.stopVisible, { ...recording, level });
    await page.screenshot({ path: path.join(out, '2026-10-23-실제창-녹음중.png') }).catch(() => {});
    step('페이지 오류가 없다', errors.length === 0, errors);
  } catch (error) {
    step('실행', false, String(error && error.message || error));
  } finally {
    try { await browser?.close(); } catch {}
    // 저장하지 않고 끝내도록 실행 파일과 하위 프로세스(WebView2·로컬 서버)를 함께 끝낸다.
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await wait(1000);
    const left = fs.readdirSync(path.join(root, '회의자료', '회의기록')).filter(name => name.startsWith('녹음-'));
    report.recordingsLeft = left;
    fs.writeFileSync(path.join(out, '2026-10-23-실제창-결과.json'), JSON.stringify(report, null, 2));
    console.log('저장된 새 녹음 기록', left.length, '개');
  }
})().catch(error => { console.error(error); process.exit(1); });
