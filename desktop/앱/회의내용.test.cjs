// 회의별 상세 회의내용(notes)이 녹음·회의록 저장과 다시 열기에서 보존되고 옛 기록과 호환되는지 검증한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createMeetingStore } = require('./회의보관.cjs');

const minutes = { overview: '핵심', topics: [], decisions: [], actions: [], openQuestions: [] };
function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-notes-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = createMeetingStore(dir, value => value);
  return { dir, value };
}
const base = { title: '주간 회의', date: '2026-10-01', participants: '김', expectedParts: 1 };

test('상세 회의내용을 녹음과 회의록에 저장하고 다시 열 때 그대로 돌려준다', t => {
  const { dir, value } = store(t);
  const id = randomUUID(), resultId = randomUUID();
  const notes = '1) 표준 양식 범위\n2) 개발 순서';
  value.createRecording('main', id, { ...base, notes });
  assert.equal(value.loadMeeting('main', id).meeting.notes, notes);
  value.saveAudio('main', id, 1, 'audio/webm', Buffer.from('audio'));
  value.saveMeeting('main', { id: resultId, recordingId: id, title: base.title, date: base.date, participants: base.participants,
    context: '보내도 저장하지 않는 옛 프로젝트 배경', notes, transcript: '발언', minutes });
  const reopened = value.loadMeeting('main', resultId).meeting;
  assert.equal(reopened.notes, notes);
  assert.equal('context' in reopened, false);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '회의기록', `회의-${resultId}.md`), 'utf8'), /표준 양식 범위/);
});

test('같은 녹음 재요청은 같은 상세내용이면 통과하고 다르면 거절한다', t => {
  const { value } = store(t);
  const id = randomUUID();
  value.createRecording('main', id, { ...base, notes: '안건' });
  assert.doesNotThrow(() => value.createRecording('main', id, { ...base, notes: '안건' }));
  assert.throws(() => value.createRecording('main', id, { ...base, notes: '다른 안건' }), error => error.status === 409);
});

test('상세내용 필드가 없는 옛 녹음 파일은 빈 상세내용 재요청과 호환된다', t => {
  const { dir, value } = store(t);
  const id = randomUUID();
  value.createRecording('main', id, base);
  const file = path.join(dir, '회의기록', `녹음-${id}.json`);
  assert.equal('notes' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  assert.doesNotThrow(() => value.createRecording('main', id, { ...base, notes: '' }));
  assert.throws(() => value.createRecording('main', id, { ...base, notes: 4001 }), error => error.status === 400);
  assert.throws(() => value.createRecording('main', randomUUID(), { ...base, notes: '가'.repeat(4001) }), error => error.status === 400);
});

test('상세내용 없이 저장한 회의록은 기존 형식과 같은 지문을 유지한다', t => {
  const { value } = store(t);
  const resultId = randomUUID();
  const record = { id: resultId, title: base.title, date: base.date, participants: '', transcript: '발언', minutes };
  value.saveMeeting('main', record);
  assert.equal('notes' in value.loadMeeting('main', resultId).meeting, false);
  assert.doesNotThrow(() => value.saveMeeting('main', { ...record, notes: '' }));
});
