// Task 17 실제 창 확인 준비: 임시 자료 폴더에 합성 옛 프로젝트 기록과 새 회의, 형식만 맞는 가짜 키, 빈 사본 폴더를 만든다. 실제 회의자료는 건드리지 않는다.
const fs = require('node:fs'), path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const repo = 'C:/DEV/VoiceNote';
const { createMeetingServer } = require(path.join(repo, 'desktop/앱/서버.cjs'));
const { legacyMeeting } = require(path.join(repo, 'desktop/tests/옛기록.cjs'));
const root = process.argv[2];
(async () => {
  if (fs.existsSync(root)) throw new Error(`이미 있는 폴더입니다: ${root}`);
  const data = path.join(root, '회의자료');
  fs.mkdirSync(path.join(root, '사본폴더'), { recursive: true });
  legacyMeeting(data, 1, { projectName: '홈페이지 개편', title: '디자인 시안 검토', date: '2026-09-18', dailySequence: 2 });
  legacyMeeting(data, 2, { projectName: '사내 교육', title: '교육 일정 조율', date: '2026-09-30', dailySequence: 1 });
  const meeting = createMeetingServer({ dataDir: data, settingsFile: path.join(root, 'AI설정.json'), apiFetch: async () => { throw new Error('외부 AI를 부르면 안 됩니다.'); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const minutes = { overview: '전체 방향 | 이번 주 업무를 점검했습니다.', topics: [{ title: '일정', points: ['다음 주 금요일까지 시안을 확정합니다.'] }], decisions: ['시안 A 채택'], actions: [{ task: '상세 화면 만들기', owner: '이대리', due: '10월 30일' }], openQuestions: [] };
  const saved = await (await fetch(origin + '/api/meetings/main', { method: 'POST', headers, body: JSON.stringify({ id: randomUUID(), title: '주간 업무 점검', date: '2026-10-22', participants: '김과장, 이대리', transcript: '발언', minutes }) })).json();
  meeting.server.closeAllConnections();
  await new Promise(resolve => meeting.server.close(resolve));
  // 시작 버튼을 켜기 위한 형식만 맞는 가짜 키다. 이 임시 폴더에만 두고 외부로 보내지 않는다(회의 종료를 누르지 않음).
  fs.writeFileSync(path.join(root, '.env.회의록키'), JSON.stringify({ apiKey: `sk-test-${randomBytes(12).toString('hex')}` }));
  console.log(JSON.stringify({ root, newMeeting: saved.meeting?.id, files: fs.readdirSync(data) }, null, 1));
})().catch(error => { console.error(error); process.exit(1); });
