import { safeStorage } from 'electron';
import type { KeyStorageBackend } from './KeyService';
import { createMemoryKeyBackend } from './KeyService';

export function createElectronKeyBackend(): KeyStorageBackend {
  const selectedBackend = typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : 'unknown';
  const secure = safeStorage.isEncryptionAvailable() && selectedBackend !== 'basic_text';
  if (!secure) return createMemoryKeyBackend();

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
