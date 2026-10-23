// 숨김 PowerShell을 통해 Windows 기본 마이크 음량을 설정하고 실제 적용값을 반환한다.
const { execFile } = require('node:child_process');
const path = require('node:path');

function setMicrophoneVolume() {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '마이크음량.ps1')],
      { windowsHide: true, timeout: 20000, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout) => {
        let result;
        try { result = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')); } catch {}
        if (result?.error) return reject(new Error(result.error));
        if (error || !result || result.volume !== 100 || result.muted !== false || typeof result.name !== 'string')
          return reject(new Error('마이크 설정을 확인하지 못했습니다. Windows 설정 → 시스템 → 소리에서 입력 장치와 음량을 확인하세요.'));
        resolve(result);
      });
  });
}

module.exports = { setMicrophoneVolume };
