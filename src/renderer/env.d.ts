import type { RoundtableApiContract } from '../shared/contracts/app';

declare global {
  interface Window { roundtable: RoundtableApiContract; }
}
export {};
