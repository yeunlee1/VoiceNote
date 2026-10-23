// 설치형 프로그램의 회의 자료를 사용자 폴더에 저장하고 부모 창과 함께 종료한다.
const fs = require('node:fs');
const path = require('node:path');
const { createMeetingServer } = require('./서버.cjs');
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
const meeting = createMeetingServer({ dataDir: path.join(root, '회의자료'), keyFile: path.join(root, '.env.회의록키'),
  defaultKeyFile: path.join(__dirname, '기본키.json') });
const watchdog = setInterval(() => {
  try { process.kill(parentPid, 0); }
  catch {
    meeting.server.closeAllConnections();
    meeting.server.close();
  }
}, 1000);
meeting.server.once('close', () => clearInterval(watchdog));
meeting.server.listen(0, '127.0.0.1', () => {
  try {
    const ready = { url: `http://127.0.0.1:${meeting.server.address().port}/#${meeting.token}`, pid: process.pid };
    fs.writeFileSync(readyFile, JSON.stringify(ready), { flag: 'wx', mode: 0o600 });
    meeting.setReadyFile(readyFile);
  } catch {
    meeting.server.close();
  }
});
