// AI 요청 보냄·받음 일지의 줄 문구·기다림 글·일지 상태·그리기를 Windows·휴대폰 화면이 함께 쓰는 모듈
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeetingActivity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_ENTRIES = 30;
  const LIMIT_SECONDS = 300;
  const HINT = 'OpenAI는 일을 다 마친 뒤 한꺼번에 답을 보내서, 기다리는 동안에는 시간만 올라갑니다.';
  const FAILURE_TYPES = ['timeout', 'uploadStall', 'requestStall', 'disconnected', 'apiError', 'badFormat', 'saveFailed', 'failed', 'canceled'];

  const pad = value => String(value).padStart(2, '0');
  function clock(at) {
    const time = new Date(at);
    return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  }
  function elapsed(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${pad(whole % 60)}`;
  }
  function mb(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0.0';
    return Math.max(0.1, Math.round(value / 1048576 * 10) / 10).toFixed(1);
  }
  function count(value) {
    return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
  }
  function reasonText(reason) {
    // 지금 쓰는 오류 문구에서 첫 문장만 쓰고, 40자를 넘으면 39자에 줄임표를 붙인다.
    const text = String(reason ?? '').trim();
    if (!text) return '알 수 없는 오류';
    let end = text.length;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '.' && (i + 1 === text.length || /\s/.test(text[i + 1]))) { end = i; break; }
    }
    const sentence = text.slice(0, end).trim() || text;
    return sentence.length > 40 ? `${sentence.slice(0, 39)}…` : sentence;
  }
  const range = event => `${event.part}/${event.total}`;

  function lineText(event) {
    switch (event.type) {
      case 'saveAudio': return `음성 저장함 · ${range(event)}개`;
      case 'splitImport': return `녹음 파일 나눔 · ${event.total}개`;
      case 'reuseTranscript': return `받아 둔 전사 씀 · 조각 ${range(event)}`;
      case 'reuseMinutes': return `받아 둔 회의록 씀 · 구간 ${range(event)}`;
      case 'sendTranscript': return `전사 요청 보냄 · 조각 ${range(event)} · ${mb(event.bytes)}MB`;
      case 'recvTranscript': return `전사 받음 · 조각 ${range(event)} · ${count(event.chars)}자`;
      case 'sendSummary': return `회의록 정리 요청 보냄 · 구간 ${range(event)}`;
      case 'recvSummary': return `회의록 정리 받음 · 구간 ${range(event)}`;
      case 'splitLimit': return `길이 한도에 닿아 나눠 다시 보냄 · 구간 ${event.part}`;
      case 'sendCompact': return '회의록 줄이기 요청 보냄';
      case 'recvCompact': return '회의록 줄이기 받음';
      case 'compactUnused': return '줄이기 결과를 못 써 원래 길이로 저장';
      case 'sendRefine': return `의견 반영 요청 보냄 · 구간 ${range(event)}`;
      case 'recvRefine': return `의견 반영 받음 · 구간 ${range(event)}`;
      case 'timeout': return '응답 없음 · 5분 기다린 뒤 멈춤';
      case 'uploadStall': return '음성 올리기 멈춤 · 1분 넘게 못 보냄';
      case 'requestStall': return '요청 보내기 멈춤 · 1분 넘게 못 보냄';
      case 'disconnected': return '실패 · 연결 끊김';
      case 'apiError': return `실패 · OpenAI 오류 ${event.status}`;
      case 'badFormat': return '실패 · 응답 형식 오류';
      case 'saveFailed': return '실패 · 저장하지 못함';
      case 'failed': return `실패 · ${reasonText(event.reason)}`;
      case 'canceled': return '분석 취소함';
      case 'savedTranscript': return '전사 저장함';
      case 'savedMinutes': return '회의록 저장함';
      default: return String(event.type);
      // 모르는 종류로 화면이 멈추지 않게 종류 이름을 그대로 쓴다. 문구 표에 없는 종류는 시험에서 걸러진다.
    }
  }
  function requestLabel(event) {
    switch (event.type) {
      case 'sendTranscript': return `전사 · 조각 ${range(event)}`;
      case 'sendSummary': return `회의록 정리 · 구간 ${range(event)}`;
      case 'sendCompact': return '회의록 줄이기';
      case 'sendRefine': return `의견 반영 · 구간 ${range(event)}`;
      default: return lineText(event);
    }
  }

  function newId(at) {
    const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : '';
    return uuid || `${at}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function create(kind, at = Date.now()) {
    return { id: newId(at), kind, entries: [], open: null, seq: 0, startedAt: at };
  }
  function add(log, event, at = Date.now()) {
    const entry = { seq: ++log.seq, at, type: event.type, text: lineText(event) };
    log.entries.push(entry);
    if (log.entries.length > MAX_ENTRIES) log.entries.splice(0, log.entries.length - MAX_ENTRIES);
    return entry;
  }
  function openRequest(log, sendEvent, at = Date.now(), { size = null } = {}) {
    add(log, sendEvent, at);
    const upload = size != null;
    log.open = { label: requestLabel(sendEvent), since: at, phase: upload ? 'upload' : 'wait', sent: 0, size, waitSince: upload ? null : at };
    return log.open;
  }
  function progress(log, sent) { if (log.open) log.open.sent = sent; }
  function uploaded(log, at = Date.now()) {
    if (!log.open) return;
    log.open.phase = 'wait';
    log.open.waitSince = at;
  }
  function closeRequest(log) { log.open = null; }
  function lastEntry(log) { return log && log.entries.length ? log.entries[log.entries.length - 1] : null; }
  function lastIsFailure(log) {
    const last = lastEntry(log);
    return Boolean(last && FAILURE_TYPES.includes(last.type));
  }
  function lastEventAt(log) {
    const last = lastEntry(log);
    return last ? last.at : null;
  }

  function waitingText(open, now, limitOwner) {
    if (open.phase === 'upload') return `음성 올리는 중 · ${mb(open.sent)}/${mb(open.size)}MB`;
    const base = open.waitSince != null ? open.waitSince : open.since;
    const seconds = Math.max(0, Math.floor((now - base) / 1000));
    if (seconds <= LIMIT_SECONDS) return `응답 기다리는 중 · ${elapsed(seconds)} / 최대 5:00`;
    if (limitOwner === 'server') return `응답 기다리는 중 · ${elapsed(seconds)} · 제한 시간이 지나면 서버가 실패로 알려 줌`;
    return `응답 기다리는 중 · ${elapsed(seconds)}`;
  }

  function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function row(doc, time, text, className) {
    const item = element(doc, 'li', className);
    const textNode = element(doc, 'span', 'activity-text', text);
    item.append(element(doc, 'span', 'activity-time', time), textNode);
    return { item, textNode };
  }
  function render(container, log, now, options = {}) {
    const doc = options.document || globalThis.document;
    const maxRows = options.maxRows == null ? Infinity : options.maxRows;
    const last = lastEntry(log);
    if (!log || (!last && !log.open)) {
      if (container.activityKey !== '') container.replaceChildren();
      container.hidden = true;
      container.activityKey = '';
      container.activityWait = null;
      return;
    }
    const key = [log.id, last ? last.seq : 0, log.open ? log.open.label : '', log.open ? log.open.phase : '', maxRows].join('|');
    if (container.activityKey === key) {
      tick(container, log, now, options);
      return;
    }
    // 같은 그림이면 노드를 그대로 두고 기다림 글만 고친다. 사용자가 보던 스크롤과 초점을 흔들지 않기 위해서다.
    const head = element(doc, 'div', 'activity-head');
    head.append(element(doc, 'span', 'activity-title', 'AI 요청 기록'));
    if (last) head.append(element(doc, 'span', 'activity-last', `마지막 기록 ${clock(last.at)}`));
    const list = element(doc, 'ol', 'activity-list');
    list.setAttribute('aria-label', 'AI 요청 기록');
    const shown = Math.max(0, log.open ? maxRows - 1 : maxRows);
    for (const entry of shown === 0 ? [] : log.entries.slice(-shown)) list.append(row(doc, clock(entry.at), entry.text).item);
    container.activityWait = null;
    const parts = [head, list];
    if (log.open) {
      const wait = row(doc, '지금', waitingText(log.open, now, options.limitOwner), 'activity-wait');
      list.append(wait.item);
      container.activityWait = wait.textNode;
      parts.push(element(doc, 'p', 'activity-hint', HINT));
    }
    container.replaceChildren(...parts);
    container.hidden = false;
    container.activityKey = key;
  }
  function tick(container, log, now, options = {}) {
    if (!container.activityWait || !log || !log.open) return;
    container.activityWait.textContent = waitingText(log.open, now, options.limitOwner);
  }

  return { MAX_ENTRIES, LIMIT_SECONDS, HINT, FAILURE_TYPES, clock, elapsed, mb, count, lineText, requestLabel, create, add, openRequest, progress, uploaded, closeRequest, lastIsFailure, lastEventAt, waitingText, render, tick };
});
