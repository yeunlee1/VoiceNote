// 아홉 프로젝트 설정을 교환 파일로 만들고, 불러올 파일을 쓰기 전에 모두 검증한다.
const FORMAT = 'voicenote-project-settings';
const VERSION = 1;
const MAX_BYTES = 128 * 1024;
const OUTPUT_FORMATS = ['meeting', 'summary', 'tasks'];
const ROOT_KEYS = ['format', 'version', 'projects'];
const ENTRY_KEYS = ['slot', 'name', 'title', 'context', 'outputFormat'];
const LIMITS = { name: 100, title: 160, context: 4000 };

const invalid = message => Object.assign(new Error(message), { status: 400 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknownKey = (value, allowed) => Object.keys(value).find(key => !allowed.includes(key));

function outputFormat(value) {
  return OUTPUT_FORMATS.includes(value) ? value : null;
}

// 저장된 프리셋 하나를 교환 항목으로 바꾼다. 이름이 없는 슬롯은 빈 회의록 형식으로 내보낸다.
function entry(project) {
  if (!project.name) return { slot: project.slot, name: '', title: '', context: '', outputFormat: 'meeting' };
  return { slot: project.slot, name: project.name, title: project.title, context: project.context, outputFormat: outputFormat(project.outputFormat) || 'meeting' };
}

function buildSettingsFile(projects) {
  const file = { format: FORMAT, version: VERSION, projects: [...projects].sort((a, b) => a.slot - b.slot).map(entry) };
  if (file.projects.length !== 9 || file.projects.some((item, index) => item.slot !== index + 1)) throw invalid('프로젝트 9개를 모두 읽지 못해 내보내지 않았습니다.');
  if (Buffer.byteLength(JSON.stringify(file, null, 2), 'utf8') > MAX_BYTES) throw invalid('설정 파일이 128KiB를 넘어 내보내지 않았습니다. 프로젝트 설명을 줄여 주세요.');
  return file;
}

function parseSettingsFile(source) {
  if (typeof source !== 'string') throw invalid('설정 파일 내용을 읽지 못했습니다.');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw invalid('설정 파일이 128KiB를 넘었습니다.');
  let root;
  try { root = JSON.parse(source.replace(/^﻿/, '')); }
  catch { throw invalid('JSON 형식이 아닌 파일입니다. VoiceNote에서 내보낸 설정 파일인지 확인하세요.'); }
  if (!plain(root) || root.format !== FORMAT) throw invalid('VoiceNote 프로젝트 설정 파일이 아닙니다.');
  const extraRoot = unknownKey(root, ROOT_KEYS);
  if (extraRoot !== undefined) throw invalid(`설정 파일에 알 수 없는 항목(${extraRoot.slice(0, 40)})이 있습니다.`);
  if (!Number.isInteger(root.version) || root.version < 1) throw invalid('설정 파일 버전을 확인할 수 없습니다.');
  if (root.version > VERSION) throw invalid(`이 VoiceNote보다 새 버전(${root.version})의 설정 파일입니다. 프로그램을 업데이트한 뒤 불러오세요.`);
  if (!Array.isArray(root.projects) || root.projects.length !== 9) throw invalid('프로젝트 1번부터 9번까지 9개가 정확히 있어야 합니다.');
  const seen = new Set();
  const projects = root.projects.map(item => {
    if (!plain(item)) throw invalid('프로젝트 항목 형식을 확인하세요.');
    const extra = unknownKey(item, ENTRY_KEYS);
    if (extra !== undefined) throw invalid(`프로젝트 항목에 알 수 없는 항목(${extra.slice(0, 40)})이 있습니다.`);
    if (!Number.isInteger(item.slot) || item.slot < 1 || item.slot > 9) throw invalid('프로젝트 번호는 1부터 9까지의 정수여야 합니다.');
    if (seen.has(item.slot)) throw invalid(`${item.slot}번 프로젝트가 중복됐습니다.`);
    seen.add(item.slot);
    for (const key of ['name', 'title', 'context']) {
      const label = { name: '이름', title: '회의명', context: '설명' }[key];
      if (typeof item[key] !== 'string') throw invalid(`${item.slot}번 프로젝트의 ${label} 항목이 없거나 글이 아닙니다.`);
      if (item[key].length > LIMITS[key]) throw invalid(`${item.slot}번 프로젝트의 ${label}은 ${LIMITS[key].toLocaleString('ko-KR')}자 이하여야 합니다.`);
    }
    const format = outputFormat(item.outputFormat);
    if (!format) throw invalid(`${item.slot}번 프로젝트의 출력 형식을 확인하세요.`);
    if (!item.name.trim()) {
      if (item.title.trim() || item.context.trim() || format !== 'meeting') throw invalid(`${item.slot}번 프로젝트는 이름 없이 내용만 있습니다. 이름을 넣거나 내용을 비우세요.`);
      return { slot: item.slot, name: '', title: '', context: '', outputFormat: 'meeting' };
    }
    return { slot: item.slot, name: item.name.trim(), title: item.title.trim(), context: item.context, outputFormat: format };
  });
  return projects.sort((a, b) => a.slot - b.slot);
}

// 앱은 프로젝트를 3개까지만 쓴다. 이전 버전과 파일을 주고받도록 교환 파일은 9칸을 유지하고 4~9번은 비워 둔다.
const MAX_PROJECTS = 3;
function padProjects(projects) {
  return Array.from({ length: 9 }, (_, i) => projects.find(project => project.slot === i + 1) || { slot: i + 1, name: '', title: '', context: '', outputFormat: 'meeting' });
}
function limitProjects(projects) {
  const extra = projects.filter(project => project.slot > MAX_PROJECTS && project.name);
  if (extra.length) throw invalid(`프로젝트는 ${MAX_PROJECTS}개까지만 쓸 수 있습니다. 이 파일에는 ${extra.map(project => `${project.slot}번`).join(', ')} 프로젝트가 있어 불러오지 않았습니다.`);
  return projects.filter(project => project.slot <= MAX_PROJECTS);
}

module.exports = { FORMAT, VERSION, MAX_BYTES, OUTPUT_FORMATS, MAX_PROJECTS, outputFormat, buildSettingsFile, parseSettingsFile, padProjects, limitProjects };
