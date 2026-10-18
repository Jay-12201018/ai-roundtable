import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { Database } from '../../../src/main/database/Database';

describe('controlled trial production boundaries', () => {
  it('has a separate Main-only one-shot entry without approving ordinary model policies', () => {
    expect(ProviderRegistry.prototype).toHaveProperty('streamControlledTrial', expect.any(Function));
  });
  it('persists unresolved reservations in the existing authoritative Database', () => {
    expect(Database.prototype).toHaveProperty('reserveControlledTrial', expect.any(Function));
    expect(Database.prototype).toHaveProperty('finishControlledTrial', expect.any(Function));
    expect(Database.prototype).toHaveProperty('listControlledTrials', expect.any(Function));
  });
});
