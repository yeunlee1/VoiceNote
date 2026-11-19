// 가상기기 시험용 가짜 OpenAI 서버다. 전사·회의록 응답과, 본문을 읽지 않는 올리기 멈춤·답하지 않는 무응답 경로를 흉내 내고 경로별 요청 수를 센다.
const http = require('node:http');

// 기기 시험 AndroidChecks.minutes()와 같은 항목 구조의 최소 회의록이다. MinutesItems.checkResponse를 통과한다.
// suggestedTitle은 넣지 않는다. 넣으면 저장할 때 회의 제목이 바뀌어, 같은 회의를 다시 분석할 때 구간 캐시 열쇠(제목 포함)가 달라진다.
const MINUTES = {
  overview: [{ text: '전체 방향', details: ['가짜 응답으로 진행 기록을 확인함'] }],
  topics: [{ title: '진행 기록', points: [{ text: '보냄과 받음을 시각과 함께 적음', details: [] }] }],
  decisions: [{ text: '기기 시험으로 확인', details: [] }],
  actions: [{ task: '결과 확인', owner: null, due: null }],
  openQuestions: [{ text: '남은 질문 없음', details: [] }],
};
const TRANSCRIPT = { text: '시험 회의 발언입니다.', usage: { type: 'duration', seconds: 5 } };
const COMPLETED = {
  status: 'completed',
  model: 'gpt-6-sol',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(MINUTES) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
};
const HOLD_MS = 20000;

function startFakeOpenAI({ delayMs = 0, transcriptBytesPerSecond = 0 } = {}) {
  // delayMs는 전사·회의록 답을 늦추는 시간이다. transcriptBytesPerSecond를 주면 전사 본문을 그 속도로만 읽어 휴대폰의 올리기 진행이 보이게 한다.
  const counts = {}, sockets = new Set(), timers = new Set();
  const later = (ms, run) => { const timer = setTimeout(() => { timers.delete(timer); run(); }, ms); timers.add(timer); };
  const server = http.createServer((request, response) => {
    const route = request.url.split('?')[0];
    counts[route] = (counts[route] || 0) + 1;
    if (route === '/v1/stall') {
      request.pause();
      later(HOLD_MS, () => request.socket.destroy());
      return;
      // 연결은 받되 본문을 읽지 않아 휴대폰 쪽 쓰기가 막히게 한다. 20초 뒤에는 닫아 시험이 끝나지 않는 일이 없게 한다.
    }
    const answer = body => later(delayMs, () => {
      if (response.writableEnded || request.socket.destroyed) return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
    if (route === '/v1/audio/transcriptions' && transcriptBytesPerSecond > 0) {
      const started = Date.now();
      let received = 0;
      request.on('data', chunk => {
        received += chunk.length;
        const ahead = received / transcriptBytesPerSecond * 1000 - (Date.now() - started);
        if (ahead > 0) { request.pause(); later(ahead, () => request.resume()); }
      });
    } else request.on('data', () => {});
    request.on('end', () => {
      if (route === '/v1/silent') later(HOLD_MS, () => request.socket.destroy());
      // 본문은 다 받았지만 답하지 않는다. 휴대폰 감시가 응답 없음으로 끊어야 한다.
      else if (route === '/v1/audio/transcriptions') answer(TRANSCRIPT);
      else if (route === '/v1/responses') answer(COMPLETED);
      else { response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'not_found' } })); }
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}/v1/`,
        counts,
        close: () => new Promise(done => {
          for (const timer of timers) clearTimeout(timer);
          for (const socket of sockets) socket.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}

module.exports = { startFakeOpenAI, MINUTES };
