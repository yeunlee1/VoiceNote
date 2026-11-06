// 화면 검사용 모의 브리지에 앱 업데이트 응답을 덧붙인다. 주소의 ?update=<상태>로 처음 상태를 고르고, init·status 응답에도 같은 상태를 넣는다.
module.exports = '(' + function () {
  const m = window.__mock, previous = window.Native.request.bind(window.Native);
  const query = new URL(location.href).searchParams;
  const size = 31457280, published = '2026-11-20T01:00:00Z';
  const base = { supported: true, currentVersion: '1.5.0', status: 'latest', version: null, publishedAt: null, size: 0, received: 0, error: null, needsPermission: false, canContinue: false, pageUrl: 'https://github.com/yeunlee1/VoiceNote/releases/latest' };
  const next = { version: '1.5.1', publishedAt: published, size };
  const presets = {
    latest: {},
    available: { ...next, status: 'available' },
    downloading: { ...next, status: 'downloading', received: 12582912 },
    ready: { ...next, status: 'ready', received: size },
    permission: { ...next, status: 'ready', received: size, needsPermission: true },
    confirming: { ...next, status: 'confirming', received: size, canContinue: true },
    manual: { ...next, size: 0, status: 'manual', error: { code: 'UPDATE_MANUAL', message: '새 버전의 자동 설치 정보를 찾지 못했습니다. 깃허브 릴리즈 페이지에서 설치파일을 직접 받아 설치하세요.' } },
    unknown: { status: 'unknown', error: { code: 'UPDATE_CHECK_FAILED', message: '새 버전을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인을 눌러 주세요.' } },
    installed: { ...next, status: 'installed', received: size },
  };
  m.update = { ...base, ...(presets[query.get('update') || 'latest'] || {}) };
  m.updateCalls = [];
  // 회의 준비 저장과 설치 요청이 네이티브에 닿은 차례다. holdDraft를 켜면 저장 응답을 붙잡아 두었다가 releaseDrafts()로 차례대로 보낸다.
  m.sequence = [];
  m.holdDraft = false;
  m.heldDrafts = [];
  m.releaseDrafts = () => { m.holdDraft = false; for (const send of m.heldDrafts.splice(0)) send(); };
  // 시험이 받기를 끝내거나 상태를 바꿀 때 쓴다. 바뀐 상태는 다음 상태 조회(1.5초마다)로 화면에 간다.
  m.setUpdate = name => { m.update = { ...base, ...presets[name] }; };
  const snapshot = () => JSON.parse(JSON.stringify(m.update));
  // init·status 응답에 업데이트 상태를 넣는다. 받는 함수를 한 번만 감싸고 되돌리지 않아, 다른 감싸기와 겹쳐도 응답을 놓치지 않는다.
  const pending = new Set();
  let wrapped = false;
  const wrap = () => {
    if (wrapped || typeof window.receive !== 'function') return;
    wrapped = true;
    const original = window.receive;
    window.receive = function (rid, payload) {
      if (pending.delete(rid) && payload && payload.value && typeof payload.value === 'object') payload.value.update = snapshot();
      return original(rid, payload);
    };
  };
  const handlers = {
    update: () => snapshot(),
    updateCheck: () => snapshot(),
    updateDownload: () => {
      if (m.update.status !== 'available') throw Error('받을 새 버전이 없습니다. 다시 확인을 눌러 주세요.');
      m.update = { ...m.update, status: 'downloading', received: 0, error: null };
      return snapshot();
    },
    updateInstall: () => {
      if (m.active) throw Error('녹음이나 분석이 끝난 뒤 설치하세요.');
      if (m.update.status !== 'ready') throw Error('설치할 업데이트가 아직 준비되지 않았습니다.');
      if (m.update.needsPermission) return snapshot();
      m.update = { ...m.update, status: 'confirming', canContinue: false, error: null };
      return snapshot();
    },
    updateConfirm: () => {
      if (!m.update.canContinue) throw Error('이어서 열 설치 화면이 없습니다. 설치를 다시 눌러 주세요.');
      return snapshot();
    },
    updatePermission: () => true,
    updatePage: () => true,
  };
  window.Native.request = function (id, method, json) {
    wrap();
    if (method === 'init' || method === 'status') { pending.add(id); return previous(id, method, json); }
    if (method === 'saveDraft') {
      // failDraft 횟수만큼 저장을 실패로 돌려준다.
      const send = () => {
        const title = JSON.parse(json).title;
        if (m.failDraft > 0) { m.failDraft--; m.sequence.push('saveDraft-failed:' + title); setTimeout(() => window.receive(id, { value: null, error: '회의 준비를 저장하지 못했습니다(시험).' }), 0); return; }
        m.sequence.push('saveDraft:' + title); previous(id, method, json);
      };
      if (m.holdDraft) m.heldDrafts.push(send); else send();
      return;
    }
    if (!(method in handlers)) return previous(id, method, json);
    m.updateCalls.push(method);
    m.sequence.push(method);
    let value = null, error = null;
    try { value = handlers[method](); } catch (failure) { error = failure.message; }
    setTimeout(() => window.receive(id, { value, error }), 0);
  };
}.toString() + ')();';
