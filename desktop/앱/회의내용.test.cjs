// 회의별 상세 회의내용(notes)이 녹음·회의록 저장과 다시 열기에서 보존되고 옛 기록과 호환되는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProjectStore } = require('./프로젝트보관.cjs');

const minutes = { overview: '핵심', topics: [], decisions: [], actions: [], openQuestions: [] };
function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-notes-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = createProjectStore(dir, value => value);
  value.savePreset(2, { name: '시험 프로젝트', title: '주간 회의', context: '프로젝트 설명', revision: 0 });
  return { dir, value };
}
const base = { title: '주간 회의', date: '2026-10-01', participants: '김', context: '프로젝트 설명', expectedParts: 1 };

test('상세 회의내용을 녹음과 회의록에 저장하고 다시 열 때 그대로 돌려준다', t => {
  const { dir, value } = store(t);
  const id = randomUUID(), resultId = randomUUID();
  const notes = '1) 표준 양식 범위\n2) 개발 순서';
  value.createRecording(2, id, { ...base, notes });
  assert.equal(value.loadMeeting(2, id).notes, notes);
  value.saveAudio(2, id, 1, 'audio/webm', Buffer.from('audio'));
  value.saveMeeting(2, { id: resultId, recordingId: id, title: base.title, date: base.date, participants: base.participants,
    context: base.context, notes, transcript: '발언', minutes });
  const reopened = value.loadMeeting(2, resultId);
  assert.equal(reopened.notes, notes);
  assert.equal(reopened.context, '프로젝트 설명');
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '프로젝트-02', `회의-${resultId}.md`), 'utf8'), /표준 양식 범위/);
});

test('같은 녹음 재요청은 같은 상세내용이면 통과하고 다르면 거절한다', t => {
  const { value } = store(t);
  const id = randomUUID();
  value.createRecording(2, id, { ...base, notes: '안건' });
  assert.doesNotThrow(() => value.createRecording(2, id, { ...base, notes: '안건' }));
  assert.throws(() => value.createRecording(2, id, { ...base, notes: '다른 안건' }), error => error.status === 409);
});

test('상세내용 필드가 없는 옛 녹음 파일은 빈 상세내용 재요청과 호환된다', t => {
  const { dir, value } = store(t);
  const id = randomUUID();
  value.createRecording(2, id, base);
  const file = path.join(dir, '프로젝트-02', `녹음-${id}.json`);
  assert.equal('notes' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  assert.doesNotThrow(() => value.createRecording(2, id, { ...base, notes: '' }));
  assert.throws(() => value.createRecording(2, id, { ...base, notes: 4001 }), error => error.status === 400);
  assert.throws(() => value.createRecording(2, randomUUID(), { ...base, notes: '가'.repeat(4001) }), error => error.status === 400);
});

test('상세내용 없이 저장한 회의록은 기존 형식과 같은 지문을 유지한다', t => {
  const { value } = store(t);
  const resultId = randomUUID();
  const record = { id: resultId, title: base.title, date: base.date, participants: '', context: '', transcript: '발언', minutes };
  value.saveMeeting(2, record);
  assert.equal('notes' in value.loadMeeting(2, resultId), false);
  assert.doesNotThrow(() => value.saveMeeting(2, { ...record, notes: '' }));
});
