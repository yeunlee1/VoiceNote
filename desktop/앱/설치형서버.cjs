// 설치형 프로그램의 회의 자료를 사용자 폴더에 저장하고 부모 창과 함께 종료한다.
const fs = require('node:fs');
const path = require('node:path');
const { createMeetingServer } = require('./서버.cjs');
const { createUpdater } = require('./업데이트.cjs');
const { APP_VERSION } = require('./앱버전.cjs');
const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error('실행 인수가 없습니다.');
  return args[index + 1];
}
const root = argument('--data-root');
const readyFile = argument('--ready-file');
const parentPid = Number(argument('--parent-pid'));
if (!path.isAbsolute(root) || !path.isAbsolute(readyFile) || !Number.isSafeInteger(parentPid) || parentPid < 1)
  throw new Error('실행 경로와 부모 프로세스를 확인하세요.');
fs.mkdirSync(root, { recursive: true });
// Windows 창은 일반 실행일 때만 --app-updates를 넘긴다. 업데이트 담당은 node.exe 옆에 실행 파일과 제거 프로그램이 있을 때만 실제로 켜진다.
const updater = createUpdater({ enabled: args.includes('--app-updates'), currentVersion: APP_VERSION, appDir: path.dirname(process.execPath), hostPid: parentPid });
const meeting = createMeetingServer({ dataDir: path.join(root, '회의자료'), keyFile: path.join(root, '.env.회의록키'),
  defaultKeyFile: path.join(__dirname, '기본키.json'), updater });
const watchdog = setInterval(() => {
  try { process.kill(parentPid, 0); }
  catch {
    meeting.server.closeAllConnections();
    meeting.server.close();
  }
}, 1000);
meeting.server.once('close', () => clearInterval(watchdog));
function publishReady(partial, file) {
  // 다 쓴 임시 파일을 준비 파일 이름에 한 번에 잇는다. 창과 시험은 준비 파일이 보이자마자 읽으므로 내용이 빈 준비 파일이 보이면 안 되고, 이미 있는 준비 파일은 덮지 않는다.
  try { fs.linkSync(partial, file); }
  catch (error) {
    if (error.code === 'EEXIST') throw error;
    if (fs.existsSync(file)) throw Object.assign(new Error('준비 파일이 이미 있습니다.'), { code: 'EEXIST' });
    fs.renameSync(partial, file);
    // 링크를 만들 수 없는 드라이브면 이름 바꾸기로 한 번에 내놓는다. 이름 바꾸기는 있는 파일을 덮으므로 바로 앞에서 한 번 더 확인한다. 창이 만든 고유한 이름이라 그 사이에 같은 이름이 생길 일은 없다.
    return;
  }
  try { fs.rmSync(partial, { force: true }); } catch {}
  // 준비 파일은 이미 내놓았으므로 임시 이름을 지우지 못해도 서버는 그대로 둔다.
}
meeting.server.listen(0, '127.0.0.1', () => {
  const partial = `${readyFile}.${process.pid}.tmp`;
  let created = false;
  try {
    const ready = { url: `http://127.0.0.1:${meeting.server.address().port}/#${meeting.token}`, pid: process.pid };
    const fd = fs.openSync(partial, 'wx', 0o600);
    created = true;
    // 임시 파일을 연 순간부터 이번 실행의 것으로 보고, 쓰다가 실패해도 아래에서 지운다.
    try { fs.writeFileSync(fd, JSON.stringify(ready)); } finally { fs.closeSync(fd); }
    publishReady(partial, readyFile);
    meeting.setReadyFile(readyFile);
  } catch {
    if (created) try { fs.rmSync(partial, { force: true }); } catch {}
    // 이번 실행이 만든 임시 파일만 지운다. 지우지 못해도 서버는 닫는다.
    meeting.server.close();
  }
});
