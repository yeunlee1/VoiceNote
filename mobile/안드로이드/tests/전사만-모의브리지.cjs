// 휴대폰 회의 종료 hold·분석 방식(analyze mode)·전사 없는 회의 열기의 합성 응답을 기존 화면 시험 브리지에 덧붙인다. __mock.modeTest가 있을 때만 끼어든다.
module.exports = '(' + function () {
  const m = window.__mock, previous = window.Native.request.bind(window.Native);
  m.modeTest = null;
  window.Native.request = function (id, method, json) {
    const t = m.modeTest;
    if (method === 'status' && t && t.onStatus) t.onStatus();
    if (method === 'open' && t) {
      const d = JSON.parse(json), record = m.history.find(r => r.location === d.location && r.id === d.id);
      if (record && record.noTranscript) { m.calls.push({ method, data: d }); setTimeout(() => window.receive(id, { value: { record, minutes: null, transcript: '', resultId: null, versions: [], review: null }, error: null }), 0); return; }
    }
    if (!t || !['finish', 'analyze'].includes(method)) return previous(id, method, json);
    const d = JSON.parse(json); m.calls.push({ method, data: d });
    const reply = value => setTimeout(() => window.receive(id, { value, error: null }), 0);
    if (method === 'finish') {
      // 서비스는 요청을 받은 뒤 stale번의 상태 조회 동안 앞선 녹음 상태를 내놓다가 저장(또는 실패)을 마친다.
      let left = t.stale || 0; const meeting = { ...m.meeting };
      t.onStatus = () => {
        if (left-- > 0) return;
        t.onStatus = null; m.active = false;
        if (t.saveFails) { m.meeting = { ...meeting, state: 'failed', message: '녹음이 너무 짧거나 마이크가 중단되었습니다. 남은 원음은 보관했습니다.' }; return; }
        m.meeting = { ...meeting, state: 'saved', message: '음성 저장 완료' };
        if (!m.history.some(r => r.id === meeting.id)) m.history.unshift({ id: meeting.id, location: 'main', date: '2026-11-17', dailySequence: 3, title: '', state: 'saved', createdAt: Date.now(), audio: ['원음-001.m4a'] });
      };
      return reply(true);
    }
    // 분석은 fast면 첫 상태 조회 전에 끝 상태로, 아니면 진행 상태를 거쳐 끝 상태로 간다. 끝나면 목록 기록의 상태도 바꾼다.
    const transcript = d.mode === 'transcript';
    const end = { id: d.id, location: d.location, state: transcript ? 'transcribed' : 'complete', message: transcript ? '전사 저장 완료 · 회의록이 필요하면 정리본 탭의 ‘회의록 만들기’를 누르세요.' : '회의록 저장 완료', attemptId: d.attemptId, createdAt: Date.now() };
    const finish = () => { m.active = false; m.meeting = end; const record = m.history.find(r => r.id === d.id && r.location === d.location); if (record) { record.state = end.state; delete record.noTranscript; } };
    if (t.fast) finish(); else { m.active = true; m.meeting = { ...end, state: 'analyzing', message: transcript ? '음성을 글로 변환 중 · 1 / 1' : '회의록 분석 중' }; setTimeout(finish, 300); }
    return reply({ id: d.id });
  };
} + ')();';
