// 회의 녹음과 전사 및 회의록의 브라우저 내 상태를 관리한다.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  // 사본을 쓸 폴더 종류. 설정의 storage 칸과 화면의 storage-·pick-·clear- 이름에 같이 쓴다.
  const STORAGE_KINDS = ["audio", "transcript", "summary"];
  const ui = Object.fromEntries(
    [
      "title",
      "prepare",
      "workflow-status", "meeting-setup", "retry-analysis", "archive-status", "save-archive",
      "history-status", "meeting-history",
      "date",
      "participants",
      "record-state",
      "microphone-volume",
      "microphone-status",
      "timer",
      "level-meter",
      "level-fill",
      "audio-size",
      "start",
      "cancel-permission",
      "stop",
      "audio-parts",
      "audio-file",
      "transcript",
      "transcript-count",
      "transcribe",
      "summarize",
      "cancel-ai",
      "stale-notice",
      "minutes",
      "download-md",
      "download-txt",
      "download-json",
      "api-key",
      "persist-key",
      "save-key",
      "remove-key",
      "key-state",
      "clear",
      "shutdown",
      "status",
      "meeting-notes", "start-hint", "stage", "open-settings", "ai-status-label",
      "summary-model", "model-help", "settings-lock", "meeting-detail", "settings", "detail-title",
      "detail-meta", "usage", "open-result", "open-result-label", "setup-close", "meeting-heading", "key-form",
      "output-format", "custom-missing", "open-format-settings",
      "format-help", "format-example", "format-example-title", "format-example-text", "format-example-body", "custom-name",
      "custom-sections", "custom-section-list", "custom-instruction", "custom-save", "custom-delete", "custom-status", "custom-preview",
      "settings-ai", "settings-format", "settings-storage", "settings-file", "settings-data", "default-format", "storage-status",
      ...STORAGE_KINDS.flatMap((kind) => [`storage-${kind}`, `pick-${kind}`, `clear-${kind}`]),
      "export-settings", "import-settings", "settings-file-input", "settings-file-status", "settings-import", "settings-preview", "confirm-import", "open-data-folder",
      "review", "review-comment", "save-review", "refine", "refine-cost", "review-status", "result-versions", "result-version-field", "refined-badge",
      "copy-block", "copy-status", "copy-again", ...[1, 2, 3, 4, 5].map((stars) => `review-star-${stars}`),
      "tab-mine", "tab-minutes", "tab-transcript", "panel-mine", "panel-minutes", "panel-transcript",
      "share-open", "share-dialog", "share-list", "share-unassigned", "share-status", "share-preview-title", "share-preview", "transcript-view", "transcript-meta", "copy-result", "share-result", "save-result", "result-status",
      "update-chip", "update-chip-label", "open-about", "about", "about-version", "about-version-meta", "about-update", "update-state", "update-progress-row", "update-progress",
      "update-progress-text", "update-detail", "update-lock", "update-install", "update-check", "update-page", "update-note", "release-list",
      "desk-work", "recording-info", "people-preview", "history-search",
    ].map((id) => [id, $(id)]),
  );
  const Formats = window.MeetingFormats;
  const Todos = window.MeetingTodos;
  const TODO_NOTICES = { editing: "고치던 할 일을 저장하거나 취소해 주세요.", saving: "할 일을 저장하는 중입니다. 잠시 뒤 다시 눌러 주세요." };
  const formatLabels = Formats.LABELS;
  const outputFormat = (value) => (Object.hasOwn(formatLabels, value) ? value : "meeting");
  const state = {
    token: "",
    setupOpen: false, historyBusy: false, flowBusy: false, archiveBusy: false,
    // 사람이 고친 할 일 수정본이다. 없으면 AI 결과를 그대로 쓴다. todoEditing은 문장·기한을 고치는 중인 줄이다.
    // todoConfirmed는 파일에 저장된 것이 확인된 수정본, todoSerial은 가장 늦게 누른 저장의 번호, todoSource는 의견 반영의 출발 결과다.
    todos: null, todoConfirmed: null, todoEditing: null, todoQueue: Promise.resolve(), todoPending: 0, todoSerial: 0, todoSource: null,
    // me는 이 회의에 저장된 나의 선택(없으면 null), mePicking은 나 고르기 상자를 펼쳤는지, meBusy는 나를 저장하는 중인지다.
    me: null, mePicking: false, meBusy: false,
    // 사람별 할 일 복사 창에서 이번에 복사한 사람과 미리보기로 가리키는 사람이다. 창을 열 때마다 비운다.
    shareCopied: new Set(), shareCurrent: null,
    // 열린 회의가 든 보관함(main, p1~p3)과 그 녹음 id다. 새 녹음은 언제나 main에 만든다.
    // 녹음이 서버에 있을 때만 recordingStored가 참이고, 녹음 없이 전사로 만든 회의는 meetingId(처음 결과 id)로 다음 결과를 잇는다.
    location: "main", projectName: "", recordingId: null, recordingStored: false, meetingId: null, resultId: null, recordingMetadata: null, audioStored: false, resultStored: false,
    keyConfigured: false,
    keySaved: false,
    keyStorageError: "",
    keyBusy: false,
    settingsBusy: false,
    settings: null,
    models: [],
    summaryModel: "",
    usage: [],
    callIds: [],
    analysisModel: "",
    modelError: "",
    hintKey: "",
    microphoneBusy: false,
    maxAudioBytes: 23_068_672,
    maxMinutes: 59,
    permissionPending: false,
    permissionGeneration: 0,
    recorder: null,
    stream: null,
    recorders: new Set(),
    parts: [],
    recordingStopping: false,
    dataGeneration: 0,
    recordingStartedAt: 0,
    recordingTimer: null,
    meterContext: null,
    meterTimer: null,
    summarySteps: [],
    dailySequence: null,
    minutes: null,
    summarySource: "",
    notesSaved: true,
    aiController: null,
    minutesFormat: null,
    // customFormat은 저장된 내 형식, meetingCustom은 다시 연 회의에 기록된 당시 내 형식이다.
    customFormat: null,
    meetingCustom: null,
    resultTab: "minutes",
    transcriptShown: null,
    access: { accessMode: "none", trialLimit: 3, trialRemaining: 0, mustRegister: true, unlocked: false, trialError: "" },
    analysisId: null,
    // 같은 녹음(회의)의 결과 목록과 지금 결과의 평가·반영한 의견·사본 저장 결과다. 평가는 결과마다 따로 저장한다.
    versions: [], feedback: "", review: null, reviewStars: null, reviewBusy: false, copies: null, copyBusy: false,
    // 앱 업데이트 상태(서버가 알려 준 그대로), 한 번 누름으로 받은 뒤 설치까지 이어 갈지, 설치 시작 잠금, 상태 조회 간격이다.
    update: null, updateIntent: false, updateLaunching: false, updateError: "", updatePoll: null, updatePollMs: 1000, updateNotified: false, updatePollFailures: 0, editorBaseline: null, customBusy: false,
  };

  function applyAccess(data) {
    if (typeof data?.accessMode !== "string") return;
    state.access = { accessMode: data.accessMode, trialLimit: Number(data.trialLimit) || 3, trialRemaining: Number(data.trialRemaining) || 0,
      mustRegister: Boolean(data.mustRegister), unlocked: Boolean(data.unlocked), trialError: String(data.trialError || "") };
  }

  // 개인 키가 있거나 설치 패키지의 기본 키를 체험·해제 상태로 쓸 수 있으면 분석할 수 있다.
  function canAnalyze() {
    return state.keyConfigured || ["trial", "unlimited"].includes(state.access.accessMode);
  }

  // 체험을 모두 쓴 뒤에도 분석 버튼은 눌리게 두고, 누르면 새 키 등록 안내와 설정 창을 연다.
  function needsNewKey() {
    return !state.keyConfigured && state.access.accessMode === "exhausted";
  }

  function promptNewKey() {
    announce("새로운 API키를 등록하세요.");
    openSettings("settings-ai");
  }

  function withTrialWarning(message) {
    return state.trialWarning ? `${message} ${state.trialWarning}` : message;
  }

  let toastTimer = null;
  function announce(message) {
    const host = document.querySelector?.("dialog[open]") || document.body;
    if (host && ui.status.parentNode !== host) host.append(ui.status);
    ui.status.textContent = message;
    ui.status.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.status.classList.remove("visible"), 6_000);
  }

  function readToken() {
    const fragment = location.hash.slice(1);
    if (fragment) {
      const token = fragment.startsWith("token=")
        ? new URLSearchParams(fragment).get("token")
        : decodeURIComponent(fragment);
      if (token) sessionStorage.setItem("meetingToken", token);
      history.replaceState(null, "", location.pathname + location.search);
    }
    return sessionStorage.getItem("meetingToken") || "";
  }

  function errorMessage(payload, response) {
    return payload?.error?.message || `요청을 처리하지 못했습니다. (${response.status})`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: "no-store",
      ...options,
      headers: { "X-Meeting-Token": state.token, ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(errorMessage(payload, response)), { code: payload?.error?.code, aiCall: payload?.error?.aiCall, mustRegister: Boolean(payload?.error?.mustRegister) });
    return payload;
  }

  const fallbackUsage = {
    normalize(ledger) {
      if (!Array.isArray(ledger)) return [];
      return ledger.filter((entry) => entry && typeof entry === "object").map((entry) => {
        const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
        const requests = count(entry.requests);
        const measuredOld = [entry.inputTokens, entry.outputTokens, entry.totalTokens].some((value) => Number.isSafeInteger(value));
        const measuredRequests = Number.isSafeInteger(entry.measuredRequests) ? entry.measuredRequests : measuredOld ? requests : 0;
        return {
          kind: entry.kind === "transcription" ? "transcription" : "summary", model: String(entry.model || "모델 미상"), requests, measuredRequests,
          unknownRequests: Number.isSafeInteger(entry.unknownRequests) ? entry.unknownRequests : requests - measuredRequests,
          inputTokens: count(entry.inputTokens), outputTokens: count(entry.outputTokens), totalTokens: count(entry.totalTokens),
          cachedInputTokens: count(entry.cachedInputTokens), reasoningTokens: count(entry.reasoningTokens),
          audioSeconds: Number.isFinite(entry.audioSeconds) && entry.audioSeconds > 0 ? entry.audioSeconds : 0,
        };
      });
    },
    add(ledger, call) {
      const list = this.normalize(ledger);
      if (!call || call.sent !== true) return list;
      const kind = call.kind === "transcription" ? "transcription" : "summary";
      const model = String(call.model || "모델 미상");
      let entry = list.find((item) => item.kind === kind && item.model === model);
      if (!entry) list.push(entry = this.normalize([{ kind, model, requests: 0, measuredRequests: 0, unknownRequests: 0 }])[0]);
      entry.requests++;
      const usage = call.usage;
      const numbers = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens"];
      if (usage && ["inputTokens", "outputTokens", "totalTokens"].some((key) => Number.isSafeInteger(usage[key]))) {
        entry.measuredRequests++;
        for (const key of numbers) if (Number.isSafeInteger(usage[key])) entry[key] += usage[key];
        if (!Number.isSafeInteger(usage.totalTokens) && Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens))
          entry.totalTokens += usage.inputTokens + usage.outputTokens;
      } else entry.unknownRequests++;
      if (Number.isFinite(call.audioSeconds) && call.audioSeconds > 0) entry.audioSeconds += call.audioSeconds;
      return list;
    },
    describe(entry) {
      const measured = entry.measuredRequests > 0;
      const number = (value) => (measured ? `${value.toLocaleString("ko-KR")}` : "미제공");
      return {
        model: entry.model, kindLabel: entry.kind === "transcription" ? "전사" : "요약",
        input: number(entry.inputTokens), output: number(entry.outputTokens), total: number(entry.totalTokens),
        detail: entry.audioSeconds ? `음성 ${Math.round(entry.audioSeconds).toLocaleString("ko-KR")}초` : "",
        unknownText: entry.unknownRequests > 0 ? `${entry.unknownRequests}건 사용량 미확인` : "",
      };
    },
  };

  function usageTools() {
    const shared = window.MeetingAiUsage;
    return shared && typeof shared.add === "function" && typeof shared.describe === "function" ? shared : fallbackUsage;
  }

  function recordCall(call) {
    if (!call) return;
    const tools = usageTools();
    if (typeof tools.record === "function") {
      const next = tools.record({ summaryModel: state.analysisModel || null, usage: state.usage, callIds: state.callIds }, call);
      state.usage = next.usage;
      state.callIds = next.callIds;
      if (next.summaryModel) state.analysisModel = next.summaryModel;
      return;
    }
    if (typeof call.callId === "string" && state.callIds.includes(call.callId)) return;
    state.usage = tools.add(state.usage, call);
    if (call.sent === true && typeof call.callId === "string") state.callIds = [...state.callIds, call.callId];
  }

  async function aiApi(kind, path, options) {
    try {
      const result = await api(path, options);
      recordCall(result?.aiCall || { kind, sent: true, model: result?.model || (kind === "summary" ? state.summaryModel || "서버 기본 모델" : "서버 기본 전사 모델"), usage: result?.usage ?? null, audioSeconds: result?.audioSeconds });
      if (kind === "summary" && result?.model) state.analysisModel = result.model;
      return result;
    } catch (error) {
      if (error.aiCall) recordCall(error.aiCall);
      throw error;
    }
  }

  function newOperationId() {
    return crypto.randomUUID();
  }

  function aiHeaders(contentType) {
    return {
      "Content-Type": contentType,
      "X-Operation-Id": newOperationId(),
      "X-AI-Consent": "yes",
      ...(state.analysisId ? { "X-Analysis-Id": state.analysisId } : {}),
    };
  }

  async function settleTrial(kind, analysisId) {
    if (!analysisId) return;
    // 확정 저장에 실패한 예약은 회수하지 않고 같은 식별자로 한 번 더 확정한다.
    if (kind === "finish") state.finishAttempted = analysisId;
    for (let attempt = 0; attempt < (kind === "finish" ? 2 : 1); attempt++) {
      try {
        applyAccess(await api(`/api/trial/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ analysisId }) }));
        return;
      } catch (error) {
        if (kind !== "finish" || error.code === "NOT_FOUND") return;
        if (attempt === 1 || error.code !== "TRIAL_STORAGE_FAILED") {
          state.trialWarning = `체험 횟수 기록을 저장하지 못했습니다. ${error.message}`;
          return;
        }
      }
    }
  }

  function updateSize() {
    const bytes = state.recorder?.part.chunkBytes || state.parts.at(-1)?.blob?.size || 0;
    ui["audio-size"].textContent =
      `${(bytes / 1_048_576).toFixed(1)} MB / ${(state.maxAudioBytes / 1_048_576).toFixed(0)} MB`;
  }

  function stale() {
    return Boolean(state.minutes && summaryInput() !== state.summarySource);
  }

  function summaryInput() {
    return JSON.stringify({
      text: ui.transcript.value,
      title: ui.title.value.trim(),
      date: ui.date.value,
      participants: ui.participants.value.trim(),
      notes: ui["meeting-notes"].value.trim(),
      ...formatFields(),
    });
  }

  function currentCustom() {
    return state.meetingCustom || state.customFormat;
  }

  function formatFields() {
    // 내 형식을 고르면 그 정의를 요청·녹음·저장에 함께 실어 서버가 같은 기준으로 처리하게 한다.
    const format = outputFormat(ui["output-format"].value);
    return format === "custom" && currentCustom() ? { outputFormat: format, customFormat: currentCustom() } : { outputFormat: format === "custom" ? "meeting" : format };
  }

  function defaultFormat() {
    // 새 회의는 설정의 기본 출력 형식으로 시작한다. 내 형식인데 저장된 형식이 없으면 회의록으로 시작한다.
    const format = outputFormat(state.settings?.defaultOutputFormat || "meeting");
    return format === "custom" && !state.customFormat ? "meeting" : format;
  }

  function updateCustomOption() {
    // 회의 준비와 설정 창의 출력 형식 선택지 모두 저장된 내 형식 이름을 보여 준다.
    const label = state.customFormat ? `내 형식 · ${state.customFormat.name}` : "내 형식 (아직 없음)";
    for (const id of ["output-format", "default-format"]) ui[id].querySelector('option[value="custom"]').textContent = label;
  }

  function renderFormatExample() {
    // 회의 준비의 예시는 보기만 한다. 고른 형식으로 가상의 회의를 정리한 모습을 같은 화면 그리기 함수로 보여 준다.
    const open = !ui["format-example"].hidden;
    ui["format-help"].setAttribute("aria-expanded", String(open));
    ui["format-help"].textContent = open ? "예시 닫기" : "예시 보기";
    if (!open) return;
    const format = outputFormat(ui["output-format"].value);
    const custom = format === "custom" ? currentCustom() : null;
    ui["format-example-title"].textContent = `${format === "custom" ? custom?.name || "내 형식" : formatLabels[format]} 예시`;
    ui["format-example-text"].textContent = `${Formats.DESCRIPTIONS[format]} 아래는 가상의 회의로 만든 예시입니다.`;
    ui["format-example-body"].replaceChildren();
    if (format === "custom" && !custom) ui["format-example-body"].append(element("p", "저장된 내 형식이 없습니다. 설정 › 출력 형식에서 먼저 만드세요.", "muted"));
    else renderMinutesInto(ui["format-example-body"], Formats.SAMPLE.minutes, format, custom);
  }

  function renderCustomPreview() {
    // 설정 창에서 편집 중인 내 형식으로 가상의 회의를 정리한 모습을 바로 보여 준다.
    const preview = editorValue(false);
    ui["custom-preview"].replaceChildren();
    if (!preview) ui["custom-preview"].append(element("p", "항목을 하나 이상 고르면 예시가 보입니다.", "muted"));
    else renderMinutesInto(ui["custom-preview"], Formats.SAMPLE.minutes, "custom", preview);
  }

  function loadEditor() {
    const base = state.customFormat || Formats.defaultCustom();
    const chosen = new Set(base.sections.map((section) => section.key));
    state.customRows = [...base.sections.map((section) => ({ ...section, on: true })),
      ...Formats.KEYS.filter((key) => !chosen.has(key)).map((key) => ({ key, title: Formats.KEY_LABELS[key], on: false }))];
    ui["custom-name"].value = state.customFormat?.name || "";
    ui["custom-instruction"].value = state.customFormat?.instruction || "";
    ui["custom-delete"].hidden = !state.customFormat;
    ui["custom-status"].textContent = state.customFormat ? "" : "아직 저장한 내 형식이 없습니다. 이름과 항목을 정하고 저장하세요.";
    renderEditorRows();
    renderCustomPreview();
    // 업데이트 전에 저장하지 않은 편집이 있는지 견줄 기준이다.
    state.editorBaseline = editorSnapshot();
  }

  function renderEditorRows() {
    ui["custom-section-list"].replaceChildren();
    state.customRows.forEach((row, index) => {
      const item = document.createElement("li");
      item.className = "custom-row";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = row.on;
      check.setAttribute("aria-label", `${Formats.KEY_LABELS[row.key]} 넣기`);
      check.addEventListener("change", () => { row.on = check.checked; renderCustomPreview(); });
      const title = document.createElement("input");
      title.value = row.title;
      title.maxLength = Formats.LIMITS.title;
      title.setAttribute("aria-label", `${Formats.KEY_LABELS[row.key]} 항목 이름`);
      title.addEventListener("input", () => { row.title = title.value; renderCustomPreview(); });
      const move = (label, delta, disabled) => {
        const button = element("button", label, "button button-quiet custom-move");
        button.type = "button";
        button.disabled = disabled;
        button.setAttribute("aria-label", `${Formats.KEY_LABELS[row.key]} ${label}`);
        button.addEventListener("click", () => {
          [state.customRows[index], state.customRows[index + delta]] = [state.customRows[index + delta], state.customRows[index]];
          renderEditorRows();
          renderCustomPreview();
        });
        return button;
      };
      item.append(check, element("span", Formats.KEY_LABELS[row.key], "custom-key"), title, move("위로", -1, index === 0), move("아래로", 1, index === state.customRows.length - 1));
      ui["custom-section-list"].append(item);
    });
  }

  function editorValue(strict) {
    // 미리보기는 비어 있는 이름을 기본 이름으로 채워 보여 주고, 저장할 때만 엄격하게 검사한다.
    const value = {
      name: ui["custom-name"].value.trim() || (strict ? "" : "내 형식"),
      sections: (state.customRows || []).filter((row) => row.on).map((row) => ({ key: row.key, title: row.title.trim() || (strict ? "" : Formats.KEY_LABELS[row.key]) })),
      instruction: ui["custom-instruction"].value,
    };
    if (strict) return Formats.validateCustom(value);
    try { return Formats.validateCustom(value); } catch { return null; }
  }

  async function saveCustom() {
    // 앞선 저장·삭제가 끝나기 전에는 새로 보내지 않는다. 겹치면 먼저 끝난 쪽이 저장 중 표시를 풀어 버린다.
    if (state.customBusy) return;
    const value = editorValue(true);
    // 저장이 끝나기 전에 업데이트로 창이 닫히지 않도록 저장 중임을 표시한다.
    state.customBusy = true;
    let result;
    try { result = await api("/api/custom-format", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); }
    finally { state.customBusy = false; }
    state.customFormat = result.customFormat;
    updateCustomOption();
    loadEditor();
    ui["custom-status"].textContent = `‘${state.customFormat.name}’ 형식을 저장했습니다. 다음 분석부터 이 형식으로 정리합니다.`;
    renderFormatExample();
    refresh();
  }

  async function deleteCustom() {
    if (state.customBusy || !state.customFormat || !confirm(`‘${state.customFormat.name}’ 형식을 삭제할까요? 이미 저장된 회의는 그대로입니다.`)) return;
    state.customBusy = true;
    try { await api("/api/custom-format", { method: "DELETE" }); }
    finally { state.customBusy = false; }
    state.customFormat = null;
    updateCustomOption();
    if (ui["output-format"].value === "custom" && !state.meetingCustom) { ui["output-format"].value = defaultFormat(); }
    loadEditor();
    ui["custom-status"].textContent = "내 형식을 삭제했습니다.";
    renderFormatExample();
    refresh();
  }

  function hasMeetingRecord() {
    return Boolean(state.minutes || state.audioStored || state.parts.length || ui.transcript.value.trim());
  }

  function startBlockers() {
    const blockers = [];
    if (hasMeetingRecord()) blockers.push("지난 회의 기록이 열려 있습니다. ‘회의 준비’를 눌러 새 회의를 준비하세요.");
    if (!canAnalyze()) blockers.push(state.access.accessMode === "exhausted" ? "새로운 API키를 등록하세요. 아래 ‘설정’에서 등록합니다." : "아래 ‘설정’에서 API 키를 등록하세요.");
    if (state.modelError) blockers.push(`아래 ‘설정’에서 요약 모델을 다시 선택하세요. ${state.modelError}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ui.date.value)) blockers.push("‘회의 준비’에서 회의 날짜를 확인하세요.");
    if (ui["meeting-notes"].value.length > 4000) blockers.push("‘회의 준비’의 상세 회의내용을 4,000자 이하로 줄이세요.");
    if (customMissing()) blockers.push("설정 › 출력 형식에서 내 형식을 먼저 만드세요.");
    return blockers;
  }

  function customMissing() {
    return outputFormat(ui["output-format"].value) === "custom" && !currentCustom();
  }

  function settingsLocked() {
    return Boolean(state.recorders.size || state.permissionPending || state.aiController || state.flowBusy || state.archiveBusy);
  }

  function modelInfo(id = state.summaryModel) {
    return state.models.find((model) => model.id === id) || null;
  }

  function renderStartHint(recording, locked) {
    const blockers = startBlockers();
    const key = recording ? "recording" : state.permissionPending ? "permission" : locked ? "busy" : blockers.join("|") || "ready";
    if (key === state.hintKey) return;
    state.hintKey = key;
    ui["start-hint"].replaceChildren();
    ui["start-hint"].dataset.state = key === "ready" ? "ready" : blockers.length && !locked && !recording ? "blocked" : "info";
    if (recording) return;
    if (state.permissionPending) ui["start-hint"].append(element("p", "마이크 사용 허가를 기다리고 있습니다."));
    else if (locked) ui["start-hint"].append(element("p", "진행 중인 작업이 끝나면 시작할 수 있습니다."));
    else if (blockers.length) {
      ui["start-hint"].append(element("p", "회의를 시작하려면", "hint-lead"));
      const list = document.createElement("ul");
      blockers.forEach((item) => list.append(element("li", item)));
      ui["start-hint"].append(list);
    } else ui["start-hint"].append(element("p", "준비 완료. ‘회의 시작’을 누르면 바로 녹음합니다."));
  }

  function renderStage(recording) {
    const order = ["prepare", "record", "analyze", "done"];
    const current = recording || state.permissionPending ? "record"
      : state.flowBusy || state.aiController || state.archiveBusy ? "analyze"
        : state.minutes ? "done"
          : state.parts.length || state.audioStored || ui.transcript.value.trim() ? "analyze" : "prepare";
    const index = order.indexOf(current);
    for (const item of ui.stage.querySelectorAll("li")) {
      const position = order.indexOf(item.dataset.stage);
      item.dataset.state = position < index || (current === "done" && position === index) ? "done" : position === index ? "current" : "todo";
      if (position === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
    ui.stage.dataset.current = current;
  }

  function renderPeople(target, names) {
    target.replaceChildren(...names.map((name, index) => {
      const row = document.createElement("li");
      row.append(element("b", index + 1), element("span", name));
      return row;
    }));
  }

  function refresh() {
    // 받는 동안 녹음·분석·저장이 시작되면 '지금 업데이트'의 자동 설치 예약을 취소한다. 받은 뒤에는 사람이 다시 눌러야 설치한다.
    if (state.updateIntent && (state.recorders.size || state.permissionPending || state.recorder || state.aiController || state.flowBusy || state.archiveBusy)) state.updateIntent = false;
    renderResultActions();
    const recording = Boolean(state.recorder && !state.recordingStopping);
    // 업데이트 설치를 시작하면 창이 곧 닫히므로 녹음·불러오기·분석·지난 회의 열기를 함께 막는다.
    const busy = Boolean(state.aiController) || state.keyBusy || state.historyBusy || state.archiveBusy || state.updateLaunching;
    const locked = busy || state.flowBusy || state.permissionPending || state.recorders.size > 0;
    ui.prepare.disabled = locked;
    ui.prepare.setAttribute("aria-expanded", String(state.setupOpen));
    ui["meeting-setup"].hidden = !state.setupOpen;
    ui["save-archive"].disabled = locked || !state.minutes || stale() || state.resultStored;
    ui["save-archive"].hidden = !state.minutes || state.resultStored;
    ui["retry-analysis"].disabled = locked;
    ui.clear.disabled = locked;
    ui.shutdown.disabled = state.flowBusy || state.archiveBusy || state.historyBusy;
    for (const id of ["title", "date", "output-format", "participants", "meeting-notes", "transcript", "audio-file"])
      ui[id].disabled = Boolean(locked);
    for (const button of ui["meeting-history"].querySelectorAll("button")) {
      button.disabled = Boolean(locked);
      // 지금 가운데에 열린 회의를 목록에서 강조한다. 결과 버전을 바꿔도 같은 녹음이면 그대로 둔다.
      const current = ui["meeting-detail"].open && (button.dataset.meeting === state.resultId || (state.recordingId && button.dataset.recording === state.recordingId));
      if (current) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    const allowedAI = (canAnalyze() || needsNewKey()) && !busy;
    const canSendAudio = state.parts.some(
      (part) =>
        part.blob && part.blob.size <= state.maxAudioBytes && !part.applied,
    );
    ui.start.disabled =
      startBlockers().length > 0 || state.permissionPending || state.recorders.size > 0 || busy || state.microphoneBusy || state.flowBusy;
    renderStartHint(recording, locked && !recording);
    renderStage(recording);
    if (document.body) document.body.dataset.recording = String(recording);
    renderPeople(ui["people-preview"], Todos.people(ui.participants.value));
    // 녹음 중에는 준비 입력이 접히므로 회의 전에 적은 참석자와 내용을 읽기로 보여 준다.
    const recordingInfo = [ui.participants.value.trim() && `참석자 ${ui.participants.value.trim()}`, ui["meeting-notes"].value.trim()].filter(Boolean).join("\n");
    ui["recording-info"].textContent = recordingInfo;
    ui["recording-info"].hidden = !recording || !recordingInfo;
    ui["workflow-status"].hidden = Boolean(state.workflowGuide) && ui.stage.dataset.current === "prepare";
    ui["microphone-volume"].disabled = state.microphoneBusy || state.permissionPending || state.recorders.size > 0;
    ui["cancel-permission"].hidden = !state.permissionPending;
    ui.stop.disabled = !recording;
    ui.stop.hidden = !recording;
    ui.start.hidden = recording;
    ui.transcribe.disabled = !allowedAI || !canSendAudio || locked || !state.audioStored;
    ui.summarize.disabled =
      !allowedAI || locked || (state.parts.length > 0 && !state.audioStored) || (!ui.transcript.value.trim() && !canSendAudio);
    ui["cancel-ai"].hidden = !state.aiController;
    ui["stale-notice"].hidden = !stale();
    for (const id of ["download-md", "download-txt", "download-json"]) {
      ui[id].disabled = !state.minutes || stale();
    }
    ui["open-result"].hidden = recording || state.recorders.size > 0 || state.flowBusy || Boolean(state.aiController) || !hasMeetingRecord();
    ui["open-result-label"].textContent = state.minutes ? "회의록 보기" : "기록 열기 · 전사 확인";
    const title = ui.title.value.trim();
    ui["meeting-heading"].textContent = title || "새 회의";
    ui["detail-title"].textContent = title || "회의 기록";
    ui["detail-meta"].textContent = [state.projectName && `이전 프로젝트: ${state.projectName}`, ui.date.value, state.dailySequence && `${state.dailySequence}차 회의`]
      .filter(Boolean).join(" · ");
    const lockedSettings = settingsLocked();
    for (const id of ["api-key", "persist-key", "save-key", "remove-key"]) ui[id].disabled = lockedSettings || state.keyBusy;
    ui["remove-key"].disabled ||= !state.keyConfigured;
    ui["summary-model"].disabled = lockedSettings || state.settingsBusy || !state.models.length;
    ui["settings-lock"].hidden = !lockedSettings;
    // 설정 창의 출력 형식·저장 위치·설정 파일도 녹음·분석·저장 중이거나 설정을 저장하는 동안 잠근다.
    const settingsBusy = lockedSettings || state.settingsBusy;
    for (const id of ["default-format", "custom-name", "custom-sections", "custom-instruction", "custom-save", "custom-delete", "export-settings", "import-settings", "settings-file-input", "confirm-import"])
      ui[id].disabled = settingsBusy;
    for (const kind of STORAGE_KINDS) {
      ui[`pick-${kind}`].disabled = settingsBusy;
      ui[`clear-${kind}`].disabled = settingsBusy || !state.settings?.storage?.[kind];
    }
    ui["custom-missing"].hidden = !customMissing();
    // 평가·다시 정리·사본 다시 저장은 저장된 결과에만 쓰고, 녹음·분석·저장 중에는 잠근다.
    const reviewable = Boolean(state.minutes && state.resultStored && state.resultId);
    const reviewLocked = locked || state.reviewBusy || !reviewable;
    const comment = ui["review-comment"].value.trim();
    ui.review.hidden = !reviewable;
    for (let stars = 1; stars <= 5; stars++) {
      const star = ui[`review-star-${stars}`];
      star.setAttribute("aria-pressed", String(state.reviewStars === stars));
      star.dataset.on = String(state.reviewStars !== null && stars <= state.reviewStars);
      star.disabled = reviewLocked;
    }
    ui["review-comment"].disabled = reviewLocked;
    ui["save-review"].disabled = reviewLocked || (state.reviewStars === null && !comment);
    ui.refine.disabled = reviewLocked || !comment || stale();
    ui["refine-cost"].hidden = !comment;
    ui["copy-block"].hidden = !reviewable;
    ui["copy-again"].disabled = locked || state.copyBusy || !reviewable;
    // 평가·의견 반영·사본 저장이 끝나기 전에는 다른 결과로 바꾸지 않는다. 진행 중인 작업이 시작한 결과를 계속 가리키게 한다.
    ui["result-versions"].disabled = locked || state.reviewBusy || state.copyBusy;
    renderCopies();
    const { accessMode, trialRemaining, trialLimit } = state.access;
    ui["key-state"].textContent =
      state.keyStorageError ||
      (state.keyConfigured
        ? state.keySaved
          ? "API 키 등록됨 · 이 PC에 저장됨"
          : "API 키 등록됨 · 이번 실행에만 사용"
        : state.access.trialError
          || (accessMode === "trial" ? `기본 키 체험 중 · 남은 분석 ${trialRemaining}/${trialLimit}회. 개인 API 키를 등록하면 횟수 제한 없이 사용합니다.`
            : accessMode === "unlimited" ? "기본 키 사용 중 · 횟수 제한 해제됨"
              : accessMode === "exhausted" ? "새로운 API키를 등록하세요."
                : "등록된 API 키가 없습니다. 회의 시작 전에 키를 등록하세요."));
    const model = modelInfo();
    ui["ai-status-label"].textContent = !canAnalyze() ? "키 필요" : state.modelError ? "모델 선택 필요"
      : !state.keyConfigured && accessMode === "trial" ? `체험 ${trialRemaining}/${trialLimit}` : model?.label || "연결됨";
    ui["open-settings"].dataset.state = canAnalyze() && !state.modelError ? "ready" : "missing";
    ui["model-help"].textContent = state.modelError ? state.modelError : !state.models.length
      ? "이 서버는 모델 목록을 제공하지 않아 서버 기본 모델로 요약합니다."
      : model
        ? `${model.description ? `${model.description} ` : ""}바꾼 모델은 다음 분석부터 적용됩니다.`
        : "모델을 선택하세요.";
    ui["transcript-count"].textContent =
      `${Array.from(ui.transcript.value).length.toLocaleString("ko-KR")}자`;
    updateSize();
    // 녹음·저장 상태가 바뀌면 업데이트 칸의 설치 가능 여부와 이유도 함께 바뀐다.
    renderUpdate();
  }

  function stopTracks(stream) {
    stream?.getTracks().forEach((track) => track.stop());
  }

  function stopMeter() {
    clearInterval(state.meterTimer);
    state.meterTimer = null;
    state.meterContext?.close().catch(() => {});
    state.meterContext = null;
    ui["level-fill"].style.width = "0%";
    ui["level-meter"].setAttribute("aria-valuenow", "0");
  }

  function stopTimer() {
    clearInterval(state.recordingTimer);
    state.recordingTimer = null;
    stopMeter();
  }

  function renderParts() {
    ui["audio-parts"].replaceChildren();
    state.parts.forEach((part, index) => {
      const row = document.createElement("li");
      const name = element(
        "span",
        `파일 ${String(index + 1).padStart(3, "0")} · ${part.blob ? `${(part.blob.size / 1_048_576).toFixed(1)} MB` : "녹음 중"} · ${part.transcript ? (part.applied ? "전사 완료" : "전사 반영 대기") : "전사 대기"}`,
      );
      row.append(name);
      if (part.blob) {
        const player = document.createElement("audio");
        player.controls = true;
        player.preload = "none";
        player.src = part.url;
        player.setAttribute("aria-label", `파일 ${index + 1} 재생`);
        const button = element(
          "button",
          part.saved ? "다시 저장" : "원음 저장",
          "button button-quiet button-small",
        );
        button.type = "button";
        button.addEventListener("click", () => saveAudio(part, index));
        row.append(player, button);
      }
      if (part.transcript) {
        const detail = document.createElement("details");
        detail.append(element("summary", "전사 보기"), element("pre", part.transcript));
        row.append(detail);
      }
      ui["audio-parts"].append(row);
    });
    refresh();
  }

  function clearParts() {
    for (const part of state.parts) if (part.url) URL.revokeObjectURL(part.url);
    state.parts = [];
    state.summarySteps = [];
    renderParts();
  }

  function resetResult() {
    state.dailySequence = null;
    state.resultId = null;
    state.resultStored = false;
    setSavedTodos(null);
    state.todoEditing = null;
    state.todoSource = null;
    state.me = null;
    state.mePicking = false;
    ui.transcript.value = "";
    state.minutes = null;
    state.minutesFormat = null;
    state.summarySource = "";
    state.notesSaved = true;
    state.usage = [];
    state.callIds = [];
    state.analysisModel = "";
    state.versions = [];
    state.feedback = "";
    state.copies = null;
    clearReview();
    renderMinutes();
    refresh();
  }

  function clearReview(review = null) {
    // 결과가 바뀌면 그 결과의 평가를 보여 준다. 새 결과에는 아직 평가가 없다.
    state.review = review;
    state.reviewStars = review?.stars ?? null;
    ui["review-comment"].value = review?.comment || "";
    ui["review-status"].textContent = "";
    renderVersions();
  }

  function recordingMetadata() {
    return {
      title: ui.title.value.trim(), date: ui.date.value, participants: ui.participants.value.trim(),
      notes: ui["meeting-notes"].value.trim(), ...formatFields(),
    };
  }

  function confirmReplacement() {
    if (!state.parts.length && !ui.transcript.value && !state.minutes) return true;
    if (!hasUnsavedWork()) return true;
    return confirm("현재 원음, 전사와 회의록을 새 녹음으로 바꿉니다. 필요한 파일을 저장했나요?");
  }

  function startMeter(stream) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      const context = new Context();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      state.meterContext = context;
      state.meterTimer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + (sample - 128) ** 2, 0) / samples.length,
        );
        const percent = Math.min(100, Math.round(rms * 3));
        ui["level-fill"].style.width = `${percent}%`;
        ui["level-meter"].setAttribute("aria-valuenow", String(percent));
      }, 200);
    } catch {
      stopMeter();
    }
  }

  function updateTimer() {
    const elapsed = Date.now() - state.recordingStartedAt;
    const seconds = Math.floor(elapsed / 1000);
    ui.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (state.recorder && elapsed >= state.maxMinutes * 60_000) rotateRecording();
  }

  function finishRecorder(context) {
    if (context.finished) return;
    context.finished = true;
    state.recorders.delete(context);
    const part = context.part;
    const blob = new Blob(part.chunks, { type: context.recorder.mimeType || "audio/webm" });
    part.chunks = [];
    if (blob.size && context.generation === state.dataGeneration) {
      part.blob = blob;
      part.url = URL.createObjectURL(blob);
    } else state.parts.splice(state.parts.indexOf(part), 1);
    if (!state.recorders.size && state.recordingStopping) {
      stopTracks(state.stream);
      state.stream = null;
      ui["record-state"].textContent = state.parts.length ? "저장 필요" : "원음 없음";
      if (!state.flowBusy) {
        workflow("녹음이 멈췄습니다. ‘저장·분석 다시 시도’를 눌러 원음을 보관하세요.");
        ui["retry-analysis"].hidden = false;
      }
    }
    renderParts();
    context.resolveFinished?.();
  }

  function stopRecording(message) {
    if (state.recordingStopping || !state.recorders.size) return;
    state.recordingStopping = true;
    state.recorder = null;
    stopTimer();
    ui["record-state"].textContent = "정리 중";
    if (message) announce(message);
    for (const context of state.recorders) {
      try {
        if (context.recorder.state !== "inactive") context.recorder.stop();
      } catch {
        finishRecorder(context);
      }
    }
    refresh();
  }

  function startPart(stream, mimeType) {
    const recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 48_000,
      ...(mimeType ? { mimeType } : {}),
    });
    const part = {
      chunks: [],
      chunkBytes: 0,
      blob: null,
      url: null,
      saved: false,
      transcript: "",
      applied: false,
    };
    const context = { recorder, part, generation: state.dataGeneration, finished: false };
    context.done = new Promise(resolve => { context.resolveFinished = resolve; });
    recorder.ondataavailable = (event) => {
      if (context.finished || !event.data?.size) return;
      part.chunks.push(event.data);
      part.chunkBytes += event.data.size;
      if (state.recorder === context && part.chunkBytes >= state.maxAudioBytes - 524_288)
        rotateRecording();
      updateSize();
    };
    recorder.onstop = () => finishRecorder(context);
    recorder.onerror = () => stopRecording("녹음 장치 오류로 녹음을 멈췄습니다.");
    recorder.start(5_000);
    state.parts.push(part);
    state.recorders.add(context);
    state.recorder = context;
    state.recordingStartedAt = Date.now();
    renderParts();
    return context;
  }

  function rotateRecording() {
    const previous = state.recorder;
    if (!previous || state.recordingStopping) return;
    try {
      startPart(state.stream, previous.recorder.mimeType);
      previous.recorder.stop();
      announce(`파일 ${String(state.parts.length).padStart(3, "0")} 녹음을 시작했습니다.`);
    } catch (error) {
      stopRecording(`다음 파일을 시작하지 못했습니다. ${error.message}`);
    }
  }

  async function startRecording() {
    if (state.flowBusy || state.historyBusy || state.archiveBusy || state.aiController) return;
    if (state.permissionPending || state.recorders.size) return;
    // 업데이트 설치를 시작했으면 곧 창이 닫히므로 새 녹음을 시작하지 않는다.
    if (state.updateLaunching) return announce("업데이트 설치를 시작해 새 회의를 시작할 수 없습니다. 앱이 다시 열린 뒤 시작하세요.");
    const blockers = startBlockers();
    if (blockers.length) {
      workflow(blockers[0]);
      return;
    }
    if (!confirmReplacement()) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      announce("이 브라우저에서 마이크 녹음을 사용할 수 없습니다.");
      return;
    }
    const generation = ++state.permissionGeneration;
    state.permissionPending = true;
    ui["record-state"].textContent = "마이크 허가 대기";
    refresh();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (generation !== state.permissionGeneration) {
        stopTracks(stream);
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/wav"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      state.stream = stream;
      stream.getTracks().forEach((track) => {
        track.onended = () => stopRecording("마이크 연결이 끝나 녹음을 정지했습니다.");
      });
      clearParts();
      resetResult();
      state.recordingId = newOperationId();
      state.recordingStored = false;
      state.meetingId = null;
      state.location = "main";
      state.projectName = "";
      state.recordingMetadata = recordingMetadata();
      state.audioStored = false;
      state.setupOpen = false;
      ui["retry-analysis"].hidden = true;
      state.recordingStopping = false;
      startPart(stream, mimeType);
      ui.timer.textContent = "00:00";
      state.recordingTimer = setInterval(updateTimer, 500);
      startMeter(stream);
      ui["record-state"].textContent = "녹음 중";
      refresh();
      ui.stop.focus?.();
      announce("녹음 중입니다. 다른 탭을 열어도 계속 녹음합니다.");
      workflow("회의 중입니다. 마치면 ‘회의 종료’를 누르세요. 음성 저장과 분석이 이어집니다.");
    } catch (error) {
      stopTracks(stream);
      state.stream = null;
      state.recorder = null;
      state.recordingStopping = true;
      ui["record-state"].textContent = "대기";
      announce(
        error?.name === "NotAllowedError"
          ? "마이크 사용이 거절됐습니다."
          : `녹음을 시작하지 못했습니다. ${error.message}`,
      );
    } finally {
      if (generation === state.permissionGeneration) state.permissionPending = false;
      refresh();
    }
  }

  function cancelPermission() {
    if (!state.permissionPending) return;
    state.permissionGeneration++;
    state.permissionPending = false;
    ui["record-state"].textContent = "대기";
    announce("마이크 허가 요청을 취소했습니다. 나중에 허가되더라도 녹음하지 않습니다.");
    refresh();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function baseName() {
    const title =
      ui.title.value
        .trim()
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
        .slice(0, 70) || "회의록";
    return `${ui.date.value || "날짜없음"}-${title}`;
  }

  function saveAudio(part, index) {
    if (!part.blob) return;
    const extension = part.blob.type.includes("mp4")
      ? "m4a"
      : part.blob.type.includes("wav")
        ? "wav"
        : "webm";
    download(
      part.blob,
      `${baseName()}-원음-file${String(index + 1).padStart(3, "0")}.${extension}`,
    );
    part.saved = true;
    renderParts();
    announce("원음 다운로드를 시작했습니다. 파일이 실제로 저장됐는지 확인하세요.");
  }

  async function importAudio(event) {
    const files = Array.from(event.target.files || []).sort((a, b) =>
      a.name.localeCompare(b.name, "ko", { numeric: true }),
    );
    event.target.value = "";
    if (!files.length) return;
    if (state.recorders.size || state.permissionPending || state.aiController) {
      announce("진행 중인 작업을 마친 뒤 파일을 불러오세요.");
      return;
    }
    if (files.some((file) => file.size > state.maxAudioBytes)) {
      announce("각 오디오 파일은 22MB 이하여야 합니다.");
      return;
    }
    if (!confirmReplacement()) return;
    clearParts();
    state.parts = files.map((file) => ({
      blob: file,
      url: URL.createObjectURL(file),
      saved: true,
      transcript: "",
      applied: false,
    }));
    renderParts();
    resetResult();
    ui["record-state"].textContent = "파일 불러옴";
    state.recordingId = newOperationId();
    state.recordingStored = false;
    state.meetingId = null;
    state.location = "main";
    state.projectName = "";
    state.recordingMetadata = null;
    state.audioStored = false;
    ui["retry-analysis"].hidden = false;
    workflow("음성을 불러왔습니다. ‘저장·분석 다시 시도’를 누르면 보관하고 분석합니다.");
    announce(`${files.length}개 파일을 이름 순서대로 불러왔습니다. 전사할 때만 외부로 전송됩니다.`);
  }

  function setBusy(controller) {
    state.aiController = controller;
    refresh();
  }

  function assertAI(signal) {
    if (signal.aborted || state.recorders.size)
      throw new DOMException("요청 취소", "AbortError");
  }

  async function requestTranscription(signal) {
    for (const part of state.parts) {
      assertAI(signal);
      if (part.applied) continue;
      if (part.transcript) {
        if (!part.applied) {
          ui.transcript.value = [ui.transcript.value.trim(), part.transcript.trim()]
            .filter(Boolean)
            .join("\n\n");
          part.applied = true;
          state.notesSaved = false;
          renderParts();
        }
        continue;
      }
      if (!part.blob || part.blob.size > state.maxAudioBytes)
        throw new Error("전사할 수 있는 22MB 이하 원음이 없습니다.");
      const before = ui.transcript.value;
      const type = part.blob.type.split(";")[0] || "audio/webm";
      const keywords = Formats.participantKeywords(ui.participants.value);
      const result = await aiApi("transcription", "/api/transcribe", {
        method: "POST",
        body: part.blob,
        headers: { ...aiHeaders(type), ...(keywords.length ? { "X-Transcribe-Keywords": encodeURIComponent(keywords.join(",")) } : {}) },
        signal,
      });
      assertAI(signal);
      part.transcript = result.text || "";
      if (ui.transcript.value !== before) {
        renderParts();
        throw new Error(
          "전송 중 전사를 수정했습니다. 수정 내용은 유지했고 받은 전사는 파일 목록에 보관했습니다. 다시 전사를 누르면 뒤에 추가합니다.",
        );
      }
      ui.transcript.value = [before.trim(), part.transcript.trim()].filter(Boolean).join("\n\n");
      part.applied = true;
      state.notesSaved = false;
      renderParts();
    }
    return ui.transcript.value;
  }

  async function paidTask(task) {
    if (needsNewKey() && !state.aiController) return promptNewKey();
    if (!canAnalyze() || state.aiController) return;
    state.trialWarning = "";
    const controller = new AbortController();
    // 분석 시도마다 새 식별자를 써서 분할·자동 재요청은 한 번으로, 명시적 재분석은 새 한 번으로 센다.
    const analysisId = newOperationId();
    state.analysisId = analysisId;
    setBusy(controller);
    try {
      await task(controller.signal);
      return true;
    } catch (error) {
      if (state.finishAttempted !== analysisId) settleTrial("release", analysisId);
      if (error.mustRegister) {
        announce(withTrialWarning(error.message));
        api("/api/config").then((config) => { applyAccess(config); refresh(); }).catch(() => {});
        openSettings("settings-ai");
      } else if (error.name === "AbortError") announce("요청을 취소했습니다. 원음과 전사는 유지됩니다.");
      else announce(withTrialWarning(`${error.message} 명시적으로 다시 요청하면 비용이 다시 발생할 수 있습니다.`));
      workflow(`${state.audioStored ? "음성은 저장되어 있습니다. " : ""}${error.name === "AbortError" ? "분석을 취소했습니다." : error.message}`);
      ui["retry-analysis"].hidden = !state.parts.length;
      if (ui.transcript.value) document.getElementById("transcript-details").open = true;
      return false;
    } finally {
      if (state.analysisId === analysisId) state.analysisId = null;
      if (state.aiController === controller) setBusy(null);
    }
  }

  async function transcribe() {
    await paidTask(async (signal) => {
      await requestTranscription(signal);
      assertAI(signal);
      await settleTrial("finish", state.analysisId);
      announce(withTrialWarning("전사를 받았습니다. 내용을 검토하고 수정할 수 있습니다."));
    });
  }

  function splitTranscript(value, maximum = 24_000) {
    const characters = Array.from(value);
    const sections = [];
    for (let start = 0; start < characters.length;) {
      let end = start;
      let units = 0;
      while (end < characters.length && units + characters[end].length <= maximum) {
        units += characters[end].length;
        end++;
      }
      if (end < characters.length) {
        const limit = end;
        for (let index = end; index > start + Math.floor(maximum / 2); index--) {
          if (/[.!?。\n]/u.test(characters[index - 1])) {
            end = index;
            break;
          }
        }
        if (end === limit) {
          for (let index = end; index > start + Math.floor(maximum / 2); index--) {
            if (/\s/u.test(characters[index - 1])) {
              end = index;
              break;
            }
          }
        }
      }
      sections.push(characters.slice(start, end).join(""));
      start = end;
    }
    return sections;
  }

  async function summarize(useExistingText = false, feedback = "") {
    // feedback이 있으면 의견 반영 다시 정리다. 모든 구간 요청에 같은 의견을 넣고, 새 결과에 그 의견을 함께 저장한다.
    if (state.parts.length && !state.audioStored) return await finishMeeting();
    return await paidTask(async (signal) => {
      const transcript = useExistingText === true && ui.transcript.value.trim()
        ? ui.transcript.value.trim()
        : state.parts.some(
        (part) => part.blob && !part.applied,
      )
        ? (await requestTranscription(signal)).trim()
        : ui.transcript.value.trim();
      assertAI(signal);
      if (!transcript) throw new Error("전사 내용이 비어 있습니다.");
      const source = summaryInput();
      const metadata = JSON.parse(source);
      if (!feedback && state.audioStored && state.recordingId) {
        await api(`/api/recordings/${state.location}/${state.recordingId}/transcript`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: transcript }), signal,
        });
        assertAI(signal);
        if (useExistingText === true) for (const part of state.parts) part.applied = true;
        ui["archive-status"].textContent = "음성과 전사 원문을 저장했습니다. 회의록을 분석하고 있습니다.";
      }
      let previousMinutes = null;
      let additionalRequests = 0;
      async function summarizeSection(text, depth = 0) {
        assertAI(signal);
        if (summaryInput() !== source) throw new Error("전송 중 입력을 수정했습니다. 수정 내용은 유지했습니다. 다시 만들면 변경 내용을 반영합니다.");
        const body = JSON.stringify({ ...metadata, text, previousMinutes, ...(feedback ? { feedback } : {}), ...(state.models.length && state.summaryModel ? { model: state.summaryModel } : {}) });
        const cached = state.summarySteps.find((step) => step.body === body);
        if (cached?.minutes) previousMinutes = cached.minutes;
        else if (cached?.sections) {
          for (const section of cached.sections) await summarizeSection(section, depth + 1);
          cached.minutes = previousMinutes;
        }
        else {
          if (depth > 0 && additionalRequests >= 6)
            throw new Error("자동 분할 추가 요청 6회에 도달해 중단했습니다. 전사 원문은 유지됩니다. 같은 화면에서 다시 분석하면 성공한 구간을 재사용합니다.");
          if (depth > 0) additionalRequests++;
          let result;
          try {
            result = await aiApi("summary", "/api/summary", { method: "POST", body, headers: aiHeaders("application/json"), signal });
          } catch (error) {
            assertAI(signal);
            if (!["AI_OUTPUT_LIMIT", "AI_INPUT_LIMIT"].includes(error.code)) throw error;
            if (text.length <= 2_000 || additionalRequests >= 6)
              throw new Error(`${error.message} 더 나누어 자동 처리할 수 없어 중단했습니다. 전사와 성공 구간은 유지됩니다.`);
            const sections = splitTranscript(text, Math.ceil(text.length / 2));
            const step = { body, sections };
            state.summarySteps.push(step);
            workflow("요약 길이 한도에 도달해 해당 구간을 나눠 처리합니다. 자동 추가 요청은 최대 6회입니다.");
            for (const section of sections) await summarizeSection(section, depth + 1);
            step.minutes = previousMinutes;
          }
          if (result) {
            assertAI(signal);
            previousMinutes = result.minutes;
            state.summarySteps.push({ body, minutes: result.minutes });
          }
        }
        if (summaryInput() !== source)
          throw new Error(
            "전송 중 입력을 수정했습니다. 수정 내용은 유지했습니다. 다시 만들면 변경 내용을 반영합니다.",
          );
      }
      let shortenFailed = false;
      async function shortenMinutes(minutes) {
        // 결과가 형식의 목표 길이를 넘을 때만 overview와 topics를 한 번 줄인다. 제목·결정·할 일·미확정은 서버가 원문 그대로 되붙이고, 실패해도 완성한 전체 결과는 저장한다.
        const targetCharacters = Formats.compactTarget(minutes, metadata.outputFormat);
        if (!targetCharacters) return minutes;
        const { title, date, participants, outputFormat: format, customFormat } = metadata;
        const body = JSON.stringify({ title, date, participants, outputFormat: format, ...(customFormat ? { customFormat } : {}), targetCharacters, minutes, ...(feedback ? { feedback } : {}), ...(state.models.length && state.summaryModel ? { model: state.summaryModel } : {}) });
        const cached = state.summarySteps.find((step) => step.body === body);
        if (cached?.minutes) return cached.minutes;
        workflow("회의록이 길어 읽기 좋은 길이로 줄이는 중…");
        try {
          const result = await aiApi("summary", "/api/summary/compact", { method: "POST", body, headers: aiHeaders("application/json"), signal });
          assertAI(signal);
          // 모델이 줄이지 못한 답을 주면 실패로 알리고, 성공으로 재사용하지 않게 저장하지 않는다.
          if (result.shortened === false) {
            shortenFailed = true;
            return minutes;
          }
          state.summarySteps.push({ body, minutes: result.minutes });
          return result.minutes;
        } catch {
          assertAI(signal);
          shortenFailed = true;
          return minutes;
        }
      }
      for (const text of splitTranscript(transcript)) await summarizeSection(text);
      previousMinutes = await shortenMinutes(previousMinutes);
      if (summaryInput() !== source)
        throw new Error("전송 중 입력을 수정했습니다. 수정 내용은 유지했습니다. 다시 만들면 변경 내용을 반영합니다.");
      const shortenNote = shortenFailed ? " 길이를 줄이지 못해 전체 내용을 그대로 저장했습니다." : "";
      state.minutes = previousMinutes;
      state.minutesFormat = metadata.outputFormat;
      await settleTrial("finish", state.analysisId);
      if (previousMinutes.suggestedTitle) ui.title.value = previousMinutes.suggestedTitle;
      state.summarySource = summaryInput();
      state.notesSaved = false;
      // 새 결과가 사람이 고친 할 일을 보던 결과에서 이어받도록 어느 결과에서 다시 만들었는지 기억해 둔다.
      state.todoSource = state.resultId;
      state.resultId = newOperationId();
      state.resultStored = false;
      setSavedTodos(null);
      state.todoEditing = null;
      state.feedback = feedback;
      state.copies = null;
      clearReview();
      renderMinutes();
      refresh();
      await archiveResult();
      workflow(`회의록 저장 완료.${shortenNote}${shortenFailed ? " 의견 칸에 요청을 적고 ‘의견 반영해 다시 정리’를 누르면 다시 줄입니다." : ""} ‘지난 회의’에서 다시 열 수 있습니다.`);
      ui["retry-analysis"].hidden = true;
      const copyFailure = state.copies?.failed?.length ? ` ${copyMessage(state.copies)}` : "";
      announce(withTrialWarning(`${state.audioStored ? "음성과 " : ""}회의록을 보관했습니다. 내용을 검토하세요.${shortenNote}${copyFailure}`));
    });
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = String(text ?? "");
    if (className) node.className = className;
    return node;
  }

  function renderList(parent, title, items, format = (item) => item) {
    const section = document.createElement("section");
    section.append(element("h3", title));
    if (!items?.length) section.append(element("p", "기록 없음", "muted"));
    else {
      const list = document.createElement("ul");
      items.forEach((item) => list.append(element("li", format(item))));
      section.append(list);
    }
    parent.append(section);
  }

  function renderUsage() {
    ui.usage.replaceChildren();
    const entries = usageTools().normalize(state.usage);
    if (!entries.length) {
      ui.usage.append(element("p", state.minutes ? "이 회의는 AI 사용량이 기록되지 않았습니다. (미제공)" : "분석하면 모델별 입력·출력·합계 토큰이 여기에 표시됩니다.", "muted"));
      return;
    }
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const label of ["모델", "용도", "입력 토큰", "출력 토큰", "합계 토큰", "요청"]) head.append(element("th", label));
    table.append(head);
    for (const entry of entries) {
      const view = usageTools().describe(entry);
      if (!view) continue;
      const row = document.createElement("tr");
      const note = [view.detail, view.unknownText].filter(Boolean).join(" · ");
      row.append(element("td", modelInfo(view.model)?.label || view.model), element("td", view.kindLabel), element("td", view.input), element("td", view.output), element("td", view.total),
        element("td", note ? `${entry.requests}회 · ${note}` : `${entry.requests}회`));
      table.append(row);
    }
    ui.usage.append(table);
  }

  function renderMinutes() {
    renderUsage();
    renderMine();
    ui.minutes.replaceChildren();
    const minutes = state.minutes;
    if (!minutes) {
      ui.minutes.append(
        element(
          "p",
          ui.transcript.value.trim() || state.audioStored
          ? "아직 회의록이 없습니다. 아래 ‘전사 원문 확인 · 다시 분석’에서 분석을 다시 요청할 수 있습니다."
          : "회의록을 만들면 회의 핵심, 다음 할 일, 합의된 방향, 주제별 설명, 미확정 사항이 여기에 표시됩니다.",
          "empty-state",
        ),
      );
      return;
    }
    const format = outputFormat(state.minutesFormat ?? ui["output-format"].value);
    renderMinutesInto(ui.minutes, Todos.apply(minutes, state.todos), format, format === "custom" ? currentCustom() : null, renderTodos);
  }

  function currentTodos() {
    return Todos.effective(state.minutes, state.todos);
  }

  function todoEditable() {
    return Boolean(state.minutes && state.resultStored && state.resultId && !stale());
  }

  function renderTodos(target, title, undecided = false) {
    // 저장된 결과에서만 고칠 수 있다. 참석자를 안 적은 회의는 번호 없이 체크와 문장 수정만 된다.
    const section = element("section", "", "todo-section");
    section.append(element("h3", title));
    const people = Todos.people(ui.participants.value);
    const finalized = Boolean(state.todos?.finalized);
    const editable = todoEditable();
    const assigning = editable && people.length > 0 && !finalized;
    if (assigning) {
      section.append(element("p", "번호를 누르면 담당자 이름이 들어가고 복사·저장에도 반영됩니다.", "todo-hint"));
      const legend = element("ol", "", "people");
      renderPeople(legend, people);
      section.append(legend);
    }
    const items = currentTodos().map((item, index) => ({ ...item, index }));
    const list = element("ol", "", "todo-list");
    // 번호를 누르는 동안에는 줄이 움직이지 않게 맞추기를 끝낸 뒤에만 이름순으로 보여 준다.
    for (const item of finalized ? Todos.sorted(items) : items) list.append(todoRow(item, people, assigning, editable, undecided));
    section.append(list);
    const actions = element("div", "", "todo-actions");
    if (editable && people.length) {
      const finish = element("button", finalized ? "담당자 다시 맞추기" : "맞추기 완료", "button button-outline todo-finish");
      finish.type = "button";
      finish.dataset.todoFocus = "finish";
      finish.addEventListener("click", () => commitTodos({ finalized: !finalized, items: currentTodos() }, "finish"));
      actions.append(finish);
    }
    if (shareReady()) {
      // 담당자를 맞춘 자리에서 바로 사람마다 보낼 글을 복사할 수 있게 같은 단추를 둔다.
      const share = element("button", "사람별 할 일 복사", "button button-outline todo-share");
      share.type = "button";
      share.dataset.todoFocus = "share";
      share.setAttribute("aria-haspopup", "dialog");
      share.addEventListener("click", () => openShare(share));
      actions.append(share);
    }
    if (actions.children.length) section.append(actions);
    target.append(section);
  }

  function todoRow(item, people, assigning, editable, undecided) {
    const row = element("li", "", `todo-row${item.done ? " is-done" : ""}`);
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = item.done;
    check.disabled = !editable;
    check.setAttribute("aria-label", `${item.task} 완료`);
    check.dataset.todoFocus = `${item.index}:check`;
    check.addEventListener("change", () => updateTodo(item.index, { done: check.checked }, check.dataset.todoFocus));
    const box = element("label", "", "todo-check");
    box.append(check);
    row.append(box);
    if (state.todoEditing?.index === item.index) { row.append(todoEditor()); return row; }
    row.append(element("span", item.task, "todo-task"));
    const meta = element("span", "", "todo-meta");
    // 업무 정리 형식은 담당·기한이 없으면 미정으로 보여 준다.
    meta.append(element("span", item.owner || (undecided ? "담당 미정" : ""), "todo-owner"), element("span", item.due || (undecided ? "기한 미정" : ""), "todo-due"));
    row.append(meta);
    if (assigning) {
      const numbers = element("div", "", "todo-nums");
      numbers.setAttribute("role", "group");
      numbers.setAttribute("aria-label", `${item.task} 담당자`);
      people.forEach((name, position) => {
        const button = element("button", position + 1, "todo-num");
        button.type = "button";
        button.title = name;
        button.setAttribute("aria-pressed", String(item.owner === name));
        button.setAttribute("aria-label", `${position + 1}번 ${name}`);
        button.dataset.todoFocus = `${item.index}:n${position + 1}`;
        button.addEventListener("click", () => assignTodo(item.index, name, button.dataset.todoFocus));
        numbers.append(button);
      });
      row.append(numbers);
      // 숫자 키는 1~9번까지 바로 고를 수 있다.
      row.addEventListener("keydown", (event) => {
        const name = /^[1-9]$/.test(event.key) ? people[Number(event.key) - 1] : null;
        if (!name) return;
        event.preventDefault();
        assignTodo(item.index, name, event.target.dataset?.todoFocus);
      });
    }
    // 참석자를 안 적은 회의는 체크만 된다.
    if (editable && people.length) {
      const edit = element("button", "수정", "todo-edit");
      edit.type = "button";
      edit.setAttribute("aria-label", `${item.task} 수정`);
      edit.dataset.todoFocus = `${item.index}:edit`;
      edit.addEventListener("click", () => {
        state.todoEditing = { index: item.index, task: item.task, due: item.due || "" };
        renderTodosAgain(`${item.index}:task`);
      });
      row.append(edit);
    }
    return row;
  }

  function todoEditor() {
    const box = element("div", "", "todo-editor");
    const editing = state.todoEditing;
    const field = (name, label, max, placeholder) => {
      const input = document.createElement("input");
      input.value = editing[name];
      input.maxLength = max;
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      input.dataset.todoFocus = `${editing.index}:${name}`;
      input.addEventListener("input", () => { editing[name] = input.value; });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); saveTodoEdit(); }
        else if (event.key === "Escape") { event.preventDefault(); cancelTodoEdit(); }
      });
      return input;
    };
    const save = element("button", "저장", "button button-primary button-small");
    save.type = "button";
    save.addEventListener("click", saveTodoEdit);
    const cancel = element("button", "취소", "button button-quiet button-small");
    cancel.type = "button";
    cancel.addEventListener("click", cancelTodoEdit);
    box.append(field("task", "할 일 문장", Todos.LIMITS.task, "할 일"), field("due", "기한", Todos.LIMITS.field, "기한 (선택)"), save, cancel);
    return box;
  }

  function cancelTodoEdit() {
    const index = state.todoEditing?.index;
    state.todoEditing = null;
    clearTodoNotice();
    renderTodosAgain(`${index}:edit`);
  }

  async function saveTodoEdit() {
    const editing = state.todoEditing;
    if (!editing) return;
    if (!editing.task.trim()) { ui["result-status"].textContent = "할 일 문장을 적어 주세요."; return; }
    const items = currentTodos().map((item) => ({ ...item }));
    Object.assign(items[editing.index], { task: editing.task.trim(), due: editing.due.trim() || null });
    // 저장에 실패하면 고치던 칸을 그대로 두어 입력을 잃지 않게 한다.
    if (await commitTodos({ finalized: Boolean(state.todos?.finalized), items }, `${editing.index}:task`)) {
      state.todoEditing = null;
      clearTodoNotice();
      renderTodosAgain(`${editing.index}:edit`);
    }
  }

  function renderTodosAgain(focusKey) {
    renderMinutes();
    if (focusKey) (state.resultTab === "mine" ? ui["panel-mine"] : ui.minutes).querySelector(`[data-todo-focus="${focusKey}"]`)?.focus();
    // 초점은 보고 있는 탭의 패널에서 되찾는다. 내 할 일 탭의 체크 상자는 mine:<번호> 열쇠를 쓴다.
  }

  function currentMe() {
    // 이 회의에서 나로 정해진 사람이다. 이 회의에 저장된 선택, 설정의 내 이름 순서로 정하고 모르면 null이다.
    return Todos.resolveMe(Todos.candidates(ui.participants.value, currentTodos()), state.me, state.settings?.myName || "");
  }

  function focusMine(key) {
    const node = ui["panel-mine"].querySelector(`[data-todo-focus="${key}"]`);
    node?.focus();
    return Boolean(node);
  }

  function restLine(items, meName) {
    // 내 일이 아닌 일의 수다. 담당 미정은 내 일일 수도 있는데 아직 아무에게도 가지 않은 일이라 눈에 띄게 쓴다.
    const { unassigned, others } = Todos.rest(items, meName), line = element("div", "", "mine-rest"), text = element("span");
    if (unassigned) text.append(element("b", `담당 미정 ${unassigned}건`));
    if (unassigned && others) text.append(element("span", " · "));
    if (others) text.append(element("span", `다른 사람 일 ${others}건`));
    const all = element("button", "정리본에서 전체 보기", "button button-quiet button-small mine-all");
    all.type = "button";
    all.addEventListener("click", () => { showResultTab("minutes"); ui["tab-minutes"].focus(); });
    line.append(text, all);
    return line;
  }

  function whoBox(list, me) {
    // 이 회의에서 나를 고르는 상자다. 참석자 번호와 이름(참석자를 안 적은 회의는 담당자 이름)이 후보다.
    const box = element("div", "", "who-box"), group = element("div", "", "who-list"), tools = element("div", "", "button-row");
    const locked = !todoEditable() || state.meBusy;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "이 회의의 사람 중에서 나 고르기");
    list.forEach((entry, index) => {
      const pressed = me?.name === entry.name, pick = element("button", "", "who-button");
      pick.type = "button";
      pick.disabled = locked;
      pick.setAttribute("aria-pressed", String(pressed));
      pick.dataset.todoFocus = pressed ? "who:pressed" : `who:${index}`;
      if (entry.number) pick.append(element("b", entry.number, "num"));
      pick.append(element("span", entry.name));
      pick.addEventListener("click", () => {
        // 눌린 이름을 다시 누르면 바꾸지 않고 상자만 닫는다.
        if (!pressed) return saveMe(entry.name);
        state.mePicking = false;
        renderMine();
        focusMine("me-change");
      });
      group.append(pick);
    });
    box.append(element("p", "이 회의에서 나는 누구인가요?", "who-lead"), group,
      element("p", "한 번 고르면 이 회의에 기억합니다. 설정에 적어 둔 내 이름과 같은 사람이 있으면 앱이 미리 골라 둡니다.", "fine-print"));
    if (state.me !== null) {
      // 이 회의에 저장된 선택이 있으면 지울 수 있다. 지금 결과의 후보에 없어 적용되지 않는 옛 선택도 지울 수 있어야 한다.
      const clear = element("button", "선택 지우기", "button button-quiet button-small who-clear");
      clear.type = "button";
      clear.disabled = locked;
      clear.addEventListener("click", () => saveMe(null));
      tools.append(clear);
    }
    if (!state.settings?.myName) {
      const settings = element("button", "설정에 내 이름 적어 두기", "button button-quiet button-small who-settings");
      settings.type = "button";
      tools.append(settings);
    }
    if (tools.children.length) box.append(tools);
    return box;
  }

  function renderMine() {
    // 내 할 일 탭을 다시 그린다. 판정하지 못한 회의가 내 일이 없는 회의처럼 보이지 않게 상태마다 다른 말로 보여 준다.
    const panel = ui["panel-mine"];
    if (!state.minutes) return panel.replaceChildren();
    const items = currentTodos();
    if (!items.length) return panel.replaceChildren(element("p", "이 회의에는 정리된 할 일이 없습니다.", "mine-empty"));
    const list = Todos.candidates(ui.participants.value, items);
    if (!list.length) return panel.replaceChildren(element("p", "참석자를 적지 않은 회의라 누가 맡았는지 알 수 없습니다.", "mine-empty"), restLine(items, null));
    const me = currentMe();
    if (!me) return panel.replaceChildren(whoBox(list, null));
    const mine = Todos.mine(items, me.name), left = mine.filter((item) => !item.done).length, editable = todoEditable();
    const head = element("div", "", "mine-head"), title = element("div", "", "mine-title"), row = element("div", "", "me-row");
    title.append(element("h3", "내가 맡은 일"));
    if (mine.length) title.append(element("span", left ? `${left}건 남음` : "모두 끝냄", "mine-left"));
    const change = element("button", "바꾸기", "button button-quiet button-small me-change");
    change.type = "button";
    change.dataset.todoFocus = "me-change";
    change.setAttribute("aria-expanded", String(state.mePicking));
    change.addEventListener("click", () => {
      state.mePicking = !state.mePicking;
      renderMine();
      if (!state.mePicking || !(focusMine("who:pressed") || focusMine("who:0"))) focusMine("me-change");
    });
    row.append(element("span", "나", "me-chip"), element("span", me.name, "me-name"), change);
    head.append(title, row);
    const parts = [head];
    if (state.mePicking) parts.push(whoBox(list, me));
    if (!mine.length) parts.push(element("p", "이 회의에서 내가 맡은 일은 없습니다.", "mine-empty"));
    else {
      const rows = element("ul", "", "mine-list");
      for (const item of mine) {
        const line = element("li", "", `mine-row${item.done ? " is-done" : ""}`), label = element("label"), check = document.createElement("input");
        check.type = "checkbox";
        check.checked = item.done;
        check.disabled = !editable;
        check.dataset.todoFocus = `mine:${item.index}`;
        check.addEventListener("change", () => updateTodo(item.index, { done: check.checked }, check.dataset.todoFocus));
        label.append(check, element("span", item.task, "mine-task"));
        line.append(label, element("span", item.due || "", "mine-due"));
        // 기한은 저장된 글자 그대로 쓰고, 없으면 비워 둔다.
        rows.append(line);
      }
      parts.push(rows);
    }
    parts.push(restLine(items, me.name));
    panel.replaceChildren(...parts);
  }

  async function saveMe(name) {
    // 이 회의에서 나를 고르거나(이름) 고른 것을 지운다(null). 먼저 화면에 반영하고, 실패하면 앞선 선택으로 되돌린다.
    if (state.meBusy || !todoEditable()) return false;
    const resultId = state.resultId, route = `/api/meetings/${state.location}/${resultId}/me`, before = state.me;
    // 저장할 결과를 지금 결과로 고정한다. 저장 도중 새 회의로 넘어가도 원래 회의에만 저장되고 새 화면은 바꾸지 않는다.
    state.me = name;
    state.mePicking = false;
    state.meBusy = true;
    state.todoPending++;
    // 할 일 저장과 같은 대기 수를 올려 저장이 끝날 때까지 결과 닫기·다른 회의 열기·업데이트 설치를 같은 규칙으로 막는다.
    renderMine();
    focusMine("me-change");
    refresh();
    try {
      const { me = null } = await api(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (state.resultId === resultId) {
        state.me = me;
        ui["result-status"].textContent = "";
        announce(me ? `이 회의에서 나는 ${me}입니다.` : "고른 나를 지웠습니다.");
      }
      await loadHistory();
      return true;
    } catch (error) {
      if (state.resultId === resultId) {
        state.me = before;
        ui["result-status"].textContent = `나를 저장하지 못했습니다. ${error.message}`;
      } else announce(`이전 회의의 나를 저장하지 못했습니다. ${error.message}`);
      return false;
    } finally {
      state.meBusy = false;
      state.todoPending--;
      clearTodoNotice();
      if (state.resultId === resultId) {
        const inside = ui["panel-mine"].contains?.(document.activeElement);
        renderMine();
        // 다시 그리면 초점이 있던 단추가 사라지므로 같은 자리의 새 단추로 돌려준다.
        if (inside && !focusMine("me-change")) focusMine("who:0");
      }
      refresh();
    }
  }

  function assignTodo(index, name, focusKey) {
    return updateTodo(index, { owner: currentTodos()[index].owner === name ? null : name }, focusKey);
  }

  function updateTodo(index, patch, focusKey) {
    const items = currentTodos().map((item) => ({ ...item }));
    Object.assign(items[index], patch);
    return commitTodos({ finalized: Boolean(state.todos?.finalized), items }, focusKey);
  }

  function setSavedTodos(todos) {
    state.todos = todos || null;
    state.todoConfirmed = state.todos;
  }

  function todoHolding(target = ui["result-status"]) {
    // 고치던 입력을 잃거나 저장 중인 내용이 어긋나지 않게 결과를 떠나는 동작을 잠시 막는다.
    if (!state.todoEditing && !state.todoPending) return false;
    target.textContent = state.todoEditing ? TODO_NOTICES.editing : TODO_NOTICES.saving;
    return true;
  }

  function clearTodoNotice() {
    // 막을 이유가 없어졌으면 안내를 남겨 두지 않는다. 저장 실패처럼 다른 안내는 그대로 둔다.
    if (state.todoEditing || state.todoPending) return;
    for (const target of [ui["result-status"], ui["review-status"]]) {
      if (Object.values(TODO_NOTICES).includes(target.textContent)) target.textContent = "";
    }
  }

  function commitTodos(next, focusKey) {
    // 저장 대상을 지금 결과로 고정한다. 저장 도중 새 회의로 넘어가도 원래 결과에만 저장되고 화면에는 적용하지 않는다.
    const resultId = state.resultId, route = `/api/meetings/${state.location}/${resultId}/todos`, serial = ++state.todoSerial;
    state.todos = next;
    state.todoPending++;
    renderTodosAgain(focusKey);
    // 빠르게 여러 번 눌러도 누른 순서대로 저장하도록 줄을 세운다.
    state.todoQueue = state.todoQueue.then(async () => {
      try {
        await api(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finalized: next.finalized, items: next.items.map(({ task, owner, due, done }) => ({ task, owner, due, done })) }) });
        if (state.resultId === resultId) { state.todoConfirmed = next; ui["result-status"].textContent = ""; }
        await loadHistory();
        return true;
      } catch (error) {
        if (state.resultId === resultId) {
          // 뒤에 더 누른 저장이 남아 있으면 그 저장이 목록 전체를 다시 쓰므로 되돌리지 않는다. 마지막 저장이 실패했을 때만 저장이 확인된 값으로 돌아간다.
          if (serial === state.todoSerial) { state.todos = state.todoConfirmed; renderTodosAgain(focusKey); }
          ui["result-status"].textContent = `할 일을 저장하지 못했습니다. ${error.message}`;
        } else announce(`이전 회의의 할 일을 저장하지 못했습니다. ${error.message}`);
        return false;
      } finally { state.todoPending--; clearTodoNotice(); refresh(); }
    });
    return state.todoQueue;
  }

  function renderMinutesInto(target, minutes, format, custom, renderActions = null) {
    // 결과 창에서는 할 일을 고칠 수 있게 그리고, 형식 예시에서는 읽기용 목록으로 그린다.
    const actionBlock = (title, formatItem) => (renderActions && minutes.actions?.length ? renderActions(target, title, format === "tasks") : renderList(target, title, minutes.actions, formatItem));
    if (format === "custom" && !custom) format = "meeting";
    if (format === "custom" && custom) {
      // 내 형식은 사용자가 고른 항목만 고른 순서와 이름으로 보여 준다.
      for (const section of Formats.customSections(minutes, custom)) {
        if (section.type === "list" && section.key === "actions" && renderActions && minutes.actions?.length) { renderActions(target, section.title); continue; }
        if (section.type === "list") { renderList(target, section.title, section.items); continue; }
        const block = document.createElement("section");
        block.append(element("h3", section.title));
        if (section.type === "overview") { block.className = "summary-overview"; block.append(element("p", section.text)); }
        else if (!section.topics.length) block.append(element("p", "기록 없음", "muted"));
        else section.topics.forEach((topic) => { block.append(element("h4", topic.title)); topic.points?.forEach((point) => block.append(element("p", point))); });
        target.append(block);
      }
      return;
    }
    if (format !== "meeting") {
      // 핵심 요약형과 업무 정리형은 회의록형 절 제목을 그대로 붙이지 않고 내용이 있는 절만 보여 준다.
      const overview = document.createElement("section");
      overview.className = "summary-overview";
      overview.append(element("h3", format === "tasks" ? "업무 요약" : "핵심 요약"), element("p", minutes.overview));
      const topics = document.createElement("section");
      minutes.topics?.forEach((topic) => {
        const group = document.createElement("div");
        group.append(element("h3", topic.title));
        topic.points?.forEach((point) => group.append(element("p", point)));
        topics.append(group);
      });
      const action = (item) => format === "tasks"
        ? [item.task, `담당 ${item.owner || "미정"}`, `기한 ${item.due || "미정"}`].join(" · ")
        : [item.task, item.owner && `담당 ${item.owner}`, item.due && `기한 ${item.due}`].filter(Boolean).join(" · ");
      const optional = (title, items, formatItem) => { if (items?.length) renderList(target, title, items, formatItem); };
      target.append(overview);
      if (format === "tasks") {
        actionBlock("할 일", action);
        optional("미확정 항목", minutes.openQuestions);
        optional("결정 사항", minutes.decisions);
        if (minutes.topics?.length) target.append(topics);
      } else {
        if (minutes.topics?.length) target.append(topics);
        optional("결정 사항", minutes.decisions);
        if (minutes.actions?.length) actionBlock("후속 작업", action);
        optional("확인 필요", minutes.openQuestions);
      }
      return;
    }
    const overview = document.createElement("section");
    overview.className = "summary-overview";
    overview.append(element("h3", "핵심 요약"), element("p", minutes.overview));
    target.append(overview);
    actionBlock("다음 할 일", (action) =>
      [action.task, action.owner && `담당 ${action.owner}`, action.due && `기한 ${action.due}`]
        .filter(Boolean)
        .join(" · "),
    );
    target.append(element("h3", "상세 회의 내용"));
    const decisions = document.createElement("section");
    decisions.append(element("h3", "합의된 방향"));
    if (!minutes.decisions?.length) decisions.append(element("p", "기록 없음", "muted"));
    minutes.decisions?.forEach((decision) => decisions.append(element("p", decision)));
    target.append(decisions);
    const topics = document.createElement("section");
    if (!minutes.topics?.length) topics.append(element("p", "기록 없음", "muted"));
    minutes.topics?.forEach((topic) => {
      const group = document.createElement("div");
      group.append(element("h3", topic.title));
      topic.points?.forEach((point) => group.append(element("p", point)));
      topics.append(group);
    });
    target.append(topics);
    renderList(target, "미확정 사항", minutes.openQuestions);
  }

  function resultLabel() {
    const format = outputFormat(state.minutesFormat ?? ui["output-format"].value);
    return format === "custom" && currentCustom() ? currentCustom().name : formatLabels[format === "custom" ? "meeting" : format];
  }

  const RESULT_TABS = ["mine", "minutes", "transcript"];

  function availableTab(wanted) {
    // 내 할 일 탭은 정리본이 있는 결과에만 있다. 바라는 탭을 열 수 없으면 지금처럼 정리본을, 정리본 없이 전사만 있으면 전사문을 연다.
    const transcript = Boolean(ui.transcript.value.trim());
    if (wanted === "mine" && state.minutes) return "mine";
    if (wanted === "transcript" && transcript) return "transcript";
    return state.minutes || !transcript ? "minutes" : "transcript";
  }

  function showResultTab(tab) {
    // 결과 창은 내 할 일·정리본·전사문을 탭으로 나누고, 위쪽 버튼은 보고 있는 탭의 내용을 다룬다.
    state.resultTab = tab;
    for (const name of RESULT_TABS) {
      const selected = name === tab;
      ui[`tab-${name}`].setAttribute("aria-selected", String(selected));
      ui[`tab-${name}`].tabIndex = selected ? 0 : -1;
      ui[`panel-${name}`].hidden = !selected;
    }
    ui["result-status"].textContent = "";
    if (state.mePicking) {
      // 탭을 옮기면 펼쳐 둔 나 고르기 상자를 접는다.
      state.mePicking = false;
      renderMine();
    }
    renderResultActions();
  }

  function renderResultActions() {
    // 정리본이 없어지면 내 할 일 탭을 볼 수 없으므로 열 수 있는 탭으로 옮긴다.
    if (state.resultTab === "mine" && !state.minutes) return showResultTab(availableTab());
    const mine = state.resultTab === "mine", minutes = state.resultTab === "minutes", name = minutes ? resultLabel() : "전사문";
    const ready = minutes ? Boolean(state.minutes) && !stale() : Boolean(ui.transcript.value.trim());
    ui["tab-mine"].hidden = !state.minutes;
    ui["copy-result"].textContent = `${name} 복사`;
    ui["save-result"].textContent = `${name} 텍스트 파일로 저장`;
    ui["share-result"].textContent = `${name} 공유`;
    // 내 할 일 탭에서는 정리본·전사문을 다루는 단추를 감춘다.
    ui["copy-result"].hidden = mine;
    ui["save-result"].hidden = mine;
    ui["share-result"].hidden = mine || typeof navigator === "undefined" || typeof navigator.share !== "function";
    ui["share-open"].hidden = !mine || !shareReady();
    for (const id of ["copy-result", "save-result", "share-result"]) ui[id].disabled = !ready;
    if (state.transcriptShown !== ui.transcript.value) {
      // 전사문이 바뀐 경우에만 다시 그린다. 긴 전사를 매번 다시 그리지 않는다.
      state.transcriptShown = ui.transcript.value;
      const text = ui.transcript.value.trim();
      ui["transcript-meta"].textContent = text ? `전사 ${Array.from(text).length.toLocaleString("ko-KR")}자 · 녹음에서 인식한 글을 그대로 보여 줍니다. 고치려면 아래 ‘전사 고치기’를 여세요.` : "아직 전사문이 없습니다.";
      ui["transcript-view"].replaceChildren(...text.split(/\n{2,}/).map((paragraph) => element("p", paragraph)));
    }
  }

  function plainText(list) {
    // 메신저·메일에 붙여 넣기 좋게 마크다운 기호를 글머리표로 바꾼다.
    return list.map((line) => line.replace(/^### (.*)/, "· $1").replace(/^## (.*)/, "■ $1").replace(/^# (.*)/, "$1").replace(/^- /, "• "))
      .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function resultText() {
    return state.resultTab === "minutes" ? plainText(lines()) : ui.transcript.value.trim();
  }

  async function writeClipboard(text) {
    // 클립보드에 글을 넣는다. 클립보드 API를 쓸 수 없으면 숨긴 입력칸을 골라 복사하고, 그것도 안 되면 실패로 알린다.
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      (document.querySelector?.("dialog:modal") || document.body).append(area);
      // 창이 떠 있으면 창 밖의 요소는 고를 수 없으므로 그 창 안에 잠깐 둔다.
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw new Error("복사하지 못했습니다. 텍스트 파일로 저장해 주세요.");
    }
  }

  function shareGroups() {
    return Todos.shareGroups(ui.participants.value, currentTodos());
  }

  function shareReady() {
    // 사람별 글은 지금 입력으로 만든 정리본에서만 만든다. 담당자가 있는 남은 일이 한 건도 없으면 보낼 글이 없다.
    return Boolean(state.minutes) && !stale() && shareGroups().length > 0;
  }

  function renderSharePreview(groups) {
    const group = groups.find((entry) => entry.name === state.shareCurrent);
    ui["share-preview-title"].textContent = group ? `${group.name} 님에게 갈 글` : "";
    ui["share-preview"].textContent = group ? Todos.shareText(ui.title.value, ui.date.value, group) : "";
  }

  function renderShare() {
    // 남은 일이 한 건이라도 있는 사람을 한 줄씩 보여 주고, 가리키는 사람에게 갈 글을 아래에 미리 보여 준다.
    const groups = shareGroups(), me = currentMe();
    if (!groups.some((group) => group.name === state.shareCurrent)) state.shareCurrent = groups[0]?.name ?? null;
    ui["share-list"].replaceChildren(...groups.map((group) => {
      const row = element("li", "", "copy-row"), who = element("span", "", "copy-who");
      const copied = state.shareCopied.has(group.name), copy = element("button", copied ? "복사함" : "복사", "button button-outline button-small");
      row.dataset.current = String(group.name === state.shareCurrent);
      if (group.number) who.append(element("b", group.number, "num"));
      who.append(element("span", Todos.sameName(group.name, me?.name) ? `${group.name} (나)` : group.name));
      copy.type = "button";
      copy.dataset.copied = String(copied);
      copy.setAttribute("aria-label", `${group.name} 님 할 일 ${copied ? "다시 복사" : "복사"}`);
      const show = () => {
        if (state.shareCurrent === group.name) return;
        state.shareCurrent = group.name;
        for (const other of ui["share-list"].children) other.dataset.current = String(other === row);
        renderSharePreview(groups);
      };
      row.addEventListener("mouseenter", show);
      copy.addEventListener("focus", show);
      copy.addEventListener("click", async () => {
        show();
        try {
          await writeClipboard(Todos.shareText(ui.title.value, ui.date.value, group));
          state.shareCopied.add(group.name);
          // 단추를 다시 그리지 않고 글자만 바꿔 초점이 그 단추에 남게 한다.
          copy.textContent = "복사함";
          copy.dataset.copied = "true";
          copy.setAttribute("aria-label", `${group.name} 님 할 일 다시 복사`);
          ui["share-status"].textContent = `${group.name} 님 할 일을 복사했습니다. 메신저에 붙여 넣으세요.`;
        } catch { ui["share-status"].textContent = "복사하지 못했습니다. 아래 글을 직접 골라 복사해 주세요."; }
      });
      row.append(who, element("span", `${group.tasks.length}건`, "copy-count"), copy);
      return row;
    }));
    const unassigned = currentTodos().filter((item) => !item.done && !String(item.owner ?? "").trim()).length;
    ui["share-unassigned"].hidden = !unassigned;
    ui["share-unassigned"].textContent = unassigned ? `담당 미정 ${unassigned}건은 누구에게도 가지 않습니다. 정리본에서 담당자를 먼저 맞추세요.` : "";
    renderSharePreview(groups);
  }

  function openShare(opener) {
    // 창을 열 때마다 복사함 표시를 지운다. 누구에게 보냈는지는 저장하지 않는다.
    state.shareCopied = new Set();
    state.shareCurrent = null;
    ui["share-status"].textContent = "";
    renderShare();
    openDialog(ui["share-dialog"], opener);
  }

  async function copyResult() {
    await writeClipboard(resultText());
    ui["result-status"].textContent = `‘${state.resultTab === "minutes" ? resultLabel() : "전사문"}’ 내용을 복사했습니다. 메신저나 메일에 붙여 넣으세요.`;
  }

  function saveResult() {
    const minutes = state.resultTab === "minutes";
    download(new Blob([resultText()], { type: "text/plain;charset=utf-8" }), `${baseName()}-${minutes ? resultLabel().replace(/[\\/:*?"<>|\s]/g, "") : "전사문"}.txt`);
    if (minutes) state.notesSaved = true;
    ui["result-status"].textContent = "텍스트 파일 저장을 시작했습니다.";
  }

  async function shareResult() {
    try { await navigator.share({ title: ui.title.value.trim() || "회의록", text: resultText() }); }
    catch (error) { if (error?.name !== "AbortError") ui["result-status"].textContent = "공유하지 못했습니다. 복사나 파일 저장을 이용하세요."; }
  }

  function documentObject() {
    return {
      ...(state.projectName ? { projectName: state.projectName } : {}),
      title: ui.title.value.trim(),
      date: ui.date.value,
      dailySequence: state.dailySequence,
      participants: ui.participants.value.trim(),
      notes: ui["meeting-notes"].value.trim(),
      transcript: ui.transcript.value,
      partTranscripts: state.parts.map((part, index) => ({
        file: `file${String(index + 1).padStart(3, "0")}`,
        transcript: part.transcript,
      })),
      ...formatFields(),
      ...(state.feedback ? { feedback: state.feedback } : {}),
      minutes: state.minutes,
      analysis: { summaryModel: state.analysisModel || state.summaryModel || null, usage: usageTools().normalize(state.usage), callIds: state.callIds },
    };
  }

  function lines() {
    const data = exportDocument();
    const minutes = data.minutes;
    const head = [
      `# ${data.title || "회의록"}`,
      "",
      ...(data.projectName ? [`프로젝트: ${data.projectName}`] : []),
      `날짜: ${data.date || "미입력"}${data.dailySequence ? ` · ${data.dailySequence}차 회의` : ""}`,
      `참석자: ${data.participants || "미입력"}`,
      "",
    ];
    const action = (item) => `- ${item.task} · 담당 ${item.owner || "미정"} · 기한 ${item.due || "미정"}`;
    const list = (title, items, format = (item) => `- ${item}`) => (items?.length ? [`## ${title}`, ...items.map(format), ""] : []);
    const topics = (title) => (minutes.topics?.length
      ? [`## ${title}`, "", ...minutes.topics.flatMap((topic) => [`### ${topic.title}`, "", ...topic.points.flatMap((point) => [point, ""])])] : []);
    if (data.outputFormat === "custom" && data.customFormat) return [...head, ...Formats.customText(minutes, data.customFormat)];
    if (data.outputFormat === "summary")
      return [...head, "## 핵심 요약", minutes.overview, "", ...topics("주요 내용"), ...list("결정 사항", minutes.decisions),
        ...list("후속 작업", minutes.actions, action), ...list("확인 필요", minutes.openQuestions)];
    if (data.outputFormat === "tasks")
      return [...head, "## 업무 요약", minutes.overview, "", "## 할 일", ...(minutes.actions?.length ? minutes.actions.map(action) : ["- 확인된 할 일 없음"]), "",
        ...list("미확정 항목", minutes.openQuestions), ...list("결정 사항", minutes.decisions), ...topics("참고 내용")];
    return [
      ...head,
      "## 핵심 요약",
      minutes.overview,
      "",
      "## 다음 할 일",
      ...(minutes.actions || []).map(
        (item) =>
          `- ${[item.task, item.owner && `담당 ${item.owner}`, item.due && `기한 ${item.due}`].filter(Boolean).join(" · ")}`,
      ),
      "",
      "## 상세 회의 내용",
      "",
      "## 합의된 방향",
      ...(minutes.decisions || []).flatMap((item) => [item, ""]),
      ...(minutes.topics || []).flatMap((topic) => [
        `## ${topic.title}`,
        "",
        ...topic.points.flatMap((point) => [point, ""]),
        "",
      ]),
      "## 미확정 사항",
      ...(minutes.openQuestions || []).map((item) => `- ${item}`),
      "",
    ];
  }

  function exportDocument() {
    const { projectName, title, date, dailySequence, participants, outputFormat, customFormat, minutes } = documentObject();
    // 복사·저장에는 사람이 고친 할 일을 합친다. 보관하는 AI 결과(documentObject)는 그대로 둔다.
    return { projectName, title, date, dailySequence, participants, outputFormat, ...(customFormat ? { customFormat } : {}), minutes: Todos.apply(minutes, state.todos) };
  }

  function saveMinutes(format) {
    if (!state.minutes || stale()) return;
    const content =
      format === "json" ? JSON.stringify(exportDocument(), null, 2) : lines().join("\n");
    const type =
      format === "json" ? "application/json" : format === "md" ? "text/markdown" : "text/plain";
    download(new Blob([content], { type: `${type};charset=utf-8` }), `${baseName()}.${format}`);
    state.notesSaved = true;
    announce("회의록 다운로드를 시작했습니다. 저장된 파일을 확인하세요.");
  }

  function hasUnsavedWork() {
    return (
      state.permissionPending ||
      Boolean(state.recorders.size) ||
      Boolean(state.aiController) ||
      state.flowBusy || state.archiveBusy || state.historyBusy ||
      state.parts.some((part) => part.blob && !part.saved) ||
      Boolean((ui.transcript.value || state.minutes) && !state.notesSaved) ||
      state.todoPending > 0 || Boolean(state.todoEditing)
    );
  }

  function clearLocal(skipConfirmation = false) {
    if (skipConfirmation !== true && hasUnsavedWork() && !confirm("저장하지 않은 원음과 전사, 회의록이 사라집니다. 계속할까요?"))
      return false;
    state.permissionGeneration++;
    state.permissionPending = false;
    state.aiController?.abort();
    state.aiController = null;
    state.dataGeneration++;
    state.recorder = null;
    state.recordingStopping = true;
    for (const context of state.recorders) {
      context.recorder.ondataavailable = null;
      context.recorder.onstop = null;
      context.recorder.onerror = null;
      if (context.recorder.state !== "inactive") context.recorder.stop();
    }
    state.recorders.clear();
    stopTracks(state.stream);
    state.stream = null;
    stopTimer();
    clearParts();
    resetResult();
    state.recordingId = null;
    state.recordingStored = false;
    state.meetingId = null;
    state.location = "main";
    state.projectName = "";
    state.recordingMetadata = null;
    state.audioStored = false;
    ui["retry-analysis"].hidden = true;
    ui.title.value = "";
    ui.participants.value = "";
    ui["meeting-notes"].value = "";
    ui["record-state"].textContent = "대기";
    ui.timer.textContent = "00:00";
    refresh();
    // 지난 회의를 열면서 화면을 바꿀 때는 지웠다고 알리지 않는다.
    if (skipConfirmation !== true) announce("이 창의 회의 내용을 지웠습니다.");
    return true;
  }

  async function shutdown() {
    if (
      hasUnsavedWork() &&
      !confirm("녹음과 요청을 중단하고 서버를 종료합니다. 필요한 파일을 저장했나요?")
    )
      return;
    state.permissionGeneration++;
    state.aiController?.abort();
    stopRecording();
    stopTracks(state.stream);
    try {
      await api("/api/shutdown", { method: "POST" });
      announce("서버가 종료됐습니다. 창을 닫아도 됩니다.");
      window.removeEventListener("beforeunload", guardClose);
      window.close();
    } catch (error) {
      announce(`서버 종료 상태를 확인하지 못했습니다. ${error.message}`);
    }
  }

  function guardClose(event) {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  async function setKey(apiKey) {
    if (state.keyBusy || settingsLocked()) return;
    const persist = Boolean(apiKey) && ui["persist-key"].checked;
    state.keyBusy = true;
    refresh();
    ui["api-key"].value = "";
    try {
      const result = await api("/api/key", {
        method: "POST",
        body: JSON.stringify({ apiKey, persist }),
        headers: { "Content-Type": "application/json" },
      });
      state.keyConfigured = result.keyConfigured;
      state.keySaved = Boolean(result.keySaved);
      state.keyStorageError = "";
      applyAccess(result);
      if (result.unlocked) announce("기본 키 사용 횟수 제한을 해제했습니다.");
      else announce(
        apiKey
          ? state.keySaved
            ? "API 키를 파일에 저장했습니다. 다음 실행 때 자동으로 불러옵니다."
            : "이번 실행에만 키를 적용했습니다. 기존 저장 파일은 삭제했습니다."
          : "API 키와 저장 파일을 삭제했습니다.",
      );
    } catch (error) {
      announce(error.message);
    } finally {
      state.keyBusy = false;
    }
    refresh();
  }

  async function setMicrophoneVolume() {
    if (state.microphoneBusy || state.permissionPending || state.recorders.size) return;
    state.microphoneBusy = true;
    ui["microphone-status"].textContent = "Windows 기본 마이크 음량을 설정하는 중입니다…";
    refresh();
    try {
      const result = await api("/api/microphone/volume", { method: "POST" });
      ui["microphone-status"].textContent = `${result.name} · 입력 음량 ${result.volume}% · 음소거 해제됨. 짧게 녹음한 뒤 재생해서 목소리를 확인하세요.`;
    } catch (error) {
      ui["microphone-status"].textContent = `설정 실패. ${error.message}`;
    } finally {
      state.microphoneBusy = false;
      refresh();
    }
  }

  function workflow(message, guide = false) {
    state.workflowGuide = guide;
    ui["workflow-status"].textContent = message;
  }

  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function resetMeetingForm(resetDate = true) {
    // 새 회의 양식을 비우고 설정의 기본 출력 형식으로 시작한다. 회의명은 비워 두면 분석할 때 AI가 정한다.
    ui.title.value = "";
    if (resetDate) ui.date.value = today();
    ui["output-format"].value = defaultFormat();
    state.meetingCustom = null;
    workflow("‘회의 시작’을 누르면 바로 녹음합니다. 회의명·참석자·메모는 ‘회의 준비’에서 적을 수 있습니다.", true);
    refresh();
  }

  function closeResultForNewMeeting() {
    // 결과를 닫은 뒤 초점이 목록이 아니라 새 회의 입력으로 가게 한다.
    if (!ui["meeting-detail"].open) return;
    ui["meeting-detail"].returnFocus = ui.title;
    ui["meeting-detail"].close();
  }

  function focusSetup() {
    const target = ui.title.value.trim() ? ui["meeting-notes"] : ui.title;
    target.focus?.();
  }

  function prepareMeeting() {
    if (state.historyBusy || state.flowBusy || state.recorders.size || state.aiController || state.permissionPending) return;
    if (hasMeetingRecord()) {
      if (hasUnsavedWork() && !confirm("저장하지 않은 이전 회의 내용을 비우고 새 회의를 준비할까요?")) return;
      closeResultForNewMeeting();
      clearParts();
      resetResult();
      state.recordingId = null;
      state.recordingStored = false;
      state.meetingId = null;
      state.location = "main";
      state.projectName = "";
      state.recordingMetadata = null;
      state.audioStored = false;
      ui.title.value = "";
      ui["output-format"].value = defaultFormat();
      state.meetingCustom = null;
      ui.date.value = today();
      ui.participants.value = "";
      ui["meeting-notes"].value = "";
      ui["record-state"].textContent = "대기";
      ui.timer.textContent = "00:00";
      ui["retry-analysis"].hidden = true;
      ui["archive-status"].textContent = "회의 종료 후 음성과 회의록을 지난 회의에 보관합니다.";
    }
    state.setupOpen = true;
    refresh();
    focusSetup();
    workflow("필요한 회의 정보만 적고 ‘회의 시작’을 누르세요. 회의명을 비워 두면 AI가 정합니다.", true);
  }

  async function loadHistory() {
    // 모든 보관함의 회의를 한 목록으로 보여 준다. 옛 프로젝트 기록에는 그때 프로젝트 이름을 작게 붙인다.
    try {
      const result = await api("/api/meetings");
      ui["history-status"].textContent = `${result.meetings.length}개 회의${result.skipped ? ` · 읽지 못한 기록 ${result.skipped}개` : ""}`;
      const rows = result.meetings.length ? [] : [element("p", "아직 보관된 회의가 없습니다.")];
      for (const meeting of result.meetings) {
        const button = element("button", "", "history-button");
        button.type = "button";
        const format = outputFormat(meeting.outputFormat);
        const status = [`${meeting.date || "날짜 미입력"} · ${meeting.dailySequence || 1}차`, meeting.analyzed ? (format === "meeting" ? "회의록" : formatLabels[format]) : "분석 대기", `음성 ${meeting.audioCount}개`, meeting.stars && `별 ${meeting.stars}개`];
        const title = meeting.title || "제목 미정 회의";
        const name = element("strong", title), top = element("span", "", "history-top");
        name.title = title;
        top.append(name);
        if (meeting.mineOpen) top.append(element("span", `내 일 ${meeting.mineOpen}`, "mine-count"));
        // 이 회의의 최신 결과에서 내가 아직 안 끝낸 일의 수다. 0이거나 내가 누구인지 모르면 서버가 주지 않는다.
        button.append(top, element("span", status.filter(Boolean).join(" · ")));
        if (meeting.projectName) button.append(element("span", `이전 프로젝트: ${meeting.projectName}`));
        button.dataset.search = `${title} ${meeting.date || ""} ${meeting.projectName || ""}`.toLowerCase();
        button.dataset.meeting = meeting.id;
        if (meeting.recordingId) button.dataset.recording = meeting.recordingId;
        button.dataset.location = meeting.location;
        button.dataset.group = meeting.groupId || "";
        button.addEventListener("click", () => openMeeting(meeting.location, meeting.id, button));
        rows.push(button);
      }
      const top = ui["meeting-history"].scrollTop;
      ui["meeting-history"].replaceChildren(...rows);
      ui["meeting-history"].scrollTop = top;
      // 할 일을 저장할 때마다 목록을 다시 읽으므로, 한 번에 갈고 보던 자리를 되돌려 목록이 맨 위로 튀지 않게 한다.
      filterHistory();
    } catch (error) { ui["history-status"].textContent = `목록 확인 실패. ${error.message}`; }
    refresh();
  }

  function currentGroup() {
    // 지금 열린 회의의 묶음 열쇠다. 녹음이 있으면 녹음 id, 녹음 없이 만든 회의는 처음 결과 id다(서버의 groupKey와 같다).
    return state.recordingId || state.meetingId || state.resultId;
  }

  function historyButtonFor(location, group) {
    // 목록을 다시 그리면 단추가 새로 만들어지므로, 보관함과 묶음 열쇠로 같은 회의의 줄을 다시 찾는다.
    return Array.from(ui["meeting-history"].children).find((button) => button.dataset?.location === location && button.dataset?.group === group) || null;
  }

  function filterHistory() {
    const query = ui["history-search"].value.trim().toLowerCase();
    for (const button of ui["meeting-history"].querySelectorAll("button")) button.hidden = Boolean(query) && !button.dataset.search.includes(query);
  }

  async function openMeeting(location, id, opener, tab = "mine") {
    if (state.historyBusy || state.flowBusy || state.recorders.size || state.aiController || state.reviewBusy || state.copyBusy) return;
    // 저장이 끝나기 전에 회의를 다시 읽으면 저장 전 할 일이 화면에 올라와 저장본과 어긋난다.
    if (state.todoPending) { announce(TODO_NOTICES.saving); return; }
    if (hasUnsavedWork() && !confirm("현재 저장하지 않은 내용을 비우고 지난 회의를 열까요?")) return;
    state.historyBusy = true;
    refresh();
    try {
      const { meeting, versions, review, todos, todosUnreadable, me = null } = await api(`/api/meetings/${location}/${id}`);
      const parts = [];
      for (const audio of meeting.audio || []) {
        const response = await fetch(`/api/recordings/${location}/${meeting.recordingId || id}/audio/${audio.index}`, { headers: { "X-Meeting-Token": state.token } });
        if (!response.ok) throw new Error("저장된 원음을 불러오지 못했습니다.");
        parts.push({ blob: await response.blob(), saved: true, diskSaved: true, transcript: "", applied: Boolean(meeting.transcript) });
      }
      clearLocal(true);
      ui.title.value = meeting.title;
      ui.date.value = meeting.date;
      ui.participants.value = meeting.participants;
      ui["meeting-notes"].value = meeting.notes || "";
      state.meetingCustom = meeting.outputFormat === "custom" ? meeting.customFormat || null : null;
      ui["output-format"].value = outputFormat(meeting.outputFormat);
      ui.transcript.value = meeting.transcript;
      state.parts = parts.map(part => ({ ...part, url: URL.createObjectURL(part.blob) }));
      state.recordingId = meeting.recordingId || (meeting.minutes ? null : id);
      state.recordingStored = Boolean(state.recordingId);
      state.meetingId = state.recordingId ? null : meeting.meetingId || id;
      state.location = location;
      state.projectName = meeting.projectName || "";
      state.recordingMetadata = { title: meeting.title, date: meeting.date, participants: meeting.participants, notes: meeting.notes || "",
        outputFormat: outputFormat(meeting.outputFormat), ...(state.meetingCustom ? { customFormat: state.meetingCustom } : {}) };
      state.audioStored = parts.length > 0 && (!meeting.expectedParts || meeting.expectedParts === parts.length);
      state.minutes = meeting.minutes;
      state.minutesFormat = outputFormat(meeting.outputFormat);
      state.dailySequence = meeting.dailySequence;
      state.resultId = meeting.minutes ? id : null;
      state.resultStored = Boolean(meeting.minutes);
      setSavedTodos(todos);
      state.todoEditing = null;
      state.todoSource = null;
      state.me = me;
      state.mePicking = false;
      state.summarySource = summaryInput();
      state.notesSaved = true;
      state.usage = usageTools().normalize(meeting.analysis?.usage);
      state.callIds = Array.isArray(meeting.analysis?.callIds) ? meeting.analysis.callIds.filter((id) => typeof id === "string") : [];
      state.analysisModel = meeting.analysis?.summaryModel || "";
      state.versions = Array.isArray(versions) ? versions : [];
      state.feedback = meeting.feedback || "";
      state.copies = null;
      clearReview(review || null);
      state.setupOpen = false;
      ui["record-state"].textContent = parts.length ? "보관된 음성" : "대기";
      renderParts();
      renderMinutes();
      ui["retry-analysis"].hidden = Boolean(meeting.minutes) || !state.audioStored;
      ui["archive-status"].textContent = meeting.minutes ? "보관된 회의록입니다." : meeting.transcript ? "음성과 전사 원문은 보관되어 있습니다. 다시 분석하면 전사를 재사용합니다." : "음성은 보관되어 있고 분석은 완료되지 않았습니다.";
      if (meeting.transcript && !meeting.minutes) document.getElementById("transcript-details").open = true;
      openDialog(ui["meeting-detail"], opener, tab);
      ui["result-status"].textContent = todosUnreadable ? "저장된 할 일 수정본을 읽지 못해 AI 결과를 보여 줍니다. 원본 파일은 보존합니다." : "";
      // 창을 열면서 안내 칸을 비우므로, 수정본을 읽지 못했다는 안내는 창을 연 뒤에 적는다.
      workflow(meeting.minutes ? "지난 회의를 불러왔습니다. ‘회의록 보기’에서 결과·내보내기·재분석을 할 수 있습니다." : state.audioStored ? "음성 저장 완료. AI 연결을 확인한 뒤 다시 분석하세요." : "일부 음성 저장이 끝나지 않은 회의입니다. 원래 녹음 창에서 저장을 완료하세요.");
      return true;
    } catch (error) { workflow(error.message); }
    finally { state.historyBusy = false; refresh(); }
  }

  async function archiveResult() {
    if (!state.minutes || stale()) throw new Error("현재 입력으로 회의록을 먼저 분석하세요.");
    state.archiveBusy = true;
    state.resultId ||= newOperationId();
    refresh();
    const document = { ...documentObject(), id: state.resultId, ...(state.recordingStored ? { recordingId: state.recordingId } : state.meetingId ? { meetingId: state.meetingId } : {}), ...(state.todoSource ? { sourceResultId: state.todoSource } : {}) };
    try {
      const saved = await api(`/api/meetings/${state.location}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document) });
      state.dailySequence = saved.meeting?.dailySequence;
      state.resultStored = true;
      state.notesSaved = true;
      // 의견 반영으로 이어받은 수정본이 있으면 받아 오고, 이제 고칠 수 있으므로 할 일을 다시 그린다.
      setSavedTodos(saved.todos);
      renderMinutes();
      // 저장한 결과를 결과 버전 끝에 더하고, 고른 폴더에 쓴 사본 결과를 결과 창에 보여 준다.
      const record = saved.meeting;
      if (record?.id) state.versions = [...state.versions.filter((version) => version.id !== record.id),
        { id: record.id, savedAt: record.savedAt, outputFormat: outputFormat(record.outputFormat), refined: Boolean(record.feedback) }];
      state.copies = saved.copies || null;
      renderVersions();
      ui["archive-status"].textContent = "전사 원문과 회의록 저장 완료";
      await loadHistory();
    } catch (error) {
      ui["archive-status"].textContent = "회의록 저장 실패. 결과는 화면에 남아 있습니다. 저장을 다시 시도하세요.";
      throw error;
    } finally { state.archiveBusy = false; refresh(); }
  }

  function savedLabel(value) {
    try {
      return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
    } catch { return ""; }
  }

  function renderVersions() {
    // 같은 회의의 결과를 저장한 순서대로 보여 주고 지금 열린 결과를 고른 상태로 둔다. 결과가 하나뿐이면 목록을 숨긴다.
    ui["result-version-field"].hidden = state.versions.length < 2;
    ui["result-versions"].replaceChildren(...state.versions.map((version, index) => {
      const option = element("option", [`${index + 1}번째 결과`, savedLabel(version.savedAt), formatLabels[outputFormat(version.outputFormat)],
        version.refined && "의견 반영본", version.stars && `별 ${version.stars}개`].filter(Boolean).join(" · "));
      option.value = version.id;
      return option;
    }));
    ui["result-versions"].value = state.resultId || "";
    ui["refined-badge"].hidden = !state.feedback;
  }

  async function saveReview() {
    // 별점·의견은 결과 파일을 고치지 않고 그 결과의 평가로 따로 저장한다. 요금이 들지 않는다.
    const target = state.resultId;
    const { review } = await api(`/api/meetings/${state.location}/${target}/review`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars: state.reviewStars, comment: ui["review-comment"].value }) });
    if (state.resultId !== target) return review;
    state.review = review;
    state.versions = state.versions.map((version) => (version.id === state.resultId ? { ...version, stars: review.stars ?? undefined } : version));
    ui["review-status"].textContent = "평가를 저장했습니다.";
    renderVersions();
    await loadHistory();
    return review;
  }

  async function refineSummary() {
    // 의견을 먼저 평가로 저장하고, 열린 결과의 전사로 요약만 다시 요청해 새 결과로 저장한다. 원음은 다시 전사하지 않는다.
    const comment = ui["review-comment"].value.trim();
    if (!comment || !state.minutes || !state.resultStored) return;
    if (todoHolding(ui["review-status"])) return;
    const target = state.resultId;
    try { await saveReview(); }
    catch (error) { ui["review-status"].textContent = `평가를 저장하지 못했습니다. ${error.message}`; return; }
    // 평가를 저장하는 사이 다른 결과가 열렸으면 그 결과의 전사로 요약하지 않는다.
    if (state.resultId !== target) return;
    const stop = (message) => { ui["review-status"].textContent = message; announce(message); };
    if (!ui.transcript.value.trim()) return stop("저장된 전사가 없어 의견을 반영할 수 없습니다.");
    if (needsNewKey()) return promptNewKey();
    if (!canAnalyze()) {
      stop("분석할 API 키가 없습니다. 설정에서 API 키를 등록한 뒤 다시 정리하세요.");
      return openSettings("settings-ai");
    }
    ui["review-status"].textContent = "의견을 반영해 다시 정리하고 있습니다.";
    const done = await summarize(true, comment);
    // 새 요약은 받았는데 저장만 실패했으면 화면에 남은 새 결과를 저장하라고 알린다.
    const unsaved = !done && state.resultId !== target && Boolean(state.minutes) && !state.resultStored;
    ui["review-status"].textContent = done
      ? "의견을 반영한 새 결과를 저장했습니다. 앞선 결과는 ‘결과 버전’에서 다시 볼 수 있습니다."
      : unsaved
        ? "다시 정리한 결과를 저장하지 못했습니다. 화면의 새 결과를 확인하고 ‘회의록 저장’을 누르세요. 앞선 결과와 평가는 지워지지 않았습니다."
        : "다시 정리하지 못했습니다. 평가는 저장되어 있고 앞선 결과는 그대로입니다.";
  }

  function runReview(task) {
    if (state.reviewBusy) return;
    state.reviewBusy = true;
    refresh();
    task().catch((error) => { ui["review-status"].textContent = `평가를 저장하지 못했습니다. ${error.message}`; })
      .finally(() => { state.reviewBusy = false; refresh(); });
  }

  const COPY_LABELS = { transcript: "전사문", summaryMd: "요약본(.md)", summaryTxt: "요약본(.txt)", audio: "원음", all: "사본" };

  function copyMessage(report) {
    // 사본 저장 결과를 한 문장으로 알린다. 일부만 실패하면 실패한 종류만 적는다.
    if (!report) return "";
    if (report.failed?.length) {
      // 같은 이유로 실패한 종류는 한 묶음으로 적어 이유가 되풀이되지 않게 한다.
      const groups = new Map();
      for (const item of report.failed) {
        const reason = String(item.message || "").replace(/\.$/, ""), label = COPY_LABELS[item.kind] || "사본";
        if (!groups.has(reason)) groups.set(reason, []);
        if (!groups.get(reason).includes(label)) groups.get(reason).push(label);
      }
      const reasons = [...groups].map(([reason, labels]) => `${labels.join("·")} — ${reason}`);
      return `고른 폴더에 저장하지 못했습니다: ${reasons.join(", ")}. 설정에서 폴더를 확인한 뒤 ‘고른 폴더에 다시 저장’을 누르세요.`;
    }
    const written = [...new Set((report.written || []).map((item) => COPY_LABELS[item.kind]).filter(Boolean))];
    return written.length ? `고른 폴더에 사본을 저장했습니다: ${written.join(", ")}.` : "고른 폴더에 새로 저장할 사본이 없습니다.";
  }

  function renderCopies() {
    // 저장 위치를 하나도 고르지 않았으면 다시 저장 버튼 대신 안내만 보여 준다.
    const configured = STORAGE_KINDS.some((kind) => state.settings?.storage?.[kind]);
    ui["copy-again"].hidden = !configured;
    ui["copy-status"].textContent = configured ? copyMessage(state.copies) : "설정에서 저장 위치를 고르면 사본을 저장할 수 있습니다.";
  }

  async function copyAgain() {
    // 지금 설정된 폴더 기준으로 아직 저장하지 못했거나 사라진 사본만 다시 쓴다.
    if (!state.resultStored || !state.resultId || state.copyBusy) return;
    const target = state.resultId;
    let copies;
    state.copyBusy = true;
    refresh();
    try {
      copies = (await api(`/api/meetings/${state.location}/${target}/copies`, { method: "POST" })).copies;
    } catch (error) {
      copies = { ok: false, written: [], skipped: [], failed: [{ kind: "all", message: error.message }] };
    } finally {
      state.copyBusy = false;
      // 저장을 시작한 결과가 아직 열려 있을 때만 그 결과의 사본 상태로 보여 준다.
      if (state.resultId === target) state.copies = copies;
      refresh();
    }
    if (state.resultId === target && copies?.failed?.length) announce(copyMessage(copies));
  }

  async function finishMeeting() {
    if (state.flowBusy || state.historyBusy || state.archiveBusy || state.aiController) return;
    state.flowBusy = true;
    ui["retry-analysis"].hidden = true;
    const pending = [...state.recorders].map(context => context.done);
    stopRecording();
    refresh();
    try {
      workflow("녹음을 마무리하고 있습니다…");
      await Promise.all(pending);
      if (!state.parts.length || state.parts.some(part => !part.blob?.size)) throw new Error("저장할 음성이 없습니다. 마이크와 녹음 시간을 확인하세요.");
      if (!state.audioStored) {
        // 원음은 기본 보관함의 새 녹음으로만 저장한다. 옛 보관함 회의의 원음이 덜 저장돼 있었다면 새 녹음으로 다시 올린다.
        if (state.location !== "main" || !state.recordingId) { state.recordingId = null; state.recordingStored = false; state.meetingId = null; state.location = "main"; state.projectName = ""; }
        state.recordingId ||= newOperationId();
        state.recordingMetadata ||= recordingMetadata();
        await api(`/api/recordings/main/${state.recordingId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.recordingMetadata, expectedParts: state.parts.length }) });
        state.recordingStored = true;
        for (let i = 0; i < state.parts.length; i++) {
          const part = state.parts[i];
          workflow(`음성 저장 중 · ${i + 1}/${state.parts.length}개`);
          await api(`/api/recordings/main/${state.recordingId}/audio/${i + 1}`, { method: "POST", headers: { "Content-Type": part.blob.type.split(";")[0] || "audio/webm" }, body: part.blob });
          part.saved = true;
          part.diskSaved = true;
        }
        state.audioStored = true;
      }
      ui["record-state"].textContent = "음성 저장 완료";
      renderParts();
      await loadHistory();
      if (needsNewKey()) {
        promptNewKey();
        throw new Error("새로운 API키를 등록하세요.");
      }
      if (!canAnalyze()) throw new Error("음성은 저장했습니다. 아래 ‘설정’에서 API 키를 확인한 뒤 다시 분석하세요.");
      workflow("음성 저장 완료. 전사와 회의록을 분석하고 있습니다…");
      await summarize();
    } catch (error) {
      workflow(`${state.audioStored ? "음성 저장 완료. " : "저장을 완료하지 못했습니다. 창을 닫지 마세요. "}${error.message}`);
      ui["retry-analysis"].hidden = false;
    } finally { state.flowBusy = false; refresh(); }
  }

  function focusables(dialog) {
    return Array.from(dialog.querySelectorAll("button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex='-1'])"))
      .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
  }

  function openDialog(dialog, opener, tab) {
    if (!dialog) return;
    const result = dialog === ui["meeting-detail"];
    // 회의 결과는 가운데 영역에 열려 있어 다른 회의를 고르면 내용만 바꾼다.
    if (result) { renderMinutes(); showResultTab(availableTab(tab)); }
    if (dialog.open) {
      // 목록이나 패널에서 고르면 초점이 결과 밖에 남아 Esc가 닿지 않는다. 안으로 옮기고 닫을 때 돌아갈 곳도 새로 누른 항목으로 바꾼다.
      // 결과 안의 버전 선택에서 온 요청은 불러오는 동안 초점이 잠시 빠질 뿐이므로 돌아갈 곳을 바꾸지 않는다.
      if (!dialog.contains?.(opener) && !dialog.contains?.(document.activeElement)) {
        dialog.returnFocus = opener || dialog.returnFocus;
        dialog.querySelector("[data-close]")?.focus();
      }
      refresh();
      return;
    }
    dialog.returnFocus = opener || document.activeElement;
    refresh();
    if (result) {
      dialog.show();
      ui["desk-work"].inert = true;
    } else dialog.showModal();
    const first = dialog === ui.settings && !state.keyConfigured && !ui["api-key"].disabled ? ui["api-key"] : dialog.querySelector("[data-close]");
    first?.focus();
  }

  function bindDialog(dialog) {
    const inPage = dialog === ui["meeting-detail"];
    // 결과 화면을 닫을 때는 고치던 할 일을 잃지 않게 먼저 확인한다.
    const closeDialog = () => { if (!inPage || !todoHolding()) dialog.close(); };
    dialog.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-close]") || (!inPage && event.target === dialog)) closeDialog();
    });
    dialog.addEventListener("keydown", (event) => {
      // 결과 화면은 팝업이 아니어서 브라우저가 Esc를 처리하지 않는다.
      if (inPage) {
        if (event.key === "Escape" && !event.defaultPrevented) closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (!items.length) return;
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("close", () => {
      if (inPage) { ui["desk-work"].inert = false; refresh(); }
      const opener = dialog.returnFocus;
      dialog.returnFocus = null;
      const target = inPage && opener && !opener.isConnected ? historyButtonFor(state.location, currentGroup()) : opener;
      // 결과를 보는 동안 목록이 다시 그려져 연 단추가 떨어져 나갔으면 같은 회의의 새 줄로 돌아간다.
      // 연 단추가 그 사이 숨었으면(예: 새 버전 표시가 설치 뒤 사라짐) 프로그램 정보는 설정 단추로, 나머지는 회의 준비로 돌아간다.
      if (target?.isConnected && !target.disabled && !target.hidden) target.focus();
      else (dialog === ui.about ? ui["open-settings"] : ui.prepare).focus();
    });
  }

  function applyModels(config) {
    const models = Array.isArray(config.summaryModels) ? config.summaryModels.filter((model) => typeof model?.id === "string" && model.id) : [];
    state.models = models.map((model) => ({ id: model.id, label: String(model.label || model.id), description: String(model.description || "") }));
    const preferred = config.summaryModel ?? (config.summaryModelError ? "" : config.defaultSummaryModel);
    state.summaryModel = state.models.some((model) => model.id === preferred) ? preferred : config.summaryModelError ? "" : state.models[0]?.id || "";
    state.modelError = state.models.length && !state.summaryModel ? String(config.summaryModelError || "저장된 요약 모델을 찾지 못했습니다.") : "";
    ui["summary-model"].replaceChildren();
    if (!state.models.length) ui["summary-model"].append(element("option", "서버 기본 모델"));
    else if (!state.summaryModel) {
      const placeholder = element("option", "모델을 선택하세요");
      placeholder.value = "";
      ui["summary-model"].append(placeholder);
    }
    for (const model of state.models) {
      const option = element("option", model.label);
      option.value = model.id;
      ui["summary-model"].append(option);
    }
    ui["summary-model"].value = state.summaryModel;
  }

  async function saveModel() {
    const id = ui["summary-model"].value;
    if (id === state.summaryModel) return;
    if (settingsLocked() || state.settingsBusy) {
      ui["summary-model"].value = state.summaryModel;
      return announce("녹음이나 분석 중에는 요약 모델을 바꿀 수 없습니다.");
    }
    state.settingsBusy = true;
    refresh();
    try {
      const result = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summaryModel: id }) });
      state.summaryModel = result.settings?.summaryModel || id;
      state.modelError = "";
      announce(`요약 모델을 ${modelInfo()?.label || state.summaryModel}(으)로 저장했습니다. 다음 분석부터 적용합니다.`);
    } catch (error) {
      if (error.code === "NOT_FOUND") {
        state.summaryModel = id;
        state.modelError = "";
        announce("이 서버는 모델 저장을 지원하지 않아 이번 실행에만 적용합니다.");
      } else announce(`요약 모델을 바꾸지 못했습니다. ${error.message}`);
    } finally {
      state.settingsBusy = false;
      ui["summary-model"].value = state.summaryModel;
      refresh();
    }
  }

  const STORAGE_LABELS = { audio: "오디오", transcript: "전사문", summary: "요약본" };
  const SETTINGS_FILE_LIMIT = 128 * 1024;

  function renderSettings() {
    // 설정 창의 기본 출력 형식과 저장 위치를 서버에 저장된 값으로 다시 그린다.
    ui["default-format"].value = outputFormat(state.settings?.defaultOutputFormat || "meeting");
    for (const kind of STORAGE_KINDS) {
      const folder = state.settings?.storage?.[kind] || "";
      ui[`storage-${kind}`].textContent = folder || "사용 안 함";
      ui[`storage-${kind}`].dataset.empty = String(!folder);
    }
  }

  function openSettings(section, opener = ui["open-settings"]) {
    // 설정 창을 열고, 구역을 지정하면 그 구역으로 옮겨 제목에 초점을 둔다. AI 연결은 키 입력칸에 초점을 두는 기본 동작을 따른다.
    if (!ui.settings.open) {
      renderSettings();
      loadEditor();
      openDialog(ui.settings, opener);
    }
    if (!section || section === "settings-ai") return;
    ui[section].scrollIntoView?.({ block: "start" });
    $(`${section}-title`)?.focus?.();
  }

  function followDefaultFormat(before) {
    // 비어 있는 새 회의 양식이 아직 이전 기본 형식이면 새 기본 형식으로 바꾼다. 회의마다 고른 형식은 그대로 두되, 없어진 내 형식은 기본 형식으로 돌린다.
    const blank = !hasMeetingRecord() && !state.meetingCustom;
    if ((blank && ui["output-format"].value === before) || customMissing()) ui["output-format"].value = defaultFormat();
    renderFormatExample();
  }

  async function saveSettingsChange(change, report, success) {
    // 설정 한 가지를 서버에 저장하고 저장된 값으로 창을 다시 그린다. 녹음·분석·저장 중에는 바꾸지 않는다.
    if (settingsLocked() || state.settingsBusy) {
      renderSettings();
      return report("녹음이나 분석 중에는 설정을 바꿀 수 없습니다.");
    }
    state.settingsBusy = true;
    refresh();
    try {
      const result = await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
      state.settings = result.settings;
      report(success());
    } catch (error) {
      report(`설정을 저장하지 못했습니다. ${error.message}`);
    } finally {
      state.settingsBusy = false;
      renderSettings();
      refresh();
    }
  }

  function saveDefaultFormat() {
    const before = defaultFormat();
    const format = outputFormat(ui["default-format"].value);
    return saveSettingsChange({ defaultOutputFormat: format }, announce, () => {
      followDefaultFormat(before);
      return format === "custom" && !state.customFormat
        ? "기본 출력 형식을 내 형식으로 저장했습니다. 내 형식을 저장하기 전까지 새 회의는 회의록으로 시작합니다."
        : `기본 출력 형식을 ${formatLabels[format]}(으)로 저장했습니다. 새 회의부터 이 형식으로 시작합니다.`;
    });
  }

  function saveStorage(kind, folder) {
    const report = (message) => { ui["storage-status"].textContent = message; };
    return saveSettingsChange({ storage: { [kind]: folder } }, report,
      () => (folder ? `${STORAGE_LABELS[kind]} 사본을 고른 폴더에 씁니다.` : `${STORAGE_LABELS[kind]} 사본을 쓰지 않습니다.`));
  }

  function onHostMessage(data) {
    // Windows 창이 폴더 선택 결과를 돌려준다. 고르지 않고 닫았거나(path가 null) 모르는 메시지는 무시한다.
    if (data?.type !== "folder-picked" || !STORAGE_KINDS.includes(data.kind) || typeof data.path !== "string" || !data.path) return;
    saveStorage(data.kind, data.path);
  }

  async function exportSettings() {
    const { file } = await api("/api/settings/export");
    download(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: "application/json;charset=utf-8" }), `${today()}-VoiceNote-설정.json`);
    ui["settings-file-status"].textContent = "설정 파일 내려받기를 시작했습니다. 저장된 파일을 확인하세요.";
  }

  let settingsPreviewGeneration = 0;

  async function previewSettings(event) {
    // 고른 파일의 크기와 UTF-8을 이 화면에서 먼저 확인하고, 통과한 글만 서버에 보내 바뀔 내용을 받아 보여 준다.
    // 파일을 여러 번 고르면 마지막에 고른 파일만 남긴다. 늦게 온 앞 파일의 응답은 미리보기와 적용할 파일을 바꾸지 않는다.
    const generation = ++settingsPreviewGeneration;
    const latest = () => generation === settingsPreviewGeneration;
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const report = (message) => { if (latest()) ui["settings-file-status"].textContent = message; };
    if (file.size > SETTINGS_FILE_LIMIT) return report("설정 파일이 128KiB보다 커서 불러올 수 없습니다.");
    let bytes, text;
    try { bytes = await file.arrayBuffer(); } catch { return report("설정 파일을 읽지 못했습니다. 파일을 다시 골라 주세요."); }
    // BOM은 서버의 해석기가 바이트로 받을 때처럼 하나만 지우므로, 여기서는 지우지 않고 그대로 보낸다.
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return report("설정 파일이 UTF-8로 저장되어 있지 않아 불러올 수 없습니다."); }
    if (!latest()) return;
    try {
      const { preview } = await api("/api/settings/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: text }) });
      if (!latest()) return;
      renderSettingsPreview(preview);
      report("");
      openDialog(ui["settings-import"], ui["import-settings"]);
      state.pendingSettings = text;
    } catch (error) { report(error.message); }
  }

  function renderSettingsPreview(preview) {
    // 파일을 적용하면 바뀔 값을 항목마다 한 줄로 보이고, 적용하지 않는 줄에는 그 이유를 붙인다.
    const rows = [
      ["요약 모델", modelInfo(preview.summaryModel.value)?.label || preview.summaryModel.value, preview.summaryModel],
      ["기본 출력 형식", formatLabels[preview.defaultOutputFormat.value] || preview.defaultOutputFormat.value, preview.defaultOutputFormat],
      ["내 형식", preview.customFormat.name || (state.customFormat ? "없음 · 지금 저장된 내 형식을 지웁니다" : "없음"), preview.customFormat],
      ...(preview.storage
        ? STORAGE_KINDS.map((kind) => [`${STORAGE_LABELS[kind]} 저장 위치`, preview.storage[kind]?.value || "사용 안 함", preview.storage[kind] || { apply: true }])
        : [["저장 위치", "파일에 없어 지금 값을 그대로 둡니다", { apply: true }]]),
    ];
    ui["settings-preview"].replaceChildren(...rows.map(([label, value, item]) => {
      const row = element("div", "", "preview-row");
      row.append(element("dt", label), element("dd", value));
      if (!item.apply) {
        row.dataset.skip = "true";
        row.append(element("dd", item.reason || "적용하지 않습니다.", "preview-skip"));
      }
      return row;
    }));
  }

  async function applyImportedSettings() {
    // 미리보기에서 확인한 파일을 서버가 같은 규칙으로 다시 검사해 적용한다. 적용하지 않은 항목은 이유와 함께 알린다.
    const file = state.pendingSettings;
    if (!file) return;
    const report = (message) => { ui["settings-file-status"].textContent = message; };
    if (settingsLocked() || state.settingsBusy) return report("녹음이나 분석 중에는 설정을 바꿀 수 없습니다.");
    const before = defaultFormat();
    state.settingsBusy = true;
    refresh();
    try {
      const result = await api("/api/settings/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) });
      state.settings = result.settings;
      state.customFormat = result.customFormat || null;
      if (result.settings?.summaryModel) {
        state.summaryModel = result.settings.summaryModel;
        state.modelError = "";
      }
      updateCustomOption();
      loadEditor();
      followDefaultFormat(before);
      ui["settings-import"].close();
      report(result.skipped?.length ? `설정을 불러왔습니다. 적용하지 않은 항목: ${result.skipped.join(" · ")}` : "설정을 불러왔습니다.");
    } catch (error) {
      ui["settings-import"].close();
      report(`설정을 불러오지 못했습니다. ${error.message}`);
    } finally {
      state.settingsBusy = false;
      ui["summary-model"].value = state.summaryModel;
      renderSettings();
      refresh();
    }
  }

  // 앱 업데이트와 프로그램 정보. 서버가 확인·받기·설치 시작을 맡고, 화면은 상태를 보여 주며 회의를 잃지 않게 설치 시작만 막는다.
  const Notes = window.VoiceNoteReleaseNotes || { NOTES: [], find: () => null, dateLabel: () => "" };
  const megabytes = (bytes) => `${(Number(bytes) / 1_048_576).toFixed(1)} MB`;
  // 같은 글을 다시 넣지 않아야 상태 알림(role=status)이 같은 문장을 반복해 읽지 않는다.
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const publishedText = (value) => {
    try { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(value)); }
    catch { return ""; }
  };

  // 지금 설치를 시작할 수 없는 이유다. 받기는 막지 않고, 창이 닫히는 설치 시작만 막는다.
  function updateBlockers() {
    if (state.recorders.size || state.permissionPending || state.recorder) return ["녹음 중에는 설치할 수 없습니다. 회의를 마친 뒤 설치하세요."];
    if (state.aiController || state.flowBusy || state.archiveBusy) return ["분석과 저장이 끝난 뒤 설치하세요."];
    if (state.historyBusy) return ["지난 회의를 불러오는 중입니다. 잠시 뒤 다시 누르세요."];
    if (state.parts.some((part) => part.blob && !part.saved) || Boolean((ui.transcript.value || state.minutes) && !state.notesSaved))
      return ["저장하지 않은 회의 내용이 있습니다. 회의록을 저장하거나 내려받은 뒤 설치하세요."];
    // 업데이트하면 창이 닫히므로 저장 중인 요청과 아직 저장하지 않은 입력도 지켜 준다.
    if (state.settingsBusy || state.keyBusy || state.reviewBusy || state.copyBusy || state.customBusy) return ["설정이나 평가를 저장하는 중입니다. 저장이 끝난 뒤 설치하세요."];
    if (state.todoPending > 0) return ["할 일을 저장하는 중입니다. 저장이 끝난 뒤 설치하세요."];
    if (state.todoEditing) return ["고치던 할 일을 저장하거나 취소한 뒤 설치하세요."];
    if (ui["settings-import"].open) return ["설정 불러오기 확인을 먼저 마치세요."];
    if (reviewChanged()) return ["평가 의견을 저장하거나 지운 뒤 설치하세요."];
    if (customChanged()) return ["내 형식 변경을 저장한 뒤 설치하세요."];
    if (ui["api-key"].value.trim()) return ["입력한 API 키를 등록하거나 지운 뒤 설치하세요."];
    return [];
  }

  // 평가 칸에 저장한 것과 다른 별점이나 의견이 있는지 본다. 평가 칸이 보일 때(저장된 결과)만 따진다.
  function reviewChanged() {
    if (ui.review.hidden) return false;
    const comment = ui["review-comment"].value.trim();
    // 별점과 의견을 모두 비운 것은 저장할 수 없는 상태(저장 단추가 잠김)라 지켜야 할 입력으로 보지 않는다.
    if (state.reviewStars === null && !comment) return false;
    return state.reviewStars !== (state.review?.stars ?? null) || comment !== (state.review?.comment || "").trim();
  }

  // 내 형식 편집 칸을 마지막으로 불러온 뒤 고쳤는지 본다. 설정 창을 열 때마다 저장된 값으로 다시 불러오므로 창이 열려 있을 때만 따진다.
  function editorSnapshot() {
    return JSON.stringify([ui["custom-name"].value, ui["custom-instruction"].value, state.customRows || []]);
  }
  function customChanged() {
    return ui.settings.open && state.editorBaseline !== null && editorSnapshot() !== state.editorBaseline;
  }

  // 회의를 시작하기 전 회의 준비에 적은 내용이다. 이 화면은 준비 내용을 따로 저장하지 않아 창이 닫히면 사라진다.
  function preparedText() {
    return !hasMeetingRecord() && Boolean(ui.title.value.trim() || ui.participants.value.trim() || ui["meeting-notes"].value.trim());
  }

  function applyUpdate(update) {
    if (!update || typeof update.status !== "string") return;
    const before = state.update?.status;
    state.update = update;
    // 상태를 다시 받았으면 조회 실패로 멈춘 상태를 푼다.
    if (state.updatePollFailures) {
      if (updateStalled()) state.updateError = "";
      state.updatePollFailures = 0;
    }
    // 지난 업데이트 결과(설치 완료·되돌림)는 이번 실행에서 한 번만 알린다.
    if (update.lastResult?.message && !state.updateNotified) {
      state.updateNotified = true;
      announce(update.lastResult.message);
    }
    if (update.status === "available" && update.error) state.updateIntent = false;
    renderUpdate();
    clearTimeout(state.updatePoll);
    if (["checking", "downloading"].includes(update.status)) state.updatePoll = setTimeout(loadUpdate, state.updatePollMs);
    else if (update.status === "ready" && before !== "ready" && state.updateIntent) launchUpdate();
  }

  // 확인·받기를 따라가다 상태 조회가 실패하면 간격을 두 배씩 늘려 다섯 번까지만 다시 묻는다. 그 뒤로는 멈춘 상태다.
  // 화면 갱신이 먼저 부를 수 있어 함수 선언으로 둔다.
  function updateStalled() { return state.updatePollFailures > 5; }

  async function loadUpdate() {
    // 업데이트 확인이 실패해도 회의 준비와 녹음은 막지 않는다. 이유는 프로그램 정보에서 본다.
    let update;
    try { update = (await api("/api/update")).update; }
    catch {
      const following = ["checking", "downloading"].includes(state.update?.status ?? "checking");
      if (!following || updateStalled()) return;
      state.updatePollFailures += 1;
      clearTimeout(state.updatePoll);
      if (!updateStalled()) state.updatePoll = setTimeout(loadUpdate, state.updatePollMs * 2 ** state.updatePollFailures);
      else {
        // 더 묻지 않고, 사람이 다시 확인을 눌러 상태를 다시 받게 한다. 받는 중이면 서버는 받기를 이어 가며 지금 상태만 돌려준다.
        state.updateError = "업데이트 진행 상태를 불러오지 못했습니다. 다시 확인을 눌러 주세요.";
        renderUpdate();
      }
      return;
    }
    applyUpdate(update);
  }

  function showUpdateError(message) {
    state.updateError = message;
    renderUpdate();
    announce(message);
  }

  async function checkUpdate() {
    state.updateError = "";
    try { applyUpdate((await api("/api/update/check", { method: "POST" })).update); }
    catch (error) { showUpdateError(error.message); }
  }

  async function startUpdate() {
    const update = state.update;
    if (!update || state.updateLaunching) return;
    state.updateError = "";
    if (update.status === "ready") return launchUpdate();
    if (update.status !== "available") return;
    // 한 번 누르면 받은 뒤 설치까지 이어 간다. 받는 동안 녹음을 시작하거나 저장하지 않은 내용이 생기면 설치는 그 뒤로 미룬다.
    state.updateIntent = updateBlockers().length === 0;
    try { applyUpdate((await api("/api/update/download", { method: "POST" })).update); }
    catch (error) {
      state.updateIntent = false;
      showUpdateError(error.message);
    }
  }

  async function launchUpdate() {
    if (state.updateLaunching || state.update?.status !== "ready") return;
    const reasons = updateBlockers();
    if (reasons.length || (preparedText() && !confirm("회의 준비에 적은 회의명·참석자·메모는 업데이트하면 사라집니다. 계속할까요?"))) {
      state.updateIntent = false;
      renderUpdate();
      return;
    }
    // 누른 순간부터 새 녹음·분석·불러오기를 막는다. 서버도 설치를 시작하는 동안 새 AI 요청을 받지 않는다.
    state.updateLaunching = true;
    state.updateIntent = false;
    state.updateError = "";
    refresh();
    try {
      applyUpdate((await api("/api/update/launch", { method: "POST" })).update);
      // 창을 닫아야 설치가 이어진다. 안내를 잠깐 보여 준 뒤 미저장 확인 없이 닫는다.
      window.removeEventListener("beforeunload", guardClose);
      setTimeout(() => window.close(), 1200);
    } catch (error) {
      state.updateLaunching = false;
      refresh();
      showUpdateError(error.message);
      await loadUpdate();
    }
  }

  function renderUpdate() {
    const update = state.update || { status: "checking", currentVersion: "", version: null, size: null, received: 0 };
    const status = state.updateLaunching && update.status === "ready" ? "starting" : update.status;
    const version = update.version || "";
    const blockers = ["available", "ready"].includes(status) ? updateBlockers() : [];
    const percent = update.size ? Math.min(100, Math.round((update.received / update.size) * 100)) : 0;
    // 상단 표시는 새 버전이 있을 때만 보인다. 받는 중에는 받은 정도를 짧게 보여 준다.
    const chip = { available: `새 버전 ${version}`, manual: `새 버전 ${version}`, downloading: `받는 중 ${percent}%`, ready: "설치 준비됨", starting: "설치 준비 중", launching: "설치 중" }[status] || "";
    ui["update-chip"].hidden = !chip;
    if (chip) {
      setText(ui["update-chip-label"], chip);
      ui["update-chip"].setAttribute("aria-label", `${chip}, 프로그램 정보 열기`);
    }
    const facts = [update.publishedAt && `${publishedText(update.publishedAt)} 게시`, update.size && megabytes(update.size)].filter(Boolean).join(" · ");
    const message = {
      unsupported: "이 실행에서는 새 버전을 확인하지 않습니다. 설치한 VoiceNote에서 확인할 수 있습니다.",
      latest: `지금 쓰는 ${update.currentVersion} 버전이 최신입니다.`,
      unknown: update.error?.message || "새 버전을 확인하지 못했습니다. 잠시 뒤 다시 확인을 눌러 주세요.",
      available: `${version} 버전이 나왔습니다.${facts ? ` (${facts})` : ""}`,
      manual: `${version} 버전이 나왔지만 앱에서 바로 설치할 수 없습니다.`,
      downloading: `${version} 버전을 받는 중입니다.`,
      ready: `${version} 버전을 받았습니다. 설치하면 VoiceNote가 닫혔다가 다시 열립니다.`,
      starting: "설치를 준비하는 중입니다. 창을 닫지 마세요.",
      launching: "설치를 시작했습니다. 잠시 뒤 VoiceNote가 닫혔다가 다시 열립니다.",
    }[status] || "새 버전을 확인하는 중입니다.";
    setText(ui["update-state"], message);
    ui["about-update"].dataset.status = status;
    // 받은 양은 상태 알림과 따로 두어 화면 읽기 프로그램이 진행률마다 읽지 않게 한다.
    ui["update-progress-row"].hidden = status !== "downloading";
    if (status === "downloading") {
      ui["update-progress"].value = percent;
      setText(ui["update-progress-text"], `${megabytes(update.received)} / ${megabytes(update.size)}`);
    }
    const detail = state.updateError ? { text: state.updateError, tone: "error" }
      : update.error && status !== "unknown" ? { text: update.error.message, tone: status === "manual" ? "info" : "error" }
        : update.lastResult?.message ? { text: update.lastResult.message, tone: update.lastResult.outcome === "installed" ? "info" : "error" } : null;
    ui["update-detail"].hidden = !detail;
    if (detail) {
      setText(ui["update-detail"], detail.text);
      ui["update-detail"].dataset.tone = detail.tone;
    }
    // 설치를 지금 못 하는 이유는 단추 가까이에 계속 보인다. 새 버전이 있을 때 누르면 받아 두기만 한다.
    ui["update-lock"].hidden = !blockers.length;
    if (blockers.length) setText(ui["update-lock"], status === "available" ? `${blockers[0]} 지금 누르면 받아 두기만 합니다.` : blockers[0]);
    ui["update-install"].hidden = !["available", "ready", "starting"].includes(status);
    setText(ui["update-install"], status === "available" ? (blockers.length ? "받아 두기" : "지금 업데이트") : "설치 시작");
    ui["update-install"].disabled = status === "starting" || (status === "ready" && blockers.length > 0);
    // 다시 확인은 받기·설치가 진행 중일 때는 쓸 수 없으므로 숨기고, 확인 중에만 잠가 둔다.
    // 상태 조회가 계속 실패해 따라가기를 멈췄으면 다시 묻는 단추로 보인다.
    const stalled = updateStalled();
    ui["update-check"].hidden = !stalled && ["unsupported", "downloading", "ready", "starting", "launching"].includes(status);
    ui["update-check"].disabled = !stalled && ["idle", "checking"].includes(status);
    ui["update-note"].hidden = !["available", "downloading", "ready", "starting"].includes(status);
  }

  function renderAbout() {
    // 지금 버전과 그 버전의 배포일, 그리고 버전별 바뀐 점을 최신 버전부터 보여 준다.
    const version = state.update?.currentVersion || "";
    const note = Notes.find(version);
    const date = note ? Notes.dateLabel(note.date) : "";
    setText(ui["about-version"], version);
    setText(ui["about-version-meta"], version ? `지금 쓰는 버전${date ? ` · ${date} 배포` : ""}` : "버전 정보를 불러오지 못했습니다.");
    ui["release-list"].replaceChildren(...Notes.NOTES.map((entry) => {
      const item = element("li", "", "release");
      item.dataset.current = String(entry.version === version);
      const head = element("div", "", "release-head");
      head.append(element("span", entry.version, "release-version"));
      const when = Notes.dateLabel(entry.date);
      if (when) head.append(element("span", when, "release-date"));
      if (entry.version === version) head.append(element("span", "지금 버전", "release-badge"));
      const list = element("ul", "", "release-items");
      list.append(...entry.items.map((text) => element("li", text)));
      item.append(head, element("p", entry.title, "release-title"), list);
      return item;
    }));
  }

  function openAbout(opener) {
    renderAbout();
    renderUpdate();
    openDialog(ui.about, opener);
  }

  function bind() {
    ui.prepare.addEventListener("click", prepareMeeting);
    ui["history-search"].addEventListener("input", filterHistory);
    document.addEventListener?.("keydown", (event) => {
      if (event.ctrlKey && event.key?.toLowerCase() === "k") { event.preventDefault(); ui["history-search"].focus(); }
    });
    ui["retry-analysis"].addEventListener("click", finishMeeting);
    ui["save-archive"].addEventListener("click", () => archiveResult().catch(error => workflow(error.message)));
    ui["microphone-volume"].addEventListener("click", setMicrophoneVolume);
    ui.start.addEventListener("click", startRecording);
    ui["cancel-permission"].addEventListener("click", cancelPermission);
    ui.stop.addEventListener("click", finishMeeting);
    ui["audio-file"].addEventListener("change", importAudio);
    ui.transcribe.addEventListener("click", () => { if (!todoHolding()) transcribe(); });
    ui.summarize.addEventListener("click", () => { if (!todoHolding()) summarize(true); });
    document.getElementById("save-transcript").addEventListener("click", () => {
      if (!ui.transcript.value.trim()) return announce("저장할 전사 원문이 없습니다.");
      download(new Blob([ui.transcript.value], { type: "text/plain;charset=utf-8" }), `${baseName()}-전사원문.txt`);
      announce("전사 원문 다운로드를 시작했습니다. 저장된 파일을 확인하세요.");
    });
    ui["cancel-ai"].addEventListener("click", () => state.aiController?.abort());
    for (const id of ["transcript", "title", "date", "participants", "meeting-notes"])
      ui[id].addEventListener("input", () => {
        state.resultStored = false;
        state.notesSaved = false;
        refresh();
      });
    ui["key-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      const key = ui["api-key"].value.trim();
      if (!key) {
        announce("등록할 API 키를 입력하세요.");
        ui["api-key"].focus();
        return;
      }
      setKey(key);
    });
    ui["remove-key"].addEventListener("click", () => {
      if (confirm("등록된 API 키와 이 PC에 저장된 키 파일을 삭제할까요?")) setKey("");
    });
    ui["summary-model"].addEventListener("change", saveModel);
    ui["open-settings"].addEventListener("click", () => openSettings());
    ui["open-format-settings"].addEventListener("click", () => openSettings("settings-format", ui["open-format-settings"]));
    ui["open-result"].addEventListener("click", () => openDialog(ui["meeting-detail"], ui["open-result"]));
    for (const name of RESULT_TABS) {
      ui[`tab-${name}`].addEventListener("click", () => showResultTab(name));
      ui[`tab-${name}`].addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        // 좌우 화살표는 보이는 탭만 돈다.
        const order = RESULT_TABS.filter((item) => !ui[`tab-${item}`].hidden);
        const next = order[(order.indexOf(state.resultTab) + step + order.length) % order.length];
        showResultTab(next);
        ui[`tab-${next}`].focus();
      });
    }
    ui["copy-result"].addEventListener("click", () => copyResult().catch((error) => { ui["result-status"].textContent = error.message; }));
    ui["save-result"].addEventListener("click", saveResult);
    ui["share-result"].addEventListener("click", shareResult);
    ui["setup-close"].addEventListener("click", () => {
      state.setupOpen = false;
      refresh();
      ui.prepare.focus();
    });
    for (const dialog of [ui["meeting-detail"], ui.settings, ui["settings-import"], ui.about, ui["share-dialog"]]) bindDialog(dialog);
    ui["share-open"].addEventListener("click", () => openShare(ui["share-open"]));
    ui["update-chip"].addEventListener("click", () => openAbout(ui["update-chip"]));
    ui["open-about"].addEventListener("click", () => openAbout(ui["open-about"]));
    ui["update-install"].addEventListener("click", startUpdate);
    ui["update-check"].addEventListener("click", checkUpdate);
    ui["output-format"].addEventListener("change", () => {
      state.resultStored = false;
      state.notesSaved = false;
      renderFormatExample();
      refresh();
    });
    ui["format-help"].addEventListener("click", () => {
      ui["format-example"].hidden = !ui["format-example"].hidden;
      renderFormatExample();
    });
    ui["custom-name"].addEventListener("input", renderCustomPreview);
    ui["custom-instruction"].addEventListener("input", renderCustomPreview);
    ui["custom-save"].addEventListener("click", () => saveCustom().catch((error) => { ui["custom-status"].textContent = error.message; }));
    ui["custom-delete"].addEventListener("click", () => deleteCustom().catch((error) => { ui["custom-status"].textContent = error.message; }));
    ui.settings.addEventListener("close", () => { ui["api-key"].value = ""; });
    ui["default-format"].addEventListener("change", saveDefaultFormat);
    for (const kind of STORAGE_KINDS) {
      ui[`pick-${kind}`].addEventListener("click", () => window.chrome?.webview?.postMessage({ type: "pick-folder", kind }));
      ui[`clear-${kind}`].addEventListener("click", () => saveStorage(kind, ""));
    }
    ui["export-settings"].addEventListener("click", () => exportSettings().catch((error) => { ui["settings-file-status"].textContent = `설정을 내보내지 못했습니다. ${error.message}`; }));
    ui["import-settings"].addEventListener("click", () => ui["settings-file-input"].click());
    ui["settings-file-input"].addEventListener("change", previewSettings);
    ui["confirm-import"].addEventListener("click", applyImportedSettings);
    for (let stars = 1; stars <= 5; stars++) ui[`review-star-${stars}`].addEventListener("click", () => {
      // 같은 별을 다시 누르면 별점을 지운다. 별점은 고르지 않아도 된다.
      state.reviewStars = state.reviewStars === stars ? null : stars;
      refresh();
    });
    ui["review-comment"].addEventListener("input", refresh);
    ui["save-review"].addEventListener("click", () => runReview(saveReview));
    ui.refine.addEventListener("click", () => runReview(refineSummary));
    ui["copy-again"].addEventListener("click", copyAgain);
    ui["result-versions"].addEventListener("change", async () => {
      const id = ui["result-versions"].value;
      await openMeeting(state.location, id, ui["result-versions"], state.resultTab);
      renderVersions();
      // 불러오는 동안 select가 잠겨 초점을 잃으므로 되돌린다.
      ui["result-versions"].focus();
      if (state.resultId === id) announce("고른 결과 버전을 열었습니다. 이 결과의 평가와 사본 저장은 이 결과에 적용됩니다.");
    });
    ui["settings-import"].addEventListener("close", () => { state.pendingSettings = null; });
    // 폴더 고르기와 회의자료 폴더 열기는 Windows 창 안에서만 쓸 수 있다. 창은 폴더 선택 결과를 메시지로 돌려준다.
    const webview = window.chrome?.webview;
    ui["settings-data"].hidden = !webview;
    for (const kind of STORAGE_KINDS) ui[`pick-${kind}`].hidden = !webview;
    ui["open-data-folder"].addEventListener("click", () => webview?.postMessage("open-data-folder"));
    // 깃허브 릴리즈 페이지는 Windows 창이 정해 둔 주소로만 기본 브라우저에서 연다. 창 밖(개발용 브라우저)에서는 숨긴다.
    ui["update-page"].hidden = !webview;
    ui["update-page"].addEventListener("click", () => webview?.postMessage("open-update-page"));
    webview?.addEventListener("message", (event) => onHostMessage(event.data));
    ui.clear.addEventListener("click", () => {
      if (!clearLocal()) return;
      // 결과가 열려 있었으면 닫고 빈 새 회의 입력으로 돌아간다.
      closeResultForNewMeeting();
      resetMeetingForm();
      state.setupOpen = true;
      refresh();
    });
    ui.shutdown.addEventListener("click", shutdown);
    for (const format of ["md", "txt", "json"])
      ui[`download-${format}`].addEventListener("click", () => saveMinutes(format));
    window.addEventListener("beforeunload", guardClose);
  }

  async function init() {
    try {
      state.token = readToken();
    } catch {
      announce("이 창에서 인증 토큰을 보관할 수 없습니다.");
      return;
    }
    ui.date.value = today();
    bind();
    refresh();
    if (!state.token) return announce("실행 도구가 제공한 주소로 창을 다시 열어 주세요.");
    try {
      const config = await api("/api/config");
      state.settings = config.settings || null;
      state.keyConfigured = Boolean(config.keyConfigured);
      state.keySaved = Boolean(config.keySaved);
      state.keyStorageError = config.keyStorageError || "";
      state.maxAudioBytes = config.maxAudioBytes || state.maxAudioBytes;
      state.maxMinutes = config.maxMinutes || state.maxMinutes;
      applyAccess(config);
      applyModels(config);
      state.customFormat = (await api("/api/custom-format")).customFormat;
      updateCustomOption();
      resetMeetingForm();
      state.setupOpen = true;
      await loadHistory();
      refresh();
      announce(canAnalyze() ? "‘회의 시작’을 누르면 바로 녹음합니다." : state.access.accessMode === "exhausted" ? "새로운 API키를 등록하세요." : "처음이면 아래 ‘설정’에서 API 키를 등록하세요.");
      // 새 버전 확인은 회의 준비를 기다리게 하지 않도록 맨 마지막에 따로 시작한다.
      loadUpdate();
    } catch (error) {
      announce(`서버 연결을 확인하지 못했습니다. ${error.message}`);
    }
  }

  window.meetingDesktopStatus = () => ({ unsaved: hasUnsavedWork() });
  init();
})();
