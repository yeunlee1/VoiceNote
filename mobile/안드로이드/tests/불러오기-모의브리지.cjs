// 휴대폰 녹음 파일 불러오기 요청(importAudio)의 합성 응답을 기존 화면 시험 브리지에 덧붙인다.
module.exports = '(' + function () {
  const m = window.__mock, previous = window.Native.request.bind(window.Native);
  m.importMode = 'ok'; m.importDelay = 0;
  window.Native.request = function (id, method, json) {
    if (method !== 'importAudio') return previous(id, method, json);
    const d = JSON.parse(json); m.calls.push({ method, data: d });
    const reply = (value, error) => setTimeout(() => window.receive(id, { value, error }), m.importDelay || 0);
    if (m.importMode === 'cancel') return reply({ cancelled: true }, null);
    if (m.importMode === 'reject') return reply(null, '‘메모.m4a’ 파일은 불러올 수 없습니다. m4a 녹음 파일만 불러올 수 있습니다.');
    // ok는 서비스가 담기를 시작한 상태, failFast는 회의를 만들기 전에 곧바로 실패해 첫 상태 조회부터 끝나 있는 상태다.
    // stale은 서비스가 진행 중이 됐지만 아직 앞선 회의의 상태를 내놓는 순간, late는 서비스가 아직 시작되지 않은 순간이다.
    if (m.importMode === 'failFast') { m.active = false; m.meeting = { state: 'failed', message: '휴대폰 저장 공간이 부족해 파일을 불러오지 못했습니다.', attemptId: d.attemptId }; }
    else if (m.importMode === 'stale') { m.active = true; m.meeting = { id: '33333333-3333-3333-3333-333333333333', location: 'main', state: 'complete', message: '회의록을 저장했습니다.', createdAt: 1 }; }
    else if (m.importMode === 'late') { m.active = false; m.meeting = { id: '33333333-3333-3333-3333-333333333333', location: 'main', state: 'complete', message: '회의록을 저장했습니다.', createdAt: 1 }; }
    else { m.active = true; m.meeting = { state: 'analyzing', message: '녹음 파일을 준비하는 중', createdAt: Date.now(), attemptId: d.attemptId }; }
    reply({ id: null, started: true }, null);
    // 네이티브는 회의를 만든 뒤에야 초안을 지우므로 시작 응답에서는 초안을 그대로 둔다.
  };
} + ')();';
