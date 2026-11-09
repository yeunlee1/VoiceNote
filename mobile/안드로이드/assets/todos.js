// 회의록의 할 일에 사람이 맞춘 담당자·문장·기한·체크를 AI 결과와 합치고 이름순으로 정리하는 규칙을 브라우저·Node에서 함께 쓴다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeetingTodos = api;
})(typeof window === 'object' ? window : globalThis, function () {
  const LIMITS = { people: 20, task: 2000, field: 200 };
  // 한글은 글자 코드 순서가 곧 가나다순이다. 언어별 정렬은 기기마다 공백을 다르게 다뤄 Windows와 Android 결과가 달라질 수 있어 쓰지 않는다.
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const same = text => String(text ?? '').trim().replace(/\s+/g, ' ');
  // AI가 빈 글자나 공백 붙은 이름을 주어도 저장본과 같은 기준으로 비교한다.
  const field = value => String(value ?? '').trim() || null;
  const hasOwner = item => Boolean(same(item.owner));

  // 참석자 칸은 자유 입력이라 쉼표·줄바꿈으로만 나눈다. '김민수 팀장'처럼 공백이 든 이름은 한 사람이다.
  function people(text) {
    const names = String(text ?? '').split(/[,，、;；\r\n]+/).map(name => name.trim()).filter(name => name && name.length <= LIMITS.field);
    return [...new Set(names)].slice(0, LIMITS.people);
  }
  function ownerNumber(owner, list) {
    return owner ? list.indexOf(owner) + 1 : 0;
  }
  function initial(minutes) {
    return (minutes?.actions || []).map(action => ({ task: action.task, owner: field(action.owner), due: field(action.due), done: false }));
  }
  function matches(minutes, edits) {
    return Array.isArray(edits?.items) && edits.items.length === (minutes?.actions || []).length;
  }
  function effective(minutes, edits) {
    return matches(minutes, edits) ? edits.items : initial(minutes);
  }
  function sorted(items) {
    // 같은 이름끼리는 원래 순서를 지키도록 위치를 함께 비교한다.
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
      const left = hasOwner(a.item), right = hasOwner(b.item);
      if (left !== right) return left ? -1 : 1;
      return (left ? compare(same(a.item.owner), same(b.item.owner)) : 0) || a.index - b.index;
    }).map(entry => entry.item);
  }
  function apply(minutes, edits) {
    if (!matches(minutes, edits)) return minutes;
    // 체크만 한 회의록은 AI 순서를 두고, 사람이 담당자를 맞췄거나 맞추기를 끝낸 회의록만 이름순으로 정리한다.
    const assigned = edits.finalized || edits.items.some((item, index) => field(item.owner) !== field(minutes.actions[index].owner));
    const items = assigned ? sorted(edits.items) : edits.items;
    return { ...minutes, actions: items.map(({ task, owner, due }) => ({ task, owner, due })) };
  }
  function carryOver(previous, edits, next) {
    if (!matches(previous, edits)) return null;
    const freshItems = initial(next);
    // 새 일마다 이어 줄 이전 일을 찾는다. 사람이 고친 문장과 AI의 원래 문장 중 어느 쪽이 같아도 같은 일로 본다.
    const candidates = freshItems.map(fresh => edits.items.flatMap((item, index) => (same(item.task) === same(fresh.task) || same(previous.actions[index].task) === same(fresh.task) ? [index] : [])));
    const uses = edits.items.map((_, index) => candidates.filter(found => found.includes(index)).length);
    let carried = false;
    const items = freshItems.map((fresh, at) => {
      // 일대일로 맞지 않으면 어느 일인지 확실하지 않으므로 잇지 않는다.
      if (candidates[at].length !== 1 || uses[candidates[at][0]] !== 1) return fresh;
      const item = edits.items[candidates[at][0]], ai = previous.actions[candidates[at][0]];
      // 사람이 고친 값만 잇고, 사람이 손대지 않은 값은 의견을 반영한 AI의 새 값을 따른다.
      const task = same(item.task) !== same(ai.task) ? item.task : fresh.task;
      const owner = field(item.owner) !== field(ai.owner) ? field(item.owner) : fresh.owner;
      const due = field(item.due) !== field(ai.due) ? field(item.due) : fresh.due;
      // AI가 담당이나 기한을 바꿨으면 새로운 일일 수 있어 끝났다는 표시는 잇지 않는다.
      const done = item.done && field(ai.owner) === fresh.owner && field(ai.due) === fresh.due;
      if (done || task !== fresh.task || owner !== fresh.owner || due !== fresh.due) carried = true;
      return { task, owner, due, done };
    });
    return carried ? { finalized: Boolean(edits.finalized), items } : null;
  }
  function validate(data, count, actions = null) {
    const invalid = () => new Error('할 일 내용을 확인하세요.');
    if (data === null || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !['finalized', 'items'].includes(key))) throw invalid();
    if (typeof data.finalized !== 'boolean' || !Array.isArray(data.items) || data.items.length !== count) throw invalid();
    const field = value => {
      if (value !== null && typeof value !== 'string') throw invalid();
      const text = value === null ? '' : value.trim();
      if (text.length > LIMITS.field) throw invalid();
      return text || null;
    };
    const items = data.items.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['task', 'owner', 'due', 'done'].includes(key))) throw invalid();
      if (typeof item.task !== 'string' || typeof item.done !== 'boolean') throw invalid();
      const task = item.task.trim();
      // AI 결과에 원래 빈 문장이 있으면 그 줄 때문에 나머지 저장이 막히지 않게 둔다. 사람이 문장을 지우는 것은 막는다.
      const blankFromAi = Boolean(actions) && !String(actions[index]?.task ?? '').trim();
      if ((!task && !blankFromAi) || task.length > LIMITS.task) throw invalid();
      return { task, owner: field(item.owner ?? null), due: field(item.due ?? null), done: item.done };
    });
    return { version: 1, finalized: data.finalized, items };
  }
  return { LIMITS, people, ownerNumber, initial, effective, sorted, apply, carryOver, validate };
});
