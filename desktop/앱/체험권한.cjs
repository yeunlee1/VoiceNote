// 공용 기본 키의 설치별 3회 체험 횟수와 해제 상태를 관리한다. 키 값은 받지 않고 사용 여부만 판단한다.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const TRIAL_LIMIT = 3;
const EXHAUSTED_MESSAGE = "새로운 API키를 등록하세요.";
const UNLOCK_SHA256 = "";
// 공개 소스에는 해제 코드를 두지 않는다. 빈 값이면 어떤 입력도 해제 코드로 보지 않는다.
const MAX_FINISHED = 50;
const MAX_STATE_BYTES = 64 * 1024;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUnlockCode(text) {
  if (typeof text !== "string" || text.length > 500) return false;
  return crypto.createHash("sha256").update(text.trim()).digest("hex") === UNLOCK_SHA256;
}

function analysisKey(id) {
  return typeof id === "string" && ID_PATTERN.test(id) ? id.toLowerCase() : null;
}

function createTrialAccess({ stateFile, limit = TRIAL_LIMIT, leaseMs = 3 * 60 * 60 * 1000, now = Date.now } = {}) {
  // 확정 횟수·해제·완료 ID만 파일에 두고, 진행 중 예약은 메모리에만 둬 재시작하면 회수된다.
  let state = { used: 0, unlocked: false, finished: [] };
  let trialError = "";
  const reservations = new Map();
  if (stateFile) {
    try {
      const info = fs.lstatSync(stateFile);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) throw new Error("invalid_trial_file");
      const stored = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (!stored || stored.version !== 1 || !Number.isSafeInteger(stored.used) || stored.used < 0 || typeof stored.unlocked !== "boolean" || !Array.isArray(stored.finished) || !stored.finished.every((id) => analysisKey(id) === id))
        throw new Error("invalid_trial_file");
      state = { used: stored.used, unlocked: stored.unlocked, finished: stored.finished.slice(-MAX_FINISHED) };
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
        // 손상된 기록을 0회로 되돌리지 않고 소진 상태로 본다. 개인 키나 해제는 계속 사용할 수 있다.
        state = { used: limit, unlocked: false, finished: [] };
        trialError = "체험 기록을 읽지 못해 기본 키 체험을 멈췄습니다. 개인 API 키를 등록해 주세요.";
      }
    }
  }

  function save(next) {
    if (!stateFile) return;
    const temporary = `${stateFile}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ...next }), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, stateFile);
    } catch {
      throw Object.assign(new Error("체험 기록을 저장하지 못했습니다. 폴더의 쓰기 권한을 확인해 주세요."), { code: "TRIAL_STORAGE_FAILED", status: 500 });
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
      }
    }
  }

  function prune() {
    const time = now();
    for (const [id, item] of reservations) if (time - item.at > leaseMs) reservations.delete(id);
  }

  function status({ personalKeyConfigured = false, defaultKeyAvailable = false } = {}) {
    prune();
    let accessMode;
    if (personalKeyConfigured) accessMode = "personal";
    else if (!defaultKeyAvailable) accessMode = "none";
    else if (state.unlocked) accessMode = "unlimited";
    else if (state.used < limit) accessMode = "trial";
    else accessMode = "exhausted";
    return {
      accessMode,
      trialLimit: limit,
      trialUsed: state.used,
      trialRemaining: Math.max(0, limit - state.used),
      trialReserved: reservations.size,
      mustRegister: accessMode === "exhausted" || accessMode === "none",
      unlocked: state.unlocked,
      trialError,
    };
  }

  function begin({ analysisId, personalKeyConfigured = false, defaultKeyAvailable = false } = {}) {
    // 실제 API 호출 직전에 부른다. 같은 분석 ID의 전사·분할·자동 재시도는 하나의 예약을 공유한다.
    const current = status({ personalKeyConfigured, defaultKeyAvailable });
    if (current.accessMode === "personal") return { allowed: true, useKey: "personal", mode: "personal", reserved: false };
    if (current.accessMode === "none") return { allowed: false, code: "AI_KEY_MISSING", status: 400, message: "API 키를 설정해 주세요.", mustRegister: true };
    const id = analysisKey(analysisId);
    if (!id) return { allowed: false, code: "INVALID_ANALYSIS", status: 400, message: "분석 식별자를 확인해 주세요.", mustRegister: false };
    if (current.accessMode === "unlimited") return { allowed: true, useKey: "default", mode: "unlimited", reserved: false };
    if (state.finished.includes(id))
      return { allowed: false, code: "TRIAL_ID_FINISHED", status: 409, message: "이미 끝난 분석입니다. 다시 분석하려면 새로 시작해 주세요.", mustRegister: false };
    if (reservations.has(id)) {
      reservations.get(id).at = now();
      return { allowed: true, useKey: "default", mode: "trial", reserved: true };
    }
    if (state.used >= limit) return { allowed: false, code: "TRIAL_EXHAUSTED", status: 403, message: EXHAUSTED_MESSAGE, mustRegister: true };
    if (state.used + reservations.size >= limit)
      return { allowed: false, code: "TRIAL_IN_USE", status: 409, message: "남은 체험 횟수를 진행 중인 다른 분석이 사용하고 있습니다. 끝난 뒤 다시 시도해 주세요.", mustRegister: false };
    reservations.set(id, { at: now(), succeeded: false });
    return { allowed: true, useKey: "default", mode: "trial", reserved: true };
  }

  function markSucceeded(analysisId) {
    // 기본 키로 보낸 실제 API 요청이 성공 응답을 받았을 때 서버가 부른다. 이 표시가 없는 예약은 확정하지 않는다.
    const id = analysisKey(analysisId);
    prune();
    const item = id && reservations.get(id);
    if (!item) return { marked: false };
    item.succeeded = true;
    item.at = now();
    return { marked: true };
  }

  function finish(analysisId) {
    // 최종 회의록을 받은 분석만 1회로 확정한다. 같은 ID를 다시 확정해도 한 번만 센다.
    const id = analysisKey(analysisId);
    if (!id) return { counted: false, alreadyFinished: false };
    if (state.finished.includes(id)) return { counted: false, alreadyFinished: true };
    prune();
    const item = reservations.get(id);
    if (!item) return { counted: false, alreadyFinished: false };
    if (!item.succeeded) {
      reservations.delete(id);
      return { counted: false, alreadyFinished: false };
    }
    // 저장이 성공한 뒤에만 확정한다. 실패하면 예약을 남겨 다시 finish할 수 있고 그동안 남은 횟수도 막는다.
    const next = { ...state, used: state.used + 1, finished: [...state.finished, id].slice(-MAX_FINISHED) };
    save(next);
    state = next;
    reservations.delete(id);
    return { counted: true, alreadyFinished: false };
  }

  function release(analysisId) {
    const id = analysisKey(analysisId);
    return { released: Boolean(id) && reservations.delete(id) };
  }

  function unlock() {
    if (state.unlocked) return { unlocked: true };
    const next = { ...state, unlocked: true };
    save(next);
    state = next;
    trialError = "";
    return { unlocked: true };
  }

  return { status, begin, markSucceeded, finish, release, unlock, isUnlockCode };
}

module.exports = { createTrialAccess, isUnlockCode, TRIAL_LIMIT, EXHAUSTED_MESSAGE };
