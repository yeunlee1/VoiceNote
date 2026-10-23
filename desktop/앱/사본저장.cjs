// 분석 결과의 전사·요약(.md·.txt)·원음을 사용자가 고른 폴더에 사본으로 쓰고, 무엇을 어디에 썼는지 보관함의 사본 기록에 남긴다.
const realFs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { markdown, plainText } = require('./회의문서.cjs');
const { artifactPrefix } = require('./회의보관.cjs');

const RESULT_KINDS = [
  { kind: 'transcript', folder: 'transcript', suffix: '-전사.txt', content: files => files.transcript },
  { kind: 'summaryMd', folder: 'summary', suffix: '-요약.md', content: files => markdown(files.record) },
  { kind: 'summaryTxt', folder: 'summary', suffix: '-요약.txt', content: files => plainText(files.record) },
];
const NOT_SELECTED = '설정에서 저장 위치를 고르지 않았습니다.';
const ALREADY = '이미 이 폴더에 저장했습니다.';

function reason(error) {
  if (error?.code === 'EPERM' || error?.code === 'EACCES') return '고른 폴더에 쓸 권한이 없습니다.';
  if (error?.code === 'ENOENT') return '고른 폴더를 찾을 수 없습니다.';
  if (error?.code === 'ENOSPC') return '디스크 공간이 부족합니다.';
  return '파일을 쓰지 못했습니다.';
}
// 사본 기록은 앱 자료 폴더에 있으므로 실제 파일 시스템으로 읽고 쓴다. 읽지 못하면 기록이 없는 것으로 보고 다시 쓴다.
function readLog(file) {
  try {
    const value = JSON.parse(realFs.readFileSync(file, 'utf8'));
    return value?.version === 1 && Array.isArray(value.items) ? value.items.filter(item => item && typeof item.folder === 'string' && typeof item.name === 'string') : [];
  } catch { return []; }
}
function writeLog(file, items) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    realFs.writeFileSync(temporary, JSON.stringify({ version: 1, items }, null, 2), { flag: 'wx' });
    realFs.renameSync(temporary, file);
  } finally {
    try { realFs.unlinkSync(temporary); } catch {}
  }
}

function createCopyWriter({ store, storage, fs = realFs }) {
  // 쓰려는 이름에 다른 파일이 이미 있으면 덮어쓰지 않고 이름 끝에 (2), (3)을 붙인다.
  function freeName(folder, name) {
    const extension = path.extname(name), stem = name.slice(0, name.length - extension.length);
    for (let number = 1; ; number++) {
      const candidate = number === 1 ? name : `${stem} (${number})${extension}`;
      if (!fs.existsSync(path.join(folder, candidate))) return candidate;
    }
  }
  // 임시 파일을 최종 이름에 붙인다. 하드 링크는 대상이 이미 있으면 EEXIST로 실패하므로 남의 파일을 덮지 않는다.
  // 하드 링크를 못 쓰는 드라이브(FAT·exFAT 등)는 대상을 배타적으로 새로 만들어 쓴다. 실패하면 이 함수가 만든 파일일 때만 지운다.
  function place(from, to, data) {
    try {
      fs.linkSync(from, to);
      return;
    } catch (error) {
      if (error.code === 'EEXIST') throw error;
    }
    const descriptor = fs.openSync(to, 'wx');
    try {
      fs.writeFileSync(descriptor, data);
      fs.closeSync(descriptor);
    } catch (error) {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(to); } catch {}
      throw error;
    }
  }
  // 임시 이름으로 다 쓴 뒤 최종 이름을 붙인다. 그 사이 같은 이름 파일이 생기면 다음 이름을 쓴다. 임시 파일은 언제나 지운다.
  function writeCopy(folder, base, data) {
    const temporary = path.join(folder, `.${base}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temporary, data, { flag: 'wx' });
      for (;;) {
        const name = freeName(folder, base);
        try {
          place(temporary, path.join(folder, name), data);
          return name;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
    } finally {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
  const saved = (items, match, folder) => items.some(item => match(item) && item.folder === folder && item.ok && fs.existsSync(path.join(folder, item.name)));
  // 같은 종류·같은 폴더의 옛 기록은 새 결과로 바꾸고, 다른 폴더의 기록은 남긴다.
  const remember = (items, match, entry) => [...items.filter(item => !(match(item) && item.folder === entry.folder)), entry];

  // 지금 설정된 폴더 기준으로, 아직 성공하지 않았거나 저장한 파일이 사라진 사본만 쓴다.
  function copyResult(location, resultId) {
    const files = store.resultFiles(location, resultId);
    const folders = storage();
    const report = { ok: true, written: [], skipped: [], failed: [] };
    // 실제로 쓴 이름(충돌로 (2)가 붙었을 수 있음)과 성공 여부를 돌려준다.
    const attempt = (kind, folder, base, data) => {
      try {
        const name = writeCopy(folder, base, data);
        report.written.push({ kind, path: path.join(folder, name) });
        return { name, ok: true };
      } catch (error) {
        report.failed.push({ kind, message: reason(error) });
        return { name: base, ok: false };
      }
    };
    const resultLog = path.join(files.directory, `사본기록-${resultId}.json`);
    let items = readLog(resultLog), changed = false;
    const prefix = artifactPrefix(files.record);
    for (const spec of RESULT_KINDS) {
      const folder = folders[spec.folder];
      const match = item => item.kind === spec.kind;
      if (!folder) report.skipped.push({ kind: spec.kind, reason: NOT_SELECTED });
      else if (saved(items, match, folder)) report.skipped.push({ kind: spec.kind, reason: ALREADY });
      else {
        items = remember(items, match, { kind: spec.kind, folder, ...attempt(spec.kind, folder, `${prefix}${spec.suffix}`, spec.content(files)) });
        changed = true;
      }
    }
    if (changed) writeLog(resultLog, items);
    // 원음은 결과가 아니라 녹음에 딸린 것이라 녹음 id로 기록한다. 다시 분석해 제목이 바뀌어도 같은 원음은 다시 쓰지 않는다.
    if (files.recordingId && files.audio.length) {
      const folder = folders.audio;
      if (!folder) report.skipped.push({ kind: 'audio', reason: NOT_SELECTED });
      else {
        const audioLog = path.join(files.directory, `사본기록-원음-${files.recordingId}.json`);
        let audioItems = readLog(audioLog), audioChanged = false;
        const audioPrefix = artifactPrefix({ ...files.record, id: files.recordingId });
        for (const part of files.audio) {
          const match = item => item.index === part.index;
          if (saved(audioItems, match, folder)) { report.skipped.push({ kind: 'audio', reason: ALREADY }); continue; }
          const base = `${audioPrefix}-원음-${String(part.index).padStart(2, '0')}${path.extname(part.file)}`;
          let outcome;
          try { outcome = attempt('audio', folder, base, realFs.readFileSync(part.file)); }
          catch { report.failed.push({ kind: 'audio', message: '앱에 보관된 원음 파일을 읽지 못했습니다.' }); outcome = { name: base, ok: false }; }
          audioItems = remember(audioItems, match, { index: part.index, folder, ...outcome });
          audioChanged = true;
        }
        if (audioChanged) writeLog(audioLog, audioItems);
      }
    }
    report.ok = report.failed.length === 0;
    return report;
  }
  return { copyResult };
}

module.exports = { createCopyWriter };
