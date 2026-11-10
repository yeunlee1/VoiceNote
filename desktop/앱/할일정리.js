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
  function sameName(a, b) {
    // 이름은 앞뒤 공백을 떼고 이어진 공백을 하나로 줄인 글자가 같을 때만 같은 사람이다. 빈 이름은 누구와도 같지 않다.
    const left = same(a);
    return left !== '' && left === same(b);
  }
  function candidates(participants, items) {
    // 나를 고를 후보다. 참석자가 있으면 참석자 번호 그대로, 없으면 할 일에 적힌 담당자 이름을 처음 나온 순서로 쓴다(번호 0).
    const list = people(participants);
    const source = list.length ? list.map((name, index) => ({ name, number: index + 1 }))
      : items.filter(hasOwner).map(item => ({ name: String(item.owner).trim(), number: 0 }));
    const seen = new Set(), result = [];
    for (const entry of source) {
      const key = same(entry.name);
      if (seen.has(key)) continue;
      // 공백만 다른 이름은 먼저 나온 표기 하나만 남긴다.
      seen.add(key);
      result.push(entry);
      if (result.length === LIMITS.people) break;
    }
    return result;
  }
  function resolveMe(list, savedName, settingsName) {
    // 이 회의에 저장된 선택이 후보에 있으면 그 사람, 없으면 설정의 내 이름과 같은 후보, 둘 다 없으면 모른다(null).
    for (const [value, source] of [[savedName, 'saved'], [settingsName, 'settings']]) {
      const found = list.find(entry => sameName(entry.name, value));
      if (found) return { ...found, source };
    }
    return null;
  }
  function mine(items, meName) {
    // 담당자가 나와 같은 일에 원래 위치를 붙여 안 끝낸 일을 앞에, 끝낸 일을 뒤에 둔다.
    const own = items.map((item, index) => ({ ...item, index })).filter(item => sameName(item.owner, meName));
    return [...own.filter(item => !item.done), ...own.filter(item => item.done)];
  }
  function mineOpen(participants, items, savedName, settingsName) {
    // 지난 회의 목록에 붙일 수다. 내가 누구인지 모르면 null, 알면 내가 안 끝낸 일의 수다.
    const me = resolveMe(candidates(participants, items), savedName, settingsName);
    return me ? mine(items, me.name).filter(item => !item.done).length : null;
  }
  function rest(items, meName) {
    // 내 일이 아닌 일의 수다. 끝낸 일도 센다.
    return { unassigned: items.filter(item => !hasOwner(item)).length, others: items.filter(item => hasOwner(item) && !sameName(item.owner, meName)).length };
  }
  function shareGroups(participants, items) {
    // 사람별로 보낼 남은 일이다. 담당자가 있고 안 끝낸 일만 묶고, 공백만 다른 담당자 이름은 한 사람으로 본다.
    const list = people(participants), groups = new Map();
    for (const item of items) {
      if (item.done || !hasOwner(item)) continue;
      const key = same(item.owner);
      if (!groups.has(key)) {
        const at = list.findIndex(name => same(name) === key);
        groups.set(key, { name: at < 0 ? String(item.owner).trim() : list[at], number: at + 1, tasks: [] });
        // 부르는 이름은 참석자 명단의 표기를 쓰고, 명단에 없으면 먼저 나온 표기를 쓴다.
      }
      groups.get(key).tasks.push({ task: item.task, due: field(item.due) });
    }
    const found = [...groups.values()];
    return [...found.filter(group => group.number).sort((a, b) => a.number - b.number), ...found.filter(group => !group.number)];
    // 참석자 번호순이 먼저이고, 명단에 없는 담당자는 처음 나온 순서로 뒤에 붙는다.
  }
  function shareText(title, date, group) {
    // 한 사람에게 보낼 글이다. 기한이 없는 일은 문장만 쓴다.
    const head = `[${String(title ?? '').trim() || '회의'}] ${date ?? ''}`.trim();
    return [head, `${group.name} 님이 맡은 일 ${group.tasks.length}건`, ...group.tasks.map(item => `- ${item.task}${item.due ? ` · 기한 ${item.due}` : ''}`)].join('\n');
  }
  return { LIMITS, people, ownerNumber, initial, effective, sorted, apply, carryOver, validate, sameName, candidates, resolveMe, mine, mineOpen, rest, shareGroups, shareText };
});
