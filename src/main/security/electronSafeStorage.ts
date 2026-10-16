import { safeStorage } from 'electron';
import type { KeyStorageBackend } from './KeyService';
import { createMemoryKeyBackend } from './KeyService';

export function createElectronKeyBackend(): KeyStorageBackend {
  let selectedBackend: string;
  try {
    if (!safeStorage.isEncryptionAvailable()) return createMemoryKeyBackend();
    selectedBackend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'unknown';
    const secure = selectedBackend !== 'basic_text' && (process.platform === 'darwin' || process.platform === 'win32'
      || process.platform === 'linux' && ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(selectedBackend));
    if (!secure) return createMemoryKeyBackend();
  } catch { return createMemoryKeyBackend(); }

  return {
    mode: 'secure',
    backend: selectedBackend,
    persistent: true,
    async encrypt(value) {
      return safeStorage.encryptString(value).toString('base64');
    },
    async decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    },
  };
}
