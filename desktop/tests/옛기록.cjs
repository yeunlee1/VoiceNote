// 시험용으로 1.2.0까지 쓰던 옛 프로젝트-0N 폴더(프리셋·녹음·원음·회의 결과)를 그때 모양 그대로 만드는 도우미다.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const legacyMinutes = { overview: '옛 회의 요약', topics: [], decisions: ['옛 결정'], actions: [], openQuestions: [] };

// slot번 옛 폴더에 프리셋과 녹음(원음 한 개)을 쓰고, analyzed면 그 녹음의 결과 하나도 쓴다. 기록에는 location이 없고 slot만 있다.
// recording이 false면 녹음 없이 전사만 붙여 정리한 옛 결과 하나만 쓴다.
function legacyMeeting(root, slot, options = {}) {
  const { projectName = '홈페이지 개편', title = '옛 주간 회의', date = '2026-09-01', dailySequence = 1, savedAt = '2026-09-01T09:00:00.000Z', analyzed = true, recording = true } = options;
  const dir = path.join(root, `프로젝트-${String(slot).padStart(2, '0')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '설정.json'), JSON.stringify({ slot, name: projectName, title: '주간 회의', context: '옛 프로젝트 배경', outputFormat: 'meeting', revision: 1 }, null, 2));
  if (!recording) {
    const id = randomUUID();
    const record = { id, title, date, participants: '김과장', context: '옛 프로젝트 배경', transcript: '옛 회의 발언입니다.', minutes: legacyMinutes,
      slot, dailySequence, artifacts: {}, projectName, savedAt, fingerprint: 'legacy' };
    fs.writeFileSync(path.join(dir, `회의-${id}.json`), JSON.stringify(record, null, 2));
    return { dir, id, record };
  }
  const recordingId = randomUUID();
  const bytes = Buffer.from(`옛 원음 ${recordingId}`);
  const audioFile = `원음-${recordingId}-001.webm`;
  fs.writeFileSync(path.join(dir, audioFile), bytes);
  const audio = [{ index: 1, type: 'audio/webm', hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, file: audioFile }];
  fs.writeFileSync(path.join(dir, `녹음-${recordingId}.json`), JSON.stringify({ id: recordingId, title, date, participants: '김과장', context: '옛 프로젝트 배경',
    expectedParts: 1, slot, dailySequence, projectName, savedAt, audio }, null, 2));
  if (!analyzed) return { dir, recordingId, bytes };
  const id = randomUUID();
  const record = { id, title, date, participants: '김과장', context: '옛 프로젝트 배경', transcript: '옛 회의 발언입니다.', minutes: legacyMinutes, recordingId,
    slot, dailySequence, artifacts: {}, projectName, savedAt, fingerprint: 'legacy' };
  fs.writeFileSync(path.join(dir, `회의-${id}.json`), JSON.stringify(record, null, 2));
  return { dir, recordingId, bytes, id, record };
}

module.exports = { legacyMeeting, legacyMinutes };
