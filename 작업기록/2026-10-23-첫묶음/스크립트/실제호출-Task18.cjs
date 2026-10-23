// Task 18 실제 OpenAI 확인: 저장된 키를 값 출력 없이 읽어 Windows 서버 모듈로 지어낸 짧은 회의를 요약한다. 실제 호출은 최대 6회로 막는다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const repo = process.argv[3] || 'C:/DEV/VoiceNote';
const out = process.argv[2];
const { createMeetingServer } = require(path.join(repo, 'desktop/앱/서버.cjs'));
const LIMIT = 6;

const transcript = [
  '김과장: 이번 주 안건은 홈페이지 시안 확정과 견적 검토입니다.',
  '박대리: 시안은 A안과 B안이 있는데, 모바일에서는 A안이 더 잘 읽힙니다.',
  '김과장: 그럼 A안으로 가죠. 금요일까지 시안을 확정합시다.',
  '이대리: 견적 검토는 누가 하나요?',
  '김과장: 처음엔 제가 보려고 했는데, 이대리가 업체 연락을 맡고 있으니 견적 검토도 이대리가 맡아 주세요.',
  '이대리: 네, 다음 주 화요일까지 정리해서 공유하겠습니다.',
  '박대리: 예산은 아직 정해지지 않았죠?',
  '김과장: 예산은 다음 회의에서 다시 정합시다.',
].join('\n');
// 앞부분은 전사와 맞는 고침, 뒷부분(예산 500만 원)은 전사에 없는 내용이다. 결정으로 만들지 않는지 본다.
const feedback = '담당자가 틀렸어요. 견적 검토는 이대리가 맡기로 했습니다. 그리고 예산은 500만 원으로 정했어요.';

(async () => {
  const keyFile = path.join(process.env.LOCALAPPDATA, 'MeetingJournal', '.env.회의록키');
  if (!fs.existsSync(keyFile)) throw new Error('저장된 API 키 파일이 없어 실제 호출을 하지 않았습니다.');
  let apiKey = String(JSON.parse(fs.readFileSync(keyFile, 'utf8')).apiKey || '').trim();
  if (!apiKey) throw new Error('키 파일에 apiKey 값이 없어 실제 호출을 하지 않았습니다.');
  fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voicenote-api-'));
  let calls = 0;
  // 서버가 OpenAI로 보내는 모든 요청을 세고, 한도를 넘으면 보내지 않는다.
  const meeting = createMeetingServer({ dataDir: path.join(dir, '회의자료'), settingsFile: path.join(dir, 'AI설정.json'),
    apiFetch: async (url, request) => { if (++calls > LIMIT) throw new Error(`실제 호출 한도 ${LIMIT}회를 넘으려 해 멈췄습니다.`); return fetch(url, request); } });
  await new Promise(resolve => meeting.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${meeting.server.address().port}`;
  const headers = { Origin: origin, 'X-Meeting-Token': meeting.token, 'Content-Type': 'application/json' };
  const post = async (route, body, extra = {}) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const report = { date: new Date().toISOString(), model: null, limit: LIMIT, runs: [] };
  try {
    const key = await post('/api/key', { apiKey, persist: false });
    apiKey = null;
    if (key.status !== 200) throw new Error(`키 등록 실패 ${key.status}`);
    const summarize = async (label, extra) => {
      const before = calls;
      const result = await post('/api/summary', { text: transcript, title: '', date: '2026-10-23', participants: '김과장, 박대리, 이대리', ...extra },
        { 'X-Operation-Id': randomUUID(), 'X-AI-Consent': 'yes', 'X-Analysis-Id': randomUUID() });
      const minutes = result.body?.minutes || null;
      report.model ||= result.body?.aiCall?.model || result.body?.model || null;
      report.runs.push({ label, request: { outputFormat: extra.outputFormat, feedback: extra.feedback || null }, status: result.status, openaiCalls: calls - before,
        aiCall: result.body?.aiCall || null, error: result.body?.error ? { code: result.body.error.code, message: result.body.error.message } : null, minutes });
      return minutes;
    };
    const first = await summarize('1. 회의록 형식', { outputFormat: 'meeting' });
    const refined = await summarize('2. 같은 결과에 의견을 줘 다시 정리', { outputFormat: 'meeting', feedback });
    const tasks = await summarize('3. 업무 정리 형식', { outputFormat: 'tasks' });
    const owner = (minutes) => (minutes?.actions || []).filter(item => /견적/.test(item.task)).map(item => item.owner);
    const text = (value) => JSON.stringify(value || {});
    report.checks = {
      allSucceeded: report.runs.every(run => run.status === 200 && run.minutes),
      firstEstimateOwner: owner(first),
      refinedEstimateOwner: owner(refined),
      refinedBudgetInDecisions: (refined?.decisions || []).some(item => /500/.test(item)),
      refinedBudgetMentions: [...text(refined?.decisions).matchAll(/[^"]*500[^"]*/g), ...text(refined?.openQuestions).matchAll(/[^"]*500[^"]*/g)].map(match => match[0]),
      tasksHaveOwners: (tasks?.actions || []).map(item => ({ task: item.task, owner: item.owner, due: item.due })),
    };
  } finally {
    report.totalOpenAICalls = calls;
    fs.writeFileSync(path.join(out, '2026-10-23-실제호출-결과.json'), JSON.stringify(report, null, 2));
    meeting.server.closeAllConnections();
    await new Promise(resolve => meeting.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(JSON.stringify({ totalOpenAICalls: calls, statuses: report.runs.map(run => [run.label, run.status, run.openaiCalls, run.error?.code || '']), checks: report.checks }, null, 1));
  }
})().catch(error => { console.error('실패:', error.message); process.exit(1); });
