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
  // 임시 이름으로 다 쓴 뒤 이름을 바꾼다. 중간에 실패하면 만들던 임시 파일을 지워 반쪽 파일을 남기지 않는다.
  function writeCopy(folder, name, data) {
    const temporary = path.join(folder, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(temporary, data, { flag: 'wx' });
      fs.renameSync(temporary, path.join(folder, name));
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch {}
      throw error;
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
    const attempt = (kind, folder, name, data) => {
      try {
        writeCopy(folder, name, data);
        report.written.push({ kind, path: path.join(folder, name) });
        return true;
      } catch (error) {
        report.failed.push({ kind, message: reason(error) });
        return false;
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
        const name = freeName(folder, `${prefix}${spec.suffix}`);
        items = remember(items, match, { kind: spec.kind, folder, name, ok: attempt(spec.kind, folder, name, spec.content(files)) });
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
          const name = freeName(folder, `${audioPrefix}-원음-${String(part.index).padStart(2, '0')}${path.extname(part.file)}`);
          let ok;
          try { ok = attempt('audio', folder, name, realFs.readFileSync(part.file)); }
          catch { report.failed.push({ kind: 'audio', message: '앱에 보관된 원음 파일을 읽지 못했습니다.' }); ok = false; }
          audioItems = remember(audioItems, match, { index: part.index, folder, name, ok });
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
