// 설정 파일 2판(요약 모델·기본 출력 형식·내 형식·저장 위치)을 만들고, 불러올 파일을 쓰기 전에 모두 검증한다.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const formats = require('./출력형식.js');

const FORMAT = 'voicenote-settings';
const VERSION = 2;
const MAX_BYTES = 128 * 1024;
const LEGACY_FORMAT = 'voicenote-project-settings';
const LEGACY_MESSAGE = '이전 버전의 프로젝트 설정 파일입니다. 프로젝트 기능이 없어져 불러올 수 없습니다.';
const ROOT_KEYS = ['format', 'version', 'summaryModel', 'defaultOutputFormat', 'customFormat', 'storage'];
const STORAGE_KINDS = ['audio', 'transcript', 'summary'];
const MAX_MODEL = 100;
const MAX_FOLDER = 1000;
const MISSING_FOLDER = '이 PC에 없는 폴더라 적용하지 않습니다.';

const invalid = message => Object.assign(new Error(message), { status: 400 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unknownKey = (value, allowed) => Object.keys(value).find(key => !allowed.includes(key));

// 저장 위치는 세 종류가 모두 있어야 하고, 빈 값은 그 종류를 쓰지 않는다는 뜻이다.
function storageValue(value) {
  if (!plain(value)) throw invalid('저장 위치 항목을 확인하세요.');
  const extra = unknownKey(value, STORAGE_KINDS);
  if (extra !== undefined) throw invalid(`저장 위치에 알 수 없는 항목(${extra.slice(0, 40)})이 있습니다.`);
  return Object.fromEntries(STORAGE_KINDS.map(kind => {
    if (typeof value[kind] !== 'string') throw invalid('저장 위치 항목을 확인하세요.');
    if (value[kind].length > MAX_FOLDER) throw invalid(`저장 위치 경로는 ${MAX_FOLDER.toLocaleString('ko-KR')}자 이하여야 합니다.`);
    return [kind, value[kind]];
  }));
}

function settingsValue(root) {
  if (typeof root.summaryModel !== 'string' || !root.summaryModel || root.summaryModel.length > MAX_MODEL) throw invalid('요약 모델 항목을 확인하세요.');
  const defaultOutputFormat = formats.format(root.defaultOutputFormat);
  if (!defaultOutputFormat) throw invalid('기본 출력 형식을 확인하세요.');
  if (root.customFormat === undefined) throw invalid('내 형식 항목이 없습니다.');
  const customFormat = root.customFormat === null ? null : formats.validateCustom(root.customFormat);
  return { summaryModel: root.summaryModel, defaultOutputFormat, customFormat, ...(root.storage !== undefined ? { storage: storageValue(root.storage) } : {}) };
}

function buildSettingsFile(settings) {
  const value = settingsValue(settings);
  const file = { format: FORMAT, version: VERSION, ...value };
  if (Buffer.byteLength(JSON.stringify(file, null, 2), 'utf8') > MAX_BYTES) throw invalid('설정 파일이 128KiB를 넘어 내보내지 않았습니다. 내 형식의 추가 지시를 줄여 주세요.');
  return file;
}

// 바이트로 받으면 UTF-8을 엄격하게 확인한다. 글로 받으면 화면이 이미 같은 확인을 마친 것이다.
function parseSettingsFile(source) {
  if (source instanceof Uint8Array) {
    if (source.byteLength > MAX_BYTES) throw invalid('설정 파일이 128KiB를 넘었습니다.');
    try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source); }
    catch { throw invalid('UTF-8로 저장된 설정 파일이 아닙니다. VoiceNote에서 내보낸 파일인지 확인하세요.'); }
  }
  if (typeof source !== 'string') throw invalid('설정 파일 내용을 읽지 못했습니다.');
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw invalid('설정 파일이 128KiB를 넘었습니다.');
  let root;
  try { root = JSON.parse(source.replace(/^﻿/, '')); }
  catch { throw invalid('JSON 형식이 아닌 파일입니다. VoiceNote에서 내보낸 설정 파일인지 확인하세요.'); }
  if (plain(root) && root.format === LEGACY_FORMAT) throw invalid(LEGACY_MESSAGE);
  if (!plain(root) || root.format !== FORMAT) throw invalid('VoiceNote 설정 파일이 아닙니다.');
  const extra = unknownKey(root, ROOT_KEYS);
  if (extra !== undefined) throw invalid(`설정 파일에 알 수 없는 항목(${extra.slice(0, 40)})이 있습니다.`);
  if (!Number.isInteger(root.version) || root.version < 1) throw invalid('설정 파일 버전을 확인할 수 없습니다.');
  if (root.version > VERSION) throw invalid(`이 VoiceNote보다 새 버전(${root.version})의 설정 파일입니다. 프로그램을 업데이트한 뒤 불러오세요.`);
  if (root.version !== VERSION) throw invalid('설정 파일 버전을 확인할 수 없습니다.');
  return settingsValue(root);
}

// 다른 PC에서 만든 설정 파일의 네트워크 경로(\\호스트\공유, //호스트/공유)는 열어 보지 않는다. 열기만 해도 그 호스트로 접속과 인증을 시도한다.
const NETWORK_FOLDER = '네트워크 폴더 경로는 불러오지 않습니다. 설정에서 직접 고르세요.';
function isNetworkPath(folder) {
  return typeof folder === 'string' && /^[\\/]{2}/.test(folder);
}

// 고른 폴더가 이 PC에 있고 실제로 파일을 쓰고 지울 수 있는지 시험 파일로 확인한다.
function checkFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return { ok: false, message: '폴더는 드라이브부터 적은 전체 경로로 골라 주세요.' };
  let info;
  try { info = fs.statSync(folder); } catch { return { ok: false, message: MISSING_FOLDER }; }
  if (!info.isDirectory()) return { ok: false, message: '폴더가 아닌 파일입니다. 폴더를 골라 주세요.' };
  const probe = path.join(folder, `.voicenote-쓰기확인-${randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
    return { ok: true, message: '' };
  } catch {
    try { fs.unlinkSync(probe); } catch {}
    return { ok: false, message: '이 폴더에 파일을 쓸 수 없습니다. 폴더의 쓰기 권한을 확인하세요.' };
  }
}

module.exports = { FORMAT, VERSION, MAX_BYTES, LEGACY_MESSAGE, STORAGE_KINDS, MAX_FOLDER, NETWORK_FOLDER, buildSettingsFile, parseSettingsFile, checkFolder, isNetworkPath };
