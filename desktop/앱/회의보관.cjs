// 기본 보관함(회의기록)과 옛 프로젝트 보관함 세 곳의 녹음·원음·전사·회의 결과·평가를 실행 폴더에 보관한다.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const aiUsage = require('./AI사용량.js');
const formats = require('./출력형식.js');
const { markdown } = require('./회의문서.cjs');
// 새 회의는 main에만 쌓는다. 1.2.0까지 쓰던 프로젝트 1~3번 폴더는 옛 보관함으로 열기·다시 분석만 하고, 4~9번 폴더는 건드리지 않는다.
const LOCATIONS = Object.freeze({ main: '회의기록', p1: '프로젝트-01', p2: '프로젝트-02', p3: '프로젝트-03' });
const LEGACY_SLOTS = Object.freeze({ p1: 1, p2: 2, p3: 3 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const recordName = /^(회의|녹음)-([0-9a-f-]{36})\.json$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw fail(400, '회의 입력 내용을 확인하세요.');
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
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
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
// 결과 파일 이름의 앞부분이다. 고른 폴더에 쓰는 사본도 같은 앞부분을 쓴다.
function artifactPrefix(record) {
  const safe = value => value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  return `${safe(record.date) || '날짜미입력'}-${String(record.dailySequence).padStart(2, '0')}차-${safe(record.title)}-${record.id.slice(0, 8)}`;
}
// 옛 기록은 slot 번호로, 새 기록은 location 이름으로 자기 보관함을 밝힌다. 다른 폴더로 옮겨진 기록은 읽지 않는다.
function belongs(record, location) {
  if (record.location === undefined) return LEGACY_SLOTS[location] !== undefined && record.slot === LEGACY_SLOTS[location];
  return record.location === location;
}
const savedAt = record => String(record.savedAt ?? '');
function createMeetingStore(root, validateMinutes, options = {}) {
  const write = options.atomicWrite ?? atomicWrite;
  const remove = options.removeFile ?? (file => fs.unlinkSync(file));
  function directory(location) {
    if (!Object.hasOwn(LOCATIONS, location)) throw fail(404, '보관함을 확인하세요.');
    return path.join(root, LOCATIONS[location]);
  }
  function checkId(id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw fail(400, '회의 식별자를 확인하세요.');
    return id;
  }
  const recordPath = (location, id) => path.join(directory(location), `회의-${checkId(id)}.json`);
  const recordingPath = (location, id) => path.join(directory(location), `녹음-${checkId(id)}.json`);
  const reviewPath = (location, id) => path.join(directory(location), `평가-${checkId(id)}.json`);
  // 보관함 폴더에서 녹음·결과 파일만 고른다. 남은 .tmp나 사용자가 둔 다른 파일은 기록으로 보지 않는다.
  function recordFiles(location) {
    const dir = directory(location);
    return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => recordName.exec(name)).filter(Boolean) : [];
  }
  function sequenceFor(location, date, meetingId) {
    const dir = directory(location);
    const records = [];
    for (const [name] of recordFiles(location)) {
      try {
        const record = readJson(path.join(dir, name));
        if (record.date === date && typeof record.id === 'string' && belongs(record, location)) records.push(record);
      } catch {}
    }
    records.sort((a, b) => savedAt(a).localeCompare(savedAt(b)) || a.id.localeCompare(b.id));
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
  function recording(location, id) {
    const file = recordingPath(location, id);
    if (!fs.existsSync(file)) throw fail(404, '저장된 녹음을 찾지 못했습니다.');
    const value = readJson(file);
    if (value.id !== id || !belongs(value, location)) throw fail(503, '저장된 녹음 파일을 읽지 못했습니다. 기존 파일은 보존합니다.');
    return value;
  }
  function load(location, id) {
    const file = recordPath(location, id);
    const draftFile = recordingPath(location, id);
    if (!fs.existsSync(file) && fs.existsSync(draftFile)) {
      let draft;
      try {
        draft = readJson(draftFile);
        if (draft.id !== id || !belongs(draft, location)) throw new Error();
      } catch { throw fail(503, '저장된 녹음 파일을 읽지 못했습니다. 기존 파일은 보존합니다.'); }
      const transcriptFile = path.join(directory(location), `전사-${id}.txt`);
      return { ...draft, location, ...storedFormat(draft), dailySequence: draft.dailySequence || sequenceFor(location, draft.date, id),
        transcript: fs.existsSync(transcriptFile) ? fs.readFileSync(transcriptFile, 'utf8') : '', minutes: null };
    }
    if (!fs.existsSync(file)) throw fail(404, '저장된 회의를 찾지 못했습니다.');
    try {
      const record = readJson(file);
      if (record.id !== id || !belongs(record, location)) throw new Error();
      validateMinutes(record.minutes);
      const audioFile = recordingPath(location, record.recordingId || id);
      return { ...record, location, ...storedFormat(record), dailySequence: record.dailySequence || sequenceFor(location, record.date, record.recordingId || id),
        ...(fs.existsSync(audioFile) ? { audio: readJson(audioFile).audio } : {}), ...(record.analysis !== undefined ? { analysis: aiUsage.normalizeAnalysis(record.analysis) } : {}) };
    } catch { throw fail(503, '저장된 회의 파일을 읽지 못했습니다. 기존 파일은 보존합니다.'); }
  }
  // 평가 파일이 없거나 읽을 수 없으면 평가가 없는 것으로 본다. 목록 전체가 평가 파일 하나 때문에 실패하지 않게 한다.
  function loadReview(location, id) {
    const file = reviewPath(location, id);
    if (!fs.existsSync(file)) return null;
    try {
      const review = readJson(file);
      const stars = review.stars === null || (Number.isInteger(review.stars) && review.stars >= 1 && review.stars <= 5);
      if (review.version !== 1 || !stars || typeof review.comment !== 'string') return null;
      return { version: 1, stars: review.stars, comment: review.comment, savedAt: review.savedAt };
    } catch { return null; }
  }
  // 같은 녹음에서 나온 결과들을 저장 시각 순으로 모은다. 결과 화면의 '결과 버전' 목록에 쓴다.
  function versionsOf(location, meeting) {
    const key = meeting.recordingId || meeting.id;
    const results = [];
    for (const [name, kind, id] of recordFiles(location)) {
      if (kind !== '회의') continue;
      try {
        const record = readJson(path.join(directory(location), name));
        if (record.id === id && belongs(record, location) && (record.recordingId || record.id) === key) results.push(record);
      } catch {}
    }
    return results.sort((a, b) => savedAt(a).localeCompare(savedAt(b))).map(record => {
      const review = loadReview(location, record.id);
      return { id: record.id, savedAt: record.savedAt, outputFormat: storedFormat(record).outputFormat, refined: Boolean(record.feedback), ...(review?.stars ? { stars: review.stars } : {}) };
    });
  }
  // 내 형식은 보관함과 관계없이 하나만 두고, 설정 파일 2판에 함께 담는다.
  const customFile = path.join(root, '내형식.json');
  return {
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
    // 모든 보관함의 기록을 합쳐 녹음마다 최신 결과 하나를 날짜 최신순으로 돌려준다. 읽지 못한 파일은 건너뛰고 그 수만 센다.
    listMeetings() {
      const records = [];
      let skipped = 0;
      for (const location of Object.keys(LOCATIONS)) {
        for (const id of new Set(recordFiles(location).map(match => match[2]))) {
          try { records.push(load(location, id)); } catch { skipped++; }
        }
      }
      const keyOf = record => `${record.location}:${record.recordingId || record.id}`;
      const analyzed = new Set(records.filter(record => record.minutes).map(keyOf));
      const latest = new Map();
      for (const record of records.filter(record => record.minutes || !analyzed.has(`${record.location}:${record.id}`)).sort((a, b) => savedAt(b).localeCompare(savedAt(a)))) {
        if (!latest.has(keyOf(record))) latest.set(keyOf(record), record);
      }
      const meetings = [...latest.values()].map(record => {
        const review = record.minutes ? loadReview(record.location, record.id) : null;
        return { location: record.location, id: record.id, ...(record.recordingId ? { recordingId: record.recordingId } : {}), title: record.title, date: record.date,
          dailySequence: record.dailySequence, ...(record.projectName ? { projectName: record.projectName } : {}), savedAt: record.savedAt, outputFormat: record.outputFormat,
          analyzed: Boolean(record.minutes), audioCount: record.audio?.length || 0, ...(record.expectedParts ? { expectedParts: record.expectedParts } : {}),
          ...(review?.stars ? { stars: review.stars } : {}), refined: Boolean(record.feedback) };
      }).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || b.dailySequence - a.dailySequence || savedAt(b).localeCompare(savedAt(a)));
      return { meetings, skipped };
    },
    loadMeeting(location, id) {
      const meeting = load(location, id);
      return { meeting, versions: versionsOf(location, meeting) };
    },
    createRecording(location, id, data) {
      if (location !== 'main') { directory(location); throw fail(400, '새 녹음은 기본 보관함에만 만들 수 있습니다.'); }
      const file = recordingPath(location, id);
      if (!Number.isInteger(data.expectedParts) || data.expectedParts < 1 || data.expectedParts > 1000) throw fail(400, '녹음 파일 수를 확인하세요.');
      const notes = text(data.notes ?? '', 4000);
      const format = meetingFormat(data);
      // 회의명은 녹음 단계에서 비어 있어도 된다. 분석이 끝나면 AI가 정한 제목으로 결과를 저장한다.
      const metadata = { id, title: text(data.title ?? '', 160).trim(), date: text(data.date, 30), participants: text(data.participants, 2000),
        expectedParts: data.expectedParts, ...(notes ? { notes } : {}), ...formatFields(format) };
      if (fs.existsSync(file)) {
        const previous = recording(location, id);
        if (Object.keys(metadata).some(key => JSON.stringify(metadata[key]) !== JSON.stringify(previous[key])) || notes !== (previous.notes ?? '') || format.outputFormat !== (previous.outputFormat ?? 'meeting')) throw fail(409, '기존 녹음의 회의 정보와 다릅니다.');
        return previous;
      }
      const result = { ...metadata, location, dailySequence: sequenceFor(location, metadata.date, id), savedAt: new Date().toISOString(), audio: [] };
      atomicWrite(file, JSON.stringify(result, null, 2));
      return result;
    },
    saveAudio(location, id, index, type, bytes) {
      if (location !== 'main') { directory(location); throw fail(400, '원음은 기본 보관함의 새 녹음에만 저장할 수 있습니다.'); }
      const record = recording(location, id);
      if (!Number.isInteger(index) || index < 1 || index > record.expectedParts) throw fail(400, '녹음 순서를 확인하세요.');
      const extension = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/wav': 'wav' }[type];
      if (!extension || !bytes.length) throw fail(400, '원음 파일 형식을 확인하세요.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const previous = record.audio.find(part => part.index === index);
      if (previous) {
        if (previous.hash !== hash || previous.type !== type) throw fail(409, '이미 저장된 원음을 덮어쓸 수 없습니다.');
        const existingBytes = fs.readFileSync(path.join(directory(location), previous.file));
        if (createHash('sha256').update(existingBytes).digest('hex') !== hash) throw fail(503, '저장된 원음 파일을 확인하지 못했습니다.');
        return previous;
      }
      const part = { index, type, hash, size: bytes.length, file: `원음-${id}-${String(index).padStart(3, '0')}.${extension}` };
      atomicWrite(path.join(directory(location), part.file), bytes);
      record.audio.push(part);
      record.audio.sort((a, b) => a.index - b.index);
      atomicWrite(recordingPath(location, id), JSON.stringify(record, null, 2));
      return part;
    },
    saveTranscript(location, id, value) {
      const record = recording(location, id);
      if (record.audio.length !== record.expectedParts) throw fail(409, '모든 원음 저장을 완료한 뒤 전사를 보관하세요.');
      const transcript = text(value, 2000000, true);
      atomicWrite(path.join(directory(location), `전사-${id}.txt`), transcript);
    },
    loadAudio(location, id, index) {
      const part = recording(location, id).audio.find(item => item.index === index);
      if (!part) throw fail(404, '원음 파일을 찾지 못했습니다.');
      const bytes = fs.readFileSync(path.join(directory(location), part.file));
      if (createHash('sha256').update(bytes).digest('hex') !== part.hash) throw fail(503, '원음 파일이 변경되었거나 손상됐습니다.');
      return { type: part.type, bytes };
    },
    saveMeeting(location, data) {
      const file = recordPath(location, data.id);
      const source = data.recordingId ? recording(location, data.recordingId) : null;
      const notes = text(data.notes ?? '', 4000);
      const feedback = data.feedback === undefined || data.feedback === null ? '' : text(data.feedback, 1000).trim();
      const format = meetingFormat(data);
      const analysis = aiUsage.normalizeAnalysis(data.analysis);
      // AI도 제목을 정하지 못해 회의명이 비면 '회의'로 저장한다.
      const content = { id: data.id, title: text(data.title ?? '', 160).trim() || '회의', date: text(data.date, 30),
        participants: text(data.participants, 2000), ...(notes ? { notes } : {}), ...(feedback ? { feedback } : {}), ...formatFields(format), transcript: text(data.transcript, 2000000, true),
        minutes: validateMinutes(data.minutes), ...(data.recordingId ? { recordingId: data.recordingId } : {}), ...(analysis ? { analysis } : {}) };
      const fingerprint = createHash('sha256').update(JSON.stringify(content)).digest('hex');
      if (fs.existsSync(file)) {
        const previous = load(location, data.id);
        if (previous.fingerprint !== fingerprint) throw fail(409, '기존 회의 기록은 덮어쓸 수 없습니다. 새 회의로 저장하세요.');
        return previous;
      }
      const dailySequence = sequenceFor(location, content.date, data.recordingId || data.id);
      const prefix = artifactPrefix({ ...content, dailySequence });
      const artifacts = { transcript: `${prefix}-전사.txt`, summary: `${prefix}-회의록.txt`, response: `${prefix}-요약.json` };
      // 옛 보관함의 녹음을 다시 분석한 결과에는 그 녹음의 옛 프로젝트 이름을 옮겨 적어 목록 꼬리표가 이어지게 한다.
      const projectName = location !== 'main' && typeof source?.projectName === 'string' && source.projectName ? source.projectName : '';
      const record = { ...content, location, dailySequence, artifacts, ...(projectName ? { projectName } : {}), savedAt: new Date().toISOString(), fingerprint };
      const dir = directory(location);
      atomicWrite(path.join(dir, artifacts.transcript), content.transcript);
      atomicWrite(path.join(dir, artifacts.summary), markdown(record));
      atomicWrite(path.join(dir, artifacts.response), JSON.stringify(content.minutes, null, 2));
      atomicWrite(file.replace(/\.json$/, '.md'), markdown(record));
      atomicWrite(file, JSON.stringify(record, null, 2));
      return record;
    },
    // 평가는 결과 파일을 고치지 않고 결과마다 따로 둔다. 같은 결과에 다시 저장하면 그 평가만 바뀐다.
    saveReview(location, id, data) {
      const file = recordPath(location, id);
      if (!fs.existsSync(file)) throw fail(404, '평가할 회의 결과를 찾지 못했습니다.');
      load(location, id);
      if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['stars', 'comment'].includes(key)))
        throw fail(400, '평가 내용을 확인하세요.');
      const stars = data.stars ?? null;
      if (stars !== null && !(Number.isInteger(stars) && stars >= 1 && stars <= 5)) throw fail(400, '별점은 1~5개로 고르세요.');
      const comment = data.comment ?? '';
      if (typeof comment !== 'string' || comment.length > 1000) throw fail(400, '의견은 1,000자 이하로 적어 주세요.');
      if (stars === null && !comment.trim()) throw fail(400, '별점이나 의견을 남겨 주세요.');
      const review = { version: 1, stars, comment: comment.trim(), savedAt: new Date().toISOString() };
      atomicWrite(reviewPath(location, id), JSON.stringify(review, null, 2));
      return review;
    },
    loadReview
  };
}
module.exports = { createMeetingStore, LOCATIONS, artifactPrefix };
