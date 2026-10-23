// 회의 녹음과 전사 및 회의록의 브라우저 내 상태를 관리한다.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries(
    [
      "title",
      "project-presets", "project-name", "selected-project", "save-preset", "delete-preset", "prepare",
      "workflow-status", "meeting-setup", "retry-analysis", "archive-status", "save-archive",
      "history-status", "meeting-history",
      "date",
      "participants",
      "meeting-context",
      "record-consent",
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
      "ai-consent",
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
      "meeting-notes", "start-hint", "stage", "header-project", "open-ai-settings", "ai-status-label",
      "summary-model", "model-help", "settings-lock", "meeting-detail", "ai-settings", "detail-title",
      "detail-meta", "usage", "open-result", "open-result-label", "setup-close", "meeting-heading", "key-form",
      "output-format", "export-settings", "import-settings", "settings-file", "settings-import", "settings-preview", "settings-import-file", "confirm-import",
      "format-help", "format-example", "format-example-title", "format-example-text", "format-example-body", "custom-editor", "custom-name",
      "custom-section-list", "custom-instruction", "custom-save", "custom-delete", "custom-status",
      "tab-minutes", "tab-transcript", "panel-minutes", "panel-transcript", "transcript-view", "transcript-meta", "copy-result", "share-result", "save-result", "result-status",
    ].map((id) => [id, $(id)]),
  );
  const Formats = window.MeetingFormats;
  const formatLabels = Formats.LABELS;
  const outputFormat = (value) => (Object.hasOwn(formatLabels, value) ? value : "meeting");
  const maxSettingsBytes = 128 * 1024;
  const state = {
    token: "",
    projects: [], slot: 1, setupOpen: false, projectBusy: false, flowBusy: false, archiveBusy: false,
    meetingId: null, resultId: null, recordingMetadata: null, audioStored: false, resultStored: false,
    keyConfigured: false,
    keySaved: false,
    keyStorageError: "",
    keyBusy: false,
    settingsBusy: false,
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
    pendingImport: null,
    minutesFormat: null,
    // customFormat은 저장된 내 형식, meetingCustom은 다시 연 회의에 기록된 당시 내 형식이다.
    customFormat: null,
    meetingCustom: null,
    resultTab: "minutes",
    transcriptShown: null,
    access: { accessMode: "none", trialLimit: 3, trialRemaining: 0, mustRegister: true, unlocked: false, trialError: "" },
    analysisId: null,
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

  // 체험을 모두 쓴 뒤에도 분석 버튼은 눌리게 두고, 누르면 새 키 등록 안내와 AI 설정을 연다.
  function needsNewKey() {
    return !state.keyConfigured && state.access.accessMode === "exhausted";
  }

  function promptNewKey() {
    announce("새로운 API키를 등록하세요.");
    if (!ui["ai-settings"].open) openDialog(ui["ai-settings"], ui["open-ai-settings"]);
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

  function rememberFormat(slot, value) {
    try { localStorage.setItem(`voicenote.outputFormat.${slot}`, value); } catch {}
  }

  function rememberedFormat(project) {
    let value = null;
    try { value = localStorage.getItem(`voicenote.outputFormat.${project.slot}`); } catch {}
    const format = outputFormat(value || project.outputFormat);
    return format === "custom" && !state.customFormat ? "meeting" : format;
  }

  function updateCustomOption() {
    const option = ui["output-format"].querySelector('option[value="custom"]');
    option.textContent = state.customFormat ? `내 형식 · ${state.customFormat.name}` : "내 형식 (새로 만들기)";
  }

  function renderFormatExample() {
    // 고른 형식으로 가상의 회의를 정리한 모습을 같은 화면 그리기 함수로 보여 준다.
    const open = !ui["format-example"].hidden;
    ui["format-help"].setAttribute("aria-expanded", String(open));
    ui["format-help"].textContent = open ? "예시 닫기" : "예시 보기";
    if (!open) return;
    const format = outputFormat(ui["output-format"].value);
    const preview = format === "custom" ? editorValue(false) : null;
    ui["format-example-title"].textContent = `${format === "custom" ? preview?.name || "내 형식" : formatLabels[format]} 예시`;
    ui["format-example-text"].textContent = `${Formats.DESCRIPTIONS[format]} 아래는 가상의 회의로 만든 예시입니다.`;
    ui["custom-editor"].hidden = format !== "custom";
    ui["format-example-body"].replaceChildren();
    if (format === "custom" && !preview) ui["format-example-body"].append(element("p", "항목을 하나 이상 고르면 예시가 보입니다.", "muted"));
    else renderMinutesInto(ui["format-example-body"], Formats.SAMPLE.minutes, format, preview);
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
      check.addEventListener("change", () => { row.on = check.checked; renderFormatExample(); });
      const title = document.createElement("input");
      title.value = row.title;
      title.maxLength = Formats.LIMITS.title;
      title.setAttribute("aria-label", `${Formats.KEY_LABELS[row.key]} 항목 이름`);
      title.addEventListener("input", () => { row.title = title.value; renderFormatExample(); });
      const move = (label, delta, disabled) => {
        const button = element("button", label, "button button-quiet custom-move");
        button.type = "button";
        button.disabled = disabled;
        button.setAttribute("aria-label", `${Formats.KEY_LABELS[row.key]} ${label}`);
        button.addEventListener("click", () => {
          [state.customRows[index], state.customRows[index + delta]] = [state.customRows[index + delta], state.customRows[index]];
          renderEditorRows();
          renderFormatExample();
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
    const value = editorValue(true);
    const result = await api("/api/custom-format", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    state.customFormat = result.customFormat;
    updateCustomOption();
    loadEditor();
    ui["custom-status"].textContent = `‘${state.customFormat.name}’ 형식을 저장했습니다. 다음 분석부터 이 형식으로 정리합니다.`;
    renderFormatExample();
    refresh();
  }

  async function deleteCustom() {
    if (!state.customFormat || !confirm(`‘${state.customFormat.name}’ 형식을 삭제할까요? 이미 저장된 회의는 그대로입니다.`)) return;
    await api("/api/custom-format", { method: "DELETE" });
    state.customFormat = null;
    updateCustomOption();
    if (ui["output-format"].value === "custom" && !state.meetingCustom) { ui["output-format"].value = "meeting"; rememberFormat(state.slot, "meeting"); }
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
    if (!state.projects.length) blockers.push("프로젝트 목록을 불러오는 중입니다.");
    if (hasMeetingRecord()) blockers.push("지난 회의 기록이 열려 있습니다. ‘회의 준비’를 눌러 새 회의를 준비하세요.");
    if (!canAnalyze()) blockers.push(state.access.accessMode === "exhausted" ? "새로운 API키를 등록하세요. 상단 ‘AI 설정’에서 등록합니다." : "상단 ‘AI 설정’에서 API 키를 등록하세요.");
    if (state.modelError) blockers.push(`상단 ‘AI 설정’에서 요약 모델을 다시 선택하세요. ${state.modelError}`);
    if (!ui["project-name"].value.trim()) blockers.push("‘회의 준비’에서 프로젝트 이름을 입력하세요.");
    if (!ui.title.value.trim()) blockers.push("‘회의 준비’에서 회의명을 입력하세요.");
    if (ui["output-format"].value === "custom" && !currentCustom()) blockers.push("‘회의 준비’의 예시 보기에서 내 형식을 먼저 저장하세요.");
    if (!ui["record-consent"].checked) blockers.push("참석자 녹음 동의를 체크하세요.");
    if (!ui["ai-consent"].checked) blockers.push("외부 AI 분석 동의를 체크하세요.");
    return blockers;
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

  function refresh() {
    renderResultActions();
    const recording = Boolean(state.recorder && !state.recordingStopping);
    const busy = Boolean(state.aiController) || state.keyBusy || state.projectBusy || state.archiveBusy;
    const locked = busy || state.flowBusy || state.permissionPending || state.recorders.size > 0;
    ui.prepare.disabled = locked || !state.projects.length;
    ui.prepare.setAttribute("aria-expanded", String(state.setupOpen));
    ui["meeting-setup"].hidden = !state.setupOpen;
    ui["save-preset"].disabled = locked || !state.projects.length;
    ui["delete-preset"].hidden = !state.projects[state.slot - 1]?.name;
    ui["delete-preset"].disabled = locked || hasMeetingRecord();
    ui["save-archive"].disabled = locked || !state.minutes || stale() || state.resultStored;
    ui["save-archive"].hidden = !state.minutes || state.resultStored;
    ui["retry-analysis"].disabled = locked;
    ui.clear.disabled = locked;
    ui.shutdown.disabled = state.flowBusy || state.archiveBusy || state.projectBusy;
    for (const id of ["project-name", "title", "date", "output-format", "participants", "meeting-notes", "meeting-context", "transcript", "audio-file"])
      ui[id].disabled = Boolean(locked);
    for (const id of ["export-settings", "import-settings", "confirm-import"]) ui[id].disabled = settingsTransferBlocked();
    for (const button of ui["project-presets"].querySelectorAll("button")) button.disabled = Boolean(locked);
    for (const button of ui["meeting-history"].querySelectorAll("button")) button.disabled = Boolean(locked);
    const allowedAI = (canAnalyze() || needsNewKey()) && ui["ai-consent"].checked && !busy;
    const canSendAudio = state.parts.some(
      (part) =>
        part.blob && part.blob.size <= state.maxAudioBytes && !part.applied,
    );
    ui.start.disabled =
      startBlockers().length > 0 || state.permissionPending || state.recorders.size > 0 || busy || state.microphoneBusy || state.flowBusy;
    renderStartHint(recording, locked && !recording);
    renderStage(recording);
    if (document.body) document.body.dataset.recording = String(recording);
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
    ui["detail-meta"].textContent = [state.projects[state.slot - 1]?.name, ui.date.value, state.dailySequence && `${state.dailySequence}차 회의`]
      .filter(Boolean).join(" · ");
    const lockedSettings = settingsLocked();
    for (const id of ["api-key", "persist-key", "save-key", "remove-key"]) ui[id].disabled = lockedSettings || state.keyBusy;
    ui["remove-key"].disabled ||= !state.keyConfigured;
    ui["summary-model"].disabled = lockedSettings || state.settingsBusy || !state.models.length;
    ui["settings-lock"].hidden = !lockedSettings;
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
    ui["open-ai-settings"].dataset.state = canAnalyze() && !state.modelError ? "ready" : "missing";
    ui["model-help"].textContent = state.modelError ? state.modelError : !state.models.length
      ? "이 서버는 모델 목록을 제공하지 않아 서버 기본 모델로 요약합니다."
      : model
        ? `${model.description ? `${model.description} ` : ""}바꾼 모델은 다음 분석부터 적용됩니다.`
        : "모델을 선택하세요.";
    ui["transcript-count"].textContent =
      `${Array.from(ui.transcript.value).length.toLocaleString("ko-KR")}자`;
    updateSize();
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
    ui.transcript.value = "";
    state.minutes = null;
    state.minutesFormat = null;
    state.summarySource = "";
    state.notesSaved = true;
    state.usage = [];
    state.callIds = [];
    state.analysisModel = "";
    renderMinutes();
    refresh();
  }

  function recordingMetadata() {
    return {
      title: ui.title.value.trim(), date: ui.date.value, participants: ui.participants.value.trim(),
      context: ui["meeting-context"].value.trim(), notes: ui["meeting-notes"].value.trim(), ...formatFields(),
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
    if (!previous || state.recordingStopping || !ui["record-consent"].checked) return;
    try {
      startPart(state.stream, previous.recorder.mimeType);
      previous.recorder.stop();
      announce(`파일 ${String(state.parts.length).padStart(3, "0")} 녹음을 시작했습니다.`);
    } catch (error) {
      stopRecording(`다음 파일을 시작하지 못했습니다. ${error.message}`);
    }
  }

  // 브라우저 입력칸은 CRLF를 LF로 바꾸므로 줄바꿈만 맞춰 비교하고, 앞뒤 공백은 자르지 않는다.
  const newlines = (value) => String(value ?? "").replace(/\r\n?/g, "\n");
  function presetContext(project) {
    const value = ui["meeting-context"].value;
    return project && newlines(project.context) === newlines(value) ? project.context : value;
  }

  function presetChanged() {
    const project = state.projects[state.slot - 1];
    return !project || project.name !== ui["project-name"].value.trim() || project.title !== ui.title.value.trim()
      || project.context !== presetContext(project);
  }

  async function startRecording() {
    if (state.flowBusy || state.projectBusy || state.archiveBusy || state.aiController) return;
    if (state.permissionPending || state.recorders.size) return;
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
    if (presetChanged()) {
      try {
        await savePreset();
      } catch (error) {
        workflow(`프리셋을 저장하지 못해 녹음을 시작하지 않았습니다. ${error.message}`);
        return;
      }
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
      if (generation !== state.permissionGeneration || !ui["record-consent"].checked) {
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
      state.meetingId = newOperationId();
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
    state.meetingId = newOperationId();
    state.recordingMetadata = null;
    state.audioStored = false;
    ui["retry-analysis"].hidden = false;
    workflow("음성을 불러왔습니다. ‘저장·분석 다시 시도’를 누르면 프로젝트에 보관하고 분석합니다.");
    announce(`${files.length}개 파일을 이름 순서대로 불러왔습니다. 전사할 때만 외부로 전송됩니다.`);
  }

  function setBusy(controller) {
    state.aiController = controller;
    refresh();
  }

  function assertAI(signal) {
    if (signal.aborted || !ui["ai-consent"].checked || state.recorders.size)
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
      const result = await aiApi("transcription", "/api/transcribe", {
        method: "POST",
        body: part.blob,
        headers: aiHeaders(type),
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
    if (!canAnalyze() || !ui["ai-consent"].checked || state.aiController) return;
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
        if (!ui["ai-settings"].open) openDialog(ui["ai-settings"], ui["open-ai-settings"]);
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

  async function summarize(useExistingText = false) {
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
      if (state.audioStored && state.meetingId) {
        await api(`/api/projects/${state.slot}/recordings/${state.meetingId}/transcript`, {
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
        const body = JSON.stringify({ ...metadata, text, previousMinutes, ...(state.models.length && state.summaryModel ? { model: state.summaryModel } : {}) });
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
      for (const text of splitTranscript(transcript)) await summarizeSection(text);
      state.minutes = previousMinutes;
      state.minutesFormat = metadata.outputFormat;
      await settleTrial("finish", state.analysisId);
      if (previousMinutes.suggestedTitle) ui.title.value = previousMinutes.suggestedTitle;
      state.summarySource = summaryInput();
      state.notesSaved = false;
      state.resultId = newOperationId();
      state.resultStored = false;
      renderMinutes();
      refresh();
      await archiveResult();
      workflow("회의록 저장 완료. 이 프로젝트의 ‘지난 회의’에서 다시 열 수 있습니다.");
      ui["retry-analysis"].hidden = true;
      announce(withTrialWarning(`${state.audioStored ? "음성과 " : ""}회의록을 보관했습니다. 내용을 검토하세요.`));
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
    ui.minutes.replaceChildren();
    const minutes = state.minutes;
    if (!minutes) {
      ui.minutes.append(
        element(
          "p",
          ui.transcript.value.trim() || state.audioStored
          ? "아직 회의록이 없습니다. 아래 ‘전사 원문 확인 · 다시 분석’에서 분석을 다시 요청할 수 있습니다."
          : "회의록을 만들면 회의 핵심, 합의된 방향, 주제별 설명, 다음 할 일, 미확정 사항이 여기에 표시됩니다.",
          "empty-state",
        ),
      );
      return;
    }
    const format = outputFormat(state.minutesFormat ?? ui["output-format"].value);
    renderMinutesInto(ui.minutes, minutes, format, format === "custom" ? currentCustom() : null);
  }

  function renderMinutesInto(target, minutes, format, custom) {
    if (format === "custom" && !custom) format = "meeting";
    if (format === "custom" && custom) {
      // 내 형식은 사용자가 고른 항목만 고른 순서와 이름으로 보여 준다.
      for (const section of Formats.customSections(minutes, custom)) {
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
        renderList(target, "할 일", minutes.actions, action);
        optional("미확정 항목", minutes.openQuestions);
        optional("결정 사항", minutes.decisions);
        if (minutes.topics?.length) target.append(topics);
      } else {
        if (minutes.topics?.length) target.append(topics);
        optional("결정 사항", minutes.decisions);
        optional("후속 작업", minutes.actions, action);
        optional("확인 필요", minutes.openQuestions);
      }
      return;
    }
    const overview = document.createElement("section");
    overview.className = "summary-overview";
    overview.append(element("h3", "핵심 요약"), element("p", minutes.overview));
    target.append(overview);
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
    renderList(target, "다음 할 일", minutes.actions, (action) =>
      [action.task, action.owner && `담당 ${action.owner}`, action.due && `기한 ${action.due}`]
        .filter(Boolean)
        .join(" · "),
    );
    renderList(target, "미확정 사항", minutes.openQuestions);
  }

  function resultLabel() {
    const format = outputFormat(state.minutesFormat ?? ui["output-format"].value);
    return format === "custom" && currentCustom() ? currentCustom().name : formatLabels[format === "custom" ? "meeting" : format];
  }

  function showResultTab(tab) {
    // 결과 창은 정리본과 전사문을 탭으로 나누고, 위쪽 버튼은 보고 있는 탭의 내용을 다룬다.
    state.resultTab = tab;
    const minutes = tab === "minutes";
    ui["tab-minutes"].setAttribute("aria-selected", String(minutes));
    ui["tab-transcript"].setAttribute("aria-selected", String(!minutes));
    ui["tab-minutes"].tabIndex = minutes ? 0 : -1;
    ui["tab-transcript"].tabIndex = minutes ? -1 : 0;
    ui["panel-minutes"].hidden = !minutes;
    ui["panel-transcript"].hidden = minutes;
    ui["result-status"].textContent = "";
    renderResultActions();
  }

  function renderResultActions() {
    const minutes = state.resultTab === "minutes", name = minutes ? resultLabel() : "전사문";
    const ready = minutes ? Boolean(state.minutes) && !stale() : Boolean(ui.transcript.value.trim());
    ui["copy-result"].textContent = `${name} 복사`;
    ui["save-result"].textContent = `${name} 텍스트 파일로 저장`;
    ui["share-result"].textContent = `${name} 공유`;
    ui["share-result"].hidden = typeof navigator === "undefined" || typeof navigator.share !== "function";
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

  async function copyResult() {
    const text = resultText();
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (!copied) throw new Error("복사하지 못했습니다. 텍스트 파일로 저장해 주세요.");
    }
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
      projectName: state.projects[state.slot - 1]?.name || "",
      context: ui["meeting-context"].value.trim(),
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
      `프로젝트: ${data.projectName}`,
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
      "## 다음 할 일",
      ...(minutes.actions || []).map(
        (item) =>
          `- ${[item.task, item.owner && `담당 ${item.owner}`, item.due && `기한 ${item.due}`].filter(Boolean).join(" · ")}`,
      ),
      "",
      "## 미확정 사항",
      ...(minutes.openQuestions || []).map((item) => `- ${item}`),
      "",
    ];
  }

  function exportDocument() {
    const { projectName, title, date, dailySequence, participants, outputFormat, customFormat, minutes } = documentObject();
    return { projectName, title, date, dailySequence, participants, outputFormat, ...(customFormat ? { customFormat } : {}), minutes };
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
      state.flowBusy || state.archiveBusy || state.projectBusy ||
      state.parts.some((part) => part.blob && !part.saved) ||
      Boolean((ui.transcript.value || state.minutes) && !state.notesSaved)
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
    state.meetingId = null;
    state.recordingMetadata = null;
    state.audioStored = false;
    ui["retry-analysis"].hidden = true;
    ui.title.value = "";
    ui.participants.value = "";
    ui["meeting-notes"].value = "";
    ui["meeting-context"].value = "";
    ui["record-consent"].checked = false;
    ui["ai-consent"].checked = false;
    ui["record-state"].textContent = "대기";
    ui.timer.textContent = "00:00";
    refresh();
    announce("이 창의 회의 내용을 지웠습니다.");
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

  function renderPresets() {
    const slot = state.slot;
    const project = state.projects[slot - 1];
    ui["selected-project"].textContent = `${slot}번 프로젝트 · ${project.name || "새 프로젝트 등록"}`;
    ui["header-project"].textContent = project.name || `${slot}번 · 새 프로젝트`;
    ui["project-presets"].replaceChildren();
    // 저장된 프로젝트와 지금 등록 중인 빈 칸만 보이고, 빈 칸이 남아 있으면 추가 버튼을 둔다.
    for (const preset of state.projects.filter((item) => item.name || item.slot === slot)) {
      const button = element("button", "", "preset-button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(preset.slot === slot));
      button.append(element("span", preset.slot, "preset-no"), element("span", preset.name || "새 프로젝트 등록", "preset-name"));
      button.addEventListener("click", () => selectProject(preset.slot));
      ui["project-presets"].append(button);
    }
    const empty = state.projects.find((item) => !item.name);
    if (empty && project.name) {
      const add = element("button", `+ 프로젝트 추가 (최대 ${state.projects.length}개)`, "preset-add");
      add.type = "button";
      add.addEventListener("click", () => selectProject(empty.slot));
      ui["project-presets"].append(add);
    }
  }

  function applyProject(slot, resetDate = true) {
    state.slot = slot;
    const project = state.projects[slot - 1];
    ui["project-name"].value = project.name;
    ui.title.value = project.title;
    if (resetDate) ui.date.value = today();
    ui["meeting-context"].value = project.context;
    ui["output-format"].value = rememberedFormat(project);
    state.meetingCustom = null;
    renderPresets();
    if (!project.name) state.setupOpen = true;
    workflow("‘회의 준비’를 눌러 회의 정보를 확인하고, 동의를 체크한 뒤 ‘회의 시작’을 누르세요.", true);
    refresh();
  }

  async function selectProject(slot) {
    if (state.projectBusy || state.flowBusy || state.recorders.size || state.aiController || state.permissionPending) return;
    if (hasUnsavedWork() && !confirm("저장되지 않은 현재 회의 내용을 비우고 다른 프로젝트로 이동할까요?")) return;
    state.projectBusy = true;
    refresh();
    try {
      const result = await api("/api/projects");
      state.projects = result.projects;
      clearLocal(true);
      applyProject(slot);
      await loadHistory();
    } catch (error) { workflow(error.message); }
    finally { state.projectBusy = false; refresh(); }
  }

  async function savePreset() {
    const project = state.projects[state.slot - 1];
    if (!project || state.projectBusy) throw new Error("프로젝트를 먼저 불러오세요.");
    const input = { name: ui["project-name"].value.trim(), title: ui.title.value.trim(), context: presetContext(project),
      outputFormat: outputFormat(project.outputFormat), revision: project.revision };
    if (!input.name || !input.title) throw new Error("프로젝트 이름과 회의명을 입력하세요.");
    state.projectBusy = true;
    refresh();
    try {
      const result = await api(`/api/projects/${state.slot}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      state.projects[state.slot - 1] = result.project;
      applyProject(state.slot, false);
      workflow(`${input.name} 프리셋을 저장했습니다. 다음 실행에서도 불러옵니다.`);
    } finally { state.projectBusy = false; refresh(); }
  }

  async function deletePreset() {
    const project = state.projects[state.slot - 1];
    if (!project?.name || state.projectBusy) return;
    if (!confirm(`‘${project.name}’ 프로젝트를 삭제할까요? 회의 기록이 있는 프로젝트는 삭제되지 않습니다.`)) return;
    state.projectBusy = true;
    refresh();
    try {
      const result = await api(`/api/projects/${state.slot}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: project.revision }) });
      state.projects = result.projects;
      clearLocal(true);
      applyProject(state.projects.find((item) => item.name)?.slot || 1);
      await loadHistory();
      workflow(`${project.name} 프로젝트를 삭제했습니다.`);
    } finally { state.projectBusy = false; refresh(); }
  }

  function focusSetup() {
    const target = ["project-name", "title"].map((id) => ui[id]).find((input) => !input.value.trim()) || ui["meeting-notes"];
    target.focus?.();
  }

  function prepareMeeting() {
    if (state.projectBusy || state.flowBusy || state.recorders.size || state.aiController || state.permissionPending) return;
    if (hasMeetingRecord()) {
      if (hasUnsavedWork() && !confirm("저장하지 않은 이전 회의 내용을 비우고 새 회의를 준비할까요?")) return;
      clearParts();
      resetResult();
      state.meetingId = null;
      state.recordingMetadata = null;
      state.audioStored = false;
      const project = state.projects[state.slot - 1];
      ui.title.value = project?.title || "";
      ui["output-format"].value = project ? rememberedFormat(project) : "meeting";
      state.meetingCustom = null;
      ui.date.value = today();
      ui.participants.value = "";
      ui["meeting-notes"].value = "";
      ui["record-state"].textContent = "대기";
      ui.timer.textContent = "00:00";
      ui["retry-analysis"].hidden = true;
      ui["archive-status"].textContent = "회의 종료 후 음성과 회의록을 이 프로젝트에 보관합니다.";
    }
    state.setupOpen = true;
    refresh();
    focusSetup();
    workflow("회의 정보를 입력하고 동의를 체크하면 바로 ‘회의 시작’을 누를 수 있습니다.", true);
  }

  async function loadHistory() {
    const slot = state.slot;
    try {
      const result = await api(`/api/projects/${slot}/meetings`);
      if (slot !== state.slot) return;
      ui["history-status"].textContent = `${state.projects[slot - 1]?.name || `${slot}번 프로젝트`} · ${result.meetings.length}개 회의`;
      ui["meeting-history"].replaceChildren();
      if (!result.meetings.length) ui["meeting-history"].append(element("p", "아직 보관된 회의가 없습니다."));
      for (const meeting of result.meetings) {
        const button = element("button", "", "history-button");
        button.type = "button";
        const format = outputFormat(meeting.outputFormat);
        button.append(element("strong", `${meeting.date || "날짜 미입력"} · ${meeting.dailySequence || 1}차 · ${meeting.title}`),
          element("span", `${meeting.analyzed ? `${format === "meeting" ? "회의록" : formatLabels[format]} 완료 · 눌러서 보기` : "분석 대기"} · 음성 ${meeting.audioCount}개`));
        button.addEventListener("click", () => openMeeting(meeting.id, button));
        ui["meeting-history"].append(button);
      }
    } catch (error) { ui["history-status"].textContent = `목록 확인 실패. ${error.message}`; }
    refresh();
  }

  async function openMeeting(id, opener) {
    if (state.projectBusy || state.flowBusy || state.recorders.size || state.aiController) return;
    if (hasUnsavedWork() && !confirm("현재 저장하지 않은 내용을 비우고 지난 회의를 열까요?")) return;
    state.projectBusy = true;
    refresh();
    try {
      const { meeting } = await api(`/api/projects/${state.slot}/meetings/${id}`);
      const parts = [];
      for (const audio of meeting.audio || []) {
        const response = await fetch(`/api/projects/${state.slot}/recordings/${meeting.recordingId || id}/audio/${audio.index}`, { headers: { "X-Meeting-Token": state.token } });
        if (!response.ok) throw new Error("저장된 원음을 불러오지 못했습니다.");
        parts.push({ blob: await response.blob(), saved: true, diskSaved: true, transcript: "", applied: Boolean(meeting.transcript) });
      }
      clearLocal(true);
      ui.title.value = meeting.title;
      ui.date.value = meeting.date;
      ui.participants.value = meeting.participants;
      ui["meeting-context"].value = meeting.context;
      ui["meeting-notes"].value = meeting.notes || "";
      state.meetingCustom = meeting.outputFormat === "custom" ? meeting.customFormat || null : null;
      ui["output-format"].value = outputFormat(meeting.outputFormat);
      ui.transcript.value = meeting.transcript;
      state.parts = parts.map(part => ({ ...part, url: URL.createObjectURL(part.blob) }));
      state.meetingId = meeting.recordingId || id;
      state.recordingMetadata = { title: meeting.title, date: meeting.date, participants: meeting.participants, context: meeting.context, notes: meeting.notes || "",
        outputFormat: outputFormat(meeting.outputFormat), ...(state.meetingCustom ? { customFormat: state.meetingCustom } : {}) };
      state.audioStored = parts.length > 0 && (!meeting.expectedParts || meeting.expectedParts === parts.length);
      state.minutes = meeting.minutes;
      state.minutesFormat = outputFormat(meeting.outputFormat);
      state.dailySequence = meeting.dailySequence;
      state.resultId = meeting.minutes ? id : null;
      state.resultStored = Boolean(meeting.minutes);
      state.summarySource = summaryInput();
      state.notesSaved = true;
      state.usage = usageTools().normalize(meeting.analysis?.usage);
      state.callIds = Array.isArray(meeting.analysis?.callIds) ? meeting.analysis.callIds.filter((id) => typeof id === "string") : [];
      state.analysisModel = meeting.analysis?.summaryModel || "";
      state.setupOpen = false;
      ui["record-state"].textContent = parts.length ? "보관된 음성" : "대기";
      renderParts();
      renderMinutes();
      ui["retry-analysis"].hidden = Boolean(meeting.minutes) || !state.audioStored;
      ui["archive-status"].textContent = meeting.minutes ? "프로젝트에 보관된 회의록입니다." : meeting.transcript ? "음성과 전사 원문은 보관되어 있습니다. 다시 분석하면 전사를 재사용합니다." : "음성은 보관되어 있고 분석은 완료되지 않았습니다.";
      if (meeting.transcript && !meeting.minutes) document.getElementById("transcript-details").open = true;
      openDialog(ui["meeting-detail"], opener);
      workflow(meeting.minutes ? "지난 회의를 불러왔습니다. ‘회의록 보기’에서 결과·내보내기·재분석을 할 수 있습니다." : state.audioStored ? "음성 저장 완료. AI 연결과 전송 동의를 확인한 뒤 다시 분석하세요." : "일부 음성 저장이 끝나지 않은 회의입니다. 원래 녹음 창에서 저장을 완료하세요.");
    } catch (error) { workflow(error.message); }
    finally { state.projectBusy = false; refresh(); }
  }

  async function archiveResult() {
    if (!state.minutes || stale()) throw new Error("현재 입력으로 회의록을 먼저 분석하세요.");
    state.archiveBusy = true;
    state.resultId ||= newOperationId();
    refresh();
    const document = { ...documentObject(), id: state.resultId, ...(state.audioStored ? { recordingId: state.meetingId } : {}) };
    try {
      const saved = await api(`/api/projects/${state.slot}/meetings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(document) });
      state.dailySequence = saved.meeting?.dailySequence;
      state.resultStored = true;
      state.notesSaved = true;
      ui["archive-status"].textContent = `${document.projectName} · 전사 원문과 회의록 저장 완료`;
      await loadHistory();
    } catch (error) {
      ui["archive-status"].textContent = "회의록 저장 실패. 결과는 화면에 남아 있습니다. 저장을 다시 시도하세요.";
      throw error;
    } finally { state.archiveBusy = false; refresh(); }
  }

  async function finishMeeting() {
    if (state.flowBusy || state.projectBusy || state.archiveBusy || state.aiController) return;
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
        state.meetingId ||= newOperationId();
        state.recordingMetadata ||= recordingMetadata();
        await api(`/api/projects/${state.slot}/recordings/${state.meetingId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.recordingMetadata, expectedParts: state.parts.length }) });
        for (let i = 0; i < state.parts.length; i++) {
          const part = state.parts[i];
          workflow(`음성 저장 중 · ${i + 1}/${state.parts.length}개`);
          await api(`/api/projects/${state.slot}/recordings/${state.meetingId}/audio/${i + 1}`, { method: "POST", headers: { "Content-Type": part.blob.type.split(";")[0] || "audio/webm" }, body: part.blob });
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
      if (!canAnalyze() || !ui["ai-consent"].checked) throw new Error("음성은 저장했습니다. API 키와 외부 AI 전송 동의를 확인한 뒤 다시 분석하세요.");
      workflow("음성 저장 완료. 전사와 회의록을 분석하고 있습니다…");
      await summarize();
    } catch (error) {
      workflow(`${state.audioStored ? "음성 저장 완료. " : "저장을 완료하지 못했습니다. 창을 닫지 마세요. "}${error.message}`);
      ui["retry-analysis"].hidden = false;
    } finally { state.flowBusy = false; refresh(); }
  }

  function settingsTransferBlocked() {
    return Boolean(state.recorder || state.recorders.size || state.permissionPending || state.aiController || state.flowBusy || state.archiveBusy
      || state.projectBusy || state.keyBusy || state.settingsBusy || !state.projects.length);
  }

  async function exportSettings() {
    if (settingsTransferBlocked()) return announce("녹음·마이크 허가·AI 분석·저장이 끝난 뒤 설정을 내보내세요.");
    if (!hasMeetingRecord() && presetChanged()
      && !confirm("화면에서 바꾼 프로젝트 설정은 아직 저장되지 않아 파일에 들어가지 않습니다. 저장된 설정만 내보낼까요? 먼저 저장하려면 취소한 뒤 ‘프리셋 저장’을 누르세요."))
      return;
    state.projectBusy = true;
    refresh();
    try {
      const { file } = await api("/api/project-settings/export");
      download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json;charset=utf-8" }), `${today()}-VoiceNote-프로젝트설정.json`);
      announce("프로젝트 설정 파일 다운로드를 시작했습니다. API 키와 회의 기록은 들어가지 않습니다.");
    } catch (error) {
      announce(`설정을 내보내지 못했습니다. ${error.message}`);
    } finally { state.projectBusy = false; refresh(); }
  }

  function chooseSettingsFile() {
    if (settingsTransferBlocked()) return announce("녹음·마이크 허가·AI 분석·저장이 끝난 뒤 설정 파일을 불러오세요.");
    ui["settings-file"].click();
  }

  async function previewSettings(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (settingsTransferBlocked()) return announce("녹음·마이크 허가·AI 분석·저장이 끝난 뒤 설정 파일을 불러오세요.");
    if (file.size > maxSettingsBytes) return announce("설정 파일이 128KiB를 넘어 불러오지 않았습니다. 현재 설정은 바뀌지 않았습니다.");
    state.projectBusy = true;
    refresh();
    try {
      // 원본 바이트로 크기를 재고 손상된 UTF-8은 대체 문자로 바꾸지 않고 거절한다. 검증은 서버가 쓰기 없이 같은 규칙으로 한다.
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > maxSettingsBytes) throw new Error("설정 파일이 128KiB를 넘었습니다.");
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new Error("UTF-8 설정 파일이 아닙니다."); }
      const { projects } = await api("/api/project-settings/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: text }) });
      state.pendingImport = { text, revisions: state.projects.map((project) => project.revision) };
      ui["settings-preview"].replaceChildren();
      for (const project of projects) {
        const row = document.createElement("li");
        row.append(element("span", project.slot, "preset-no"), element("span", project.name || "비어 있음", project.name ? "" : "empty"));
        if (project.name) row.append(element("span", formatLabels[outputFormat(project.outputFormat)], "format"));
        ui["settings-preview"].append(row);
      }
      ui["settings-import-file"].textContent = `${file.name} · 아래 프로젝트 설정으로 바꿉니다.${!hasMeetingRecord() && presetChanged() ? " 화면에서 저장하지 않은 프로젝트 입력은 사라집니다." : ""}`;
      state.projectBusy = false;
      openDialog(ui["settings-import"], ui["import-settings"]);
    } catch (error) {
      state.pendingImport = null;
      announce(`설정 파일을 불러오지 못했습니다. ${error.message} 현재 설정은 바뀌지 않았습니다.`);
    } finally { state.projectBusy = false; refresh(); }
  }

  async function applyImportedSettings() {
    const pending = state.pendingImport;
    if (!pending) return;
    if (settingsTransferBlocked()) return announce("녹음·마이크 허가·AI 분석·저장이 끝난 뒤 설정을 바꾸세요.");
    state.projectBusy = true;
    refresh();
    try {
      const result = await api("/api/project-settings/import", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: pending.text, revisions: pending.revisions }) });
      state.projects = result.projects;
      if (hasMeetingRecord()) renderPresets();
      else applyProject(state.slot, false);
      announce("프로젝트 설정을 파일 내용으로 바꿨습니다. 회의와 녹음은 그대로입니다.");
      workflow("프로젝트 설정을 불러왔습니다. 프로젝트를 고르고 ‘회의 준비’를 누르세요.", true);
      loadHistory();
    } catch (error) {
      announce(`설정을 바꾸지 못했습니다. ${error.message}`);
    } finally {
      state.pendingImport = null;
      state.projectBusy = false;
      if (ui["settings-import"].open) ui["settings-import"].close();
      refresh();
    }
  }

  function focusables(dialog) {
    return Array.from(dialog.querySelectorAll("button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex='-1'])"))
      .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
  }

  function openDialog(dialog, opener) {
    if (!dialog || dialog.open) return;
    dialog.returnFocus = opener || document.activeElement;
    if (dialog === ui["meeting-detail"]) { renderMinutes(); showResultTab(state.minutes || !ui.transcript.value.trim() ? "minutes" : "transcript"); }
    refresh();
    dialog.showModal();
    const first = dialog === ui["ai-settings"] && !state.keyConfigured && !ui["api-key"].disabled ? ui["api-key"] : dialog.querySelector("[data-close]");
    first?.focus();
  }

  function bindDialog(dialog) {
    dialog.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-close]") || event.target === dialog) dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
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
      const target = dialog.returnFocus;
      dialog.returnFocus = null;
      if (target?.isConnected && !target.disabled) target.focus();
      else ui.prepare.focus();
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
      state.summaryModel = result.summaryModel || id;
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

  function bind() {
    ui.prepare.addEventListener("click", prepareMeeting);
    ui["save-preset"].addEventListener("click", () => savePreset().catch(error => workflow(error.message)));
    ui["delete-preset"].addEventListener("click", () => deletePreset().catch(error => workflow(error.message)));
    ui["retry-analysis"].addEventListener("click", finishMeeting);
    ui["save-archive"].addEventListener("click", () => archiveResult().catch(error => workflow(error.message)));
    ui["microphone-volume"].addEventListener("click", setMicrophoneVolume);
    ui.start.addEventListener("click", startRecording);
    ui["cancel-permission"].addEventListener("click", cancelPermission);
    ui.stop.addEventListener("click", finishMeeting);
    ui["audio-file"].addEventListener("change", importAudio);
    ui.transcribe.addEventListener("click", transcribe);
    ui.summarize.addEventListener("click", () => summarize(true));
    document.getElementById("save-transcript").addEventListener("click", () => {
      if (!ui.transcript.value.trim()) return announce("저장할 전사 원문이 없습니다.");
      download(new Blob([ui.transcript.value], { type: "text/plain;charset=utf-8" }), `${baseName()}-전사원문.txt`);
      announce("전사 원문 다운로드를 시작했습니다. 저장된 파일을 확인하세요.");
    });
    ui["cancel-ai"].addEventListener("click", () => state.aiController?.abort());
    for (const id of ["transcript", "title", "date", "participants", "meeting-notes", "meeting-context", "project-name"])
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
    ui["open-ai-settings"].addEventListener("click", () => openDialog(ui["ai-settings"], ui["open-ai-settings"]));
    ui["open-result"].addEventListener("click", () => openDialog(ui["meeting-detail"], ui["open-result"]));
    ui["tab-minutes"].addEventListener("click", () => showResultTab("minutes"));
    ui["tab-transcript"].addEventListener("click", () => showResultTab("transcript"));
    for (const id of ["tab-minutes", "tab-transcript"]) ui[id].addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const next = state.resultTab === "minutes" ? "transcript" : "minutes";
      showResultTab(next);
      ui[next === "minutes" ? "tab-minutes" : "tab-transcript"].focus();
    });
    ui["copy-result"].addEventListener("click", () => copyResult().catch((error) => { ui["result-status"].textContent = error.message; }));
    ui["save-result"].addEventListener("click", saveResult);
    ui["share-result"].addEventListener("click", shareResult);
    ui["setup-close"].addEventListener("click", () => {
      state.setupOpen = false;
      refresh();
      ui.prepare.focus();
    });
    for (const dialog of [ui["meeting-detail"], ui["ai-settings"], ui["settings-import"]]) bindDialog(dialog);
    ui["settings-import"].addEventListener("close", () => { state.pendingImport = null; });
    ui["export-settings"].addEventListener("click", exportSettings);
    ui["import-settings"].addEventListener("click", chooseSettingsFile);
    ui["settings-file"].addEventListener("change", previewSettings);
    ui["confirm-import"].addEventListener("click", applyImportedSettings);
    ui["output-format"].addEventListener("change", () => {
      state.resultStored = false;
      state.notesSaved = false;
      rememberFormat(state.slot, ui["output-format"].value);
      if (ui["output-format"].value === "custom" && !currentCustom()) { ui["format-example"].hidden = false; loadEditor(); }
      renderFormatExample();
      refresh();
    });
    ui["format-help"].addEventListener("click", () => {
      ui["format-example"].hidden = !ui["format-example"].hidden;
      if (!ui["format-example"].hidden) loadEditor();
      renderFormatExample();
    });
    ui["custom-name"].addEventListener("input", renderFormatExample);
    ui["custom-instruction"].addEventListener("input", renderFormatExample);
    ui["custom-save"].addEventListener("click", () => saveCustom().catch((error) => { ui["custom-status"].textContent = error.message; }));
    ui["custom-delete"].addEventListener("click", () => deleteCustom().catch((error) => { ui["custom-status"].textContent = error.message; }));
    ui["ai-settings"].addEventListener("close", () => { ui["api-key"].value = ""; });
    ui.clear.addEventListener("click", () => { if (clearLocal()) applyProject(state.slot); });
    ui.shutdown.addEventListener("click", shutdown);
    ui["record-consent"].addEventListener("change", () => {
      if (!ui["record-consent"].checked) {
        cancelPermission();
        stopRecording("녹음 동의를 해제해 녹음을 정지했습니다.");
      }
      refresh();
    });
    ui["ai-consent"].addEventListener("change", () => {
      if (!ui["ai-consent"].checked) state.aiController?.abort();
      refresh();
    });
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
      state.keyConfigured = Boolean(config.keyConfigured);
      state.keySaved = Boolean(config.keySaved);
      state.keyStorageError = config.keyStorageError || "";
      state.maxAudioBytes = config.maxAudioBytes || state.maxAudioBytes;
      state.maxMinutes = config.maxMinutes || state.maxMinutes;
      applyAccess(config);
      applyModels(config);
      state.customFormat = (await api("/api/custom-format")).customFormat;
      updateCustomOption();
      const projects = await api("/api/projects");
      state.projects = projects.projects;
      applyProject(state.projects.find((item) => item.name)?.slot || 1);
      await loadHistory();
      refresh();
      announce(canAnalyze() ? "프로젝트를 고르고 ‘회의 준비’를 누르세요." : state.access.accessMode === "exhausted" ? "새로운 API키를 등록하세요." : "처음이면 상단 ‘AI 설정’에서 API 키를 등록하세요.");
    } catch (error) {
      announce(`서버 연결을 확인하지 못했습니다. ${error.message}`);
    }
  }

  window.meetingDesktopStatus = () => ({ unsaved: hasUnsavedWork() });
  const openData = document.getElementById("open-data-folder");
  if (openData) {
    openData.hidden = !window.chrome?.webview;
    openData.addEventListener("click", () => window.chrome?.webview?.postMessage("open-data-folder"));
  }
  init();
})();
