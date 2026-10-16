// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(), getSelectedStorageBackend: vi.fn(),
  encryptString: vi.fn(), decryptString: vi.fn(),
}));
vi.mock('electron', () => ({ safeStorage }));
import { createElectronKeyBackend } from '../../../src/main/security/electronSafeStorage';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const selectBackend = safeStorage.getSelectedStorageBackend;
function platform(value: NodeJS.Platform) { Object.defineProperty(process, 'platform', { value, configurable: true }); }
beforeEach(() => { vi.resetAllMocks(); safeStorage.isEncryptionAvailable.mockReturnValue(true); });
afterEach(() => { Object.defineProperty(process, 'platform', platformDescriptor); safeStorage.getSelectedStorageBackend = selectBackend; });

describe('Electron Key storage reliability', () => {
  it.each(['basic_text', 'unknown', 'unrecognized'])('keeps the Key in memory on Linux %s', backend => {
    platform('linux'); safeStorage.getSelectedStorageBackend.mockReturnValue(backend);
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'memory', persistent: false, backend: 'memory' });
    expect(safeStorage.encryptString).not.toHaveBeenCalled(); expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])('uses Linux %s only when encryption is available', async backend => {
    platform('linux'); safeStorage.getSelectedStorageBackend.mockReturnValue(backend);
    safeStorage.encryptString.mockReturnValue(Buffer.from('fixture-cipher')); safeStorage.decryptString.mockReturnValue('fixture-secret');
    const storage = createElectronKeyBackend();
    expect(storage).toMatchObject({ mode: 'secure', persistent: true, backend });
    const encrypted = await storage.encrypt('fixture-secret');
    expect(encrypted).toBe(Buffer.from('fixture-cipher').toString('base64'));
    expect(await storage.decrypt(encrypted)).toBe('fixture-secret');
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'memory', persistent: false });
  });

  it.each(['darwin', 'win32'] as const)('preserves the native %s backend without requiring the Linux selection API', platformName => {
    platform(platformName); Reflect.deleteProperty(safeStorage, 'getSelectedStorageBackend');
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'secure', persistent: true, backend: 'unknown' });
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'memory', persistent: false });
  });

  it('uses memory when Linux cannot identify its storage backend', () => {
    platform('linux'); Reflect.deleteProperty(safeStorage, 'getSelectedStorageBackend');
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'memory', persistent: false });
  });

  it.each(['availability', 'selection'] as const)('falls back to memory when the %s check throws', check => {
    platform('linux'); safeStorage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    const query = check === 'availability' ? safeStorage.isEncryptionAvailable : safeStorage.getSelectedStorageBackend;
    query.mockImplementation(() => { throw new Error('private backend error'); });
    expect(createElectronKeyBackend()).toMatchObject({ mode: 'memory', persistent: false });
  });
});
