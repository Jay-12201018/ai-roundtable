import type { RoundtableApi } from '../preload';

declare global {
  interface Window {
    roundtable: RoundtableApi;
  }
}

export {};
