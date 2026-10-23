// 최대 세 프로젝트의 프리셋과 회의 원문 및 회의록을 실행 폴더에 보관한다.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const defaults = require('./기본프로젝트.json');
const aiUsage = require('./AI사용량.js');
const formats = require('./출력형식.js');
const { markdown } = require('./회의문서.cjs');
const MAX_PROJECTS = 3;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw fail(400, '프로젝트 또는 회의 입력 내용을 확인하세요.');
  return value;
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, value, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function outputFormat(value) {
  const format = formats.format(value ?? 'meeting');
  if (!format || format === 'custom') throw fail(400, '출력 형식을 확인하세요.');
  return format;
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
// 회의 한 건의 형식은 세 기본 형식에 내 형식(custom)을 더한 것이다. 내 형식은 회의 당시 정의를 기록에 함께 남긴다.
function meetingFormat(data) {
  const format = formats.format(data.outputFormat ?? 'meeting');
  if (!format) throw fail(400, '출력 형식을 확인하세요.');
  if (format !== 'custom') return { outputFormat: format };
  try { return { outputFormat: format, customFormat: formats.validateCustom(data.customFormat) }; }
  catch (error) { throw fail(400, error.message); }
}
function storedFormat(record) {
  if (record.outputFormat === 'custom') {
    try { return { outputFormat: 'custom', customFormat: formats.validateCustom(record.customFormat) }; } catch {}
  }
  const format = formats.format(record.outputFormat);
  return { outputFormat: format && format !== 'custom' ? format : 'meeting' };
}
const formatFields = value => ({ ...(value.outputFormat !== 'meeting' ? { outputFormat: value.outputFormat } : {}), ...(value.customFormat ? { customFormat: value.customFormat } : {}) });
function createProjectStore(root, validateMinutes, options = {}) {
  const write = options.atomicWrite ?? atomicWrite;
  const remove = options.removeFile ?? (file => fs.unlinkSync(file));
  function directory(slot) {
    // 이전 버전의 4~9번 폴더는 지우지 않고 남겨 두되 읽거나 쓰지 않는다.
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PROJECTS) throw fail(404, '프로젝트 번호를 확인하세요.');
    return path.join(root, `프로젝트-${String(slot).padStart(2, '0')}`);
  }
  function preset(slot) {
    const file = path.join(directory(slot), '설정.json');
    if (!fs.existsSync(file)) return { slot, ...defaults, revision: 0 };
    try {
      const value = readJson(file);
      text(value.name, 100); text(value.title, 160); text(value.context, 4000);
      if (!value.name.trim() && (value.title || value.context)) throw new Error();
      if (value.slot !== slot || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error();
      return { ...value, outputFormat: outputFormat(value.outputFormat) };
    } catch { throw fail(503, `${slot}번 프로젝트 설정을 읽지 못했습니다. 회의자료 폴더의 설정 파일을 확인하세요. 기존 파일은 보존합니다.`); }
  }
  function recordPath(slot, id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw fail(400, '회의 식별자를 확인하세요.');
    return path.join(directory(slot), `회의-${id}.json`);
  }
  function sequenceFor(slot, date, meetingId) {
    const dir = directory(slot);
    const records = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^(회의|녹음)-[0-9a-f-]{36}\.json$/.test(name))
      .map(name => readJson(path.join(dir, name))).filter(record => record.date === date)
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id)) : [];
    const assigned = new Map(), used = new Set();
    for (const record of records) {
      if (Number.isSafeInteger(record.dailySequence) && record.dailySequence > 0) {
        assigned.set(record.recordingId || record.id, record.dailySequence);
        used.add(record.dailySequence);
      }
    }
    for (const record of records) {
      const key = record.recordingId || record.id;
      if (assigned.has(key)) continue;
      let number = 1;
      while (used.has(number)) number++;
      assigned.set(key, number); used.add(number);
    }
    return assigned.get(meetingId) || Math.max(0, ...used) + 1;
  }
  function loadMeeting(slot, id) {
    const file = recordPath(slot, id);
    const recording = recordingPath(slot, id);
    if (!fs.existsSync(file) && fs.existsSync(recording)) {
      const transcriptFile = path.join(directory(slot), `전사-${id}.txt`);
      const draft = readJson(recording);
      return { ...draft, ...storedFormat(draft), dailySequence: draft.dailySequence || sequenceFor(slot, draft.date, id), transcript: fs.existsSync(transcriptFile) ? fs.readFileSync(transcriptFile, 'utf8') : '', minutes: null };
    }
    if (!fs.existsSync(file)) throw fail(404, '저장된 회의를 찾지 못했습니다.');
    try {
      const record = readJson(file);
      if (record.id !== id || record.slot !== slot) throw new Error();
      validateMinutes(record.minutes);
      const audioFile = recordingPath(slot, record.recordingId || id);
      return { ...record, ...storedFormat(record), dailySequence: record.dailySequence || sequenceFor(slot, record.date, record.recordingId || id), ...(fs.existsSync(audioFile) ? { audio: readJson(audioFile).audio } : {}),
        ...(record.analysis !== undefined ? { analysis: aiUsage.normalizeAnalysis(record.analysis) } : {}) };
    } catch { throw fail(503, '저장된 회의 파일을 읽지 못했습니다. 기존 파일은 보존합니다.'); }
  }
  function recordingPath(slot, id) {
    recordPath(slot, id);
    return path.join(directory(slot), `녹음-${id}.json`);
  }
  function recording(slot, id) {
    const file = recordingPath(slot, id);
    if (!fs.existsSync(file)) throw fail(404, '저장된 녹음을 찾지 못했습니다.');
    return readJson(file);
  }
  const allPresets = () => Array.from({ length: MAX_PROJECTS }, (_, i) => preset(i + 1));
  function hasRecords(slot) {
    const dir = directory(slot);
    return fs.existsSync(dir) && fs.readdirSync(dir).some(name => /^(회의|녹음)-[0-9a-f-]{36}\.json$/.test(name));
  }
  // 내 형식은 프로젝트와 관계없이 하나만 두고, 설정 파일 2판에 함께 담는다.
  const customFile = path.join(root, '내형식.json');
  return {
    projects: allPresets,
    customFormat() {
      if (!fs.existsSync(customFile)) return null;
      try { return formats.validateCustom(readJson(customFile)); }
      catch { throw fail(503, '내 형식 파일을 읽지 못했습니다. 회의자료 폴더의 내형식.json을 확인하세요. 기존 파일은 보존합니다.'); }
    },
    saveCustomFormat(data) {
      let value;
      try { value = formats.validateCustom(data); } catch (error) { throw fail(400, error.message); }
      write(customFile, JSON.stringify(value, null, 2));
      return value;
    },
    deleteCustomFormat() {
      if (fs.existsSync(customFile)) remove(customFile);
      return null;
    },
    savePreset(slot, data) {
      const previous = preset(slot);
      if (data.revision !== previous.revision) throw fail(409, '다른 창에서 프리셋이 바뀌었습니다. 다시 불러온 뒤 저장하세요.');
      const value = { slot, name: text(data.name, 100, true).trim(), title: text(data.title, 160, true).trim(),
        context: text(data.context, 4000), outputFormat: outputFormat(data.outputFormat ?? previous.outputFormat), revision: previous.revision + 1 };
      write(path.join(directory(slot), '설정.json'), JSON.stringify(value, null, 2));
      return value;
    },
    deletePreset(slot, revision) {
      // 회의나 녹음이 하나라도 있으면 기록이 이름 없는 프로젝트에 남지 않도록 삭제를 막는다.
      const previous = preset(slot);
      if (revision !== previous.revision) throw fail(409, '다른 창에서 프리셋이 바뀌었습니다. 다시 불러온 뒤 삭제하세요.');
      if (!previous.name) throw fail(400, '저장된 프로젝트가 아닙니다.');
      if (hasRecords(slot)) throw fail(409, '회의 기록이 있는 프로젝트는 삭제할 수 없습니다.');
      fs.unlinkSync(path.join(directory(slot), '설정.json'));
      return allPresets();
    },
    listMeetings(slot) {
      const dir = directory(slot);
      if (!fs.existsSync(dir)) return [];
      const ids = [...new Set(fs.readdirSync(dir).filter(name => /^(회의|녹음)-[0-9a-f-]{36}\.json$/.test(name)).map(name => name.slice(3, -5)))];
      const records = ids.map(id => loadMeeting(slot, id));
      const analyzed = new Set(records.filter(r => r.minutes).map(r => r.recordingId || r.id));
      const latest = new Map();
      for (const record of records.filter(r => r.minutes || !analyzed.has(r.id)).sort((a,b) => b.savedAt.localeCompare(a.savedAt))) {
        const key = record.recordingId || record.id;
        if (!latest.has(key)) latest.set(key, record);
      }
      return [...latest.values()].map(record => {
        return { id: record.id, title: record.title, date: record.date, projectName: record.projectName, savedAt: record.savedAt,
          dailySequence: record.dailySequence, outputFormat: record.outputFormat,
          analyzed: Boolean(record.minutes), audioCount: record.audio?.length || 0, expectedParts: record.expectedParts };
      }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    loadMeeting,
    createRecording(slot, id, data) {
      const project = preset(slot);
      if (!project.name) throw fail(400, '먼저 프로젝트를 등록하세요.');
      const file = recordingPath(slot, id);
      if (!Number.isInteger(data.expectedParts) || data.expectedParts < 1 || data.expectedParts > 1000) throw fail(400, '녹음 파일 수를 확인하세요.');
      const notes = text(data.notes ?? '', 4000);
      const format = meetingFormat(data);
      const metadata = { id, title: text(data.title, 160, true), date: text(data.date, 30), participants: text(data.participants, 2000),
        context: text(data.context, 4000), expectedParts: data.expectedParts, ...(notes ? { notes } : {}), ...formatFields(format) };
      if (fs.existsSync(file)) {
        const previous = recording(slot, id);
        if (Object.keys(metadata).some(key => JSON.stringify(metadata[key]) !== JSON.stringify(previous[key])) || notes !== (previous.notes ?? '') || format.outputFormat !== (previous.outputFormat ?? 'meeting')) throw fail(409, '기존 녹음의 회의 정보와 다릅니다.');
        return previous;
      }
      const result = { ...metadata, slot, dailySequence: sequenceFor(slot, metadata.date, id), projectName: project.name, savedAt: new Date().toISOString(), audio: [] };
      atomicWrite(file, JSON.stringify(result, null, 2));
      return result;
    },
    saveAudio(slot, id, index, type, bytes) {
      const record = recording(slot, id);
      if (!Number.isInteger(index) || index < 1 || index > record.expectedParts) throw fail(400, '녹음 순서를 확인하세요.');
      const extension = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/wav': 'wav' }[type];
      if (!extension || !bytes.length) throw fail(400, '원음 파일 형식을 확인하세요.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const previous = record.audio.find(part => part.index === index);
      if (previous) {
        if (previous.hash !== hash || previous.type !== type) throw fail(409, '이미 저장된 원음을 덮어쓸 수 없습니다.');
        const existingBytes = fs.readFileSync(path.join(directory(slot), previous.file));
        if (createHash('sha256').update(existingBytes).digest('hex') !== hash) throw fail(503, '저장된 원음 파일을 확인하지 못했습니다.');
        return previous;
      }
      const part = { index, type, hash, size: bytes.length, file: `원음-${id}-${String(index).padStart(3, '0')}.${extension}` };
      atomicWrite(path.join(directory(slot), part.file), bytes);
      record.audio.push(part);
      record.audio.sort((a, b) => a.index - b.index);
      atomicWrite(recordingPath(slot, id), JSON.stringify(record, null, 2));
      return part;
    },
    saveTranscript(slot, id, value) {
      const record = recording(slot, id);
      if (record.audio.length !== record.expectedParts) throw fail(409, '모든 원음 저장을 완료한 뒤 전사를 보관하세요.');
      const transcript = text(value, 2000000, true);
      atomicWrite(path.join(directory(slot), `전사-${id}.txt`), transcript);
    },
    loadAudio(slot, id, index) {
      const part = recording(slot, id).audio.find(item => item.index === index);
      if (!part) throw fail(404, '원음 파일을 찾지 못했습니다.');
      const bytes = fs.readFileSync(path.join(directory(slot), part.file));
      if (createHash('sha256').update(bytes).digest('hex') !== part.hash) throw fail(503, '원음 파일이 변경되었거나 손상됐습니다.');
      return { type: part.type, bytes };
    },
    saveMeeting(slot, data) {
      const project = preset(slot);
      if (!project.name) throw fail(400, '먼저 프로젝트 이름과 프리셋을 저장하세요.');
      const file = recordPath(slot, data.id);
      if (data.recordingId) recording(slot, data.recordingId);
      const notes = text(data.notes ?? '', 4000);
      const format = meetingFormat(data);
      const analysis = aiUsage.normalizeAnalysis(data.analysis);
      const content = { id: data.id, title: text(data.title, 160, true), date: text(data.date, 30),
        participants: text(data.participants, 2000), context: text(data.context, 4000), ...(notes ? { notes } : {}), ...formatFields(format), transcript: text(data.transcript, 2000000, true),
        minutes: validateMinutes(data.minutes), ...(data.recordingId ? { recordingId: data.recordingId } : {}), ...(analysis ? { analysis } : {}) };
      const fingerprint = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      if (fs.existsSync(file)) {
        const previous = loadMeeting(slot, data.id);
        if (previous.fingerprint !== fingerprint) throw fail(409, '기존 회의 기록은 덮어쓸 수 없습니다. 새 회의로 저장하세요.');
        return previous;
      }
      const dailySequence = sequenceFor(slot, content.date, data.recordingId || data.id);
      const safe = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
      const prefix = `${safe(content.date) || '날짜미입력'}-${String(dailySequence).padStart(2, '0')}차-${safe(content.title)}-${data.id.slice(0, 8)}`;
      const artifacts = { transcript: `${prefix}-전사.txt`, summary: `${prefix}-회의록.txt`, response: `${prefix}-요약.json` };
      const record = { ...content, slot, dailySequence, artifacts, projectName: project.name, savedAt: new Date().toISOString(), fingerprint };
      atomicWrite(path.join(directory(slot), artifacts.transcript), content.transcript);
      atomicWrite(path.join(directory(slot), artifacts.summary), markdown(record));
      atomicWrite(path.join(directory(slot), artifacts.response), JSON.stringify(content.minutes, null, 2));
      atomicWrite(file.replace(/\.json$/, '.md'), markdown(record));
      atomicWrite(file, JSON.stringify(record, null, 2));
      return record;
    }
  };
}
module.exports = { createProjectStore };
