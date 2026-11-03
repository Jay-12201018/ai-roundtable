import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Migration 1 exactly as first released; a database from then on must keep upgrading. */
export const originalSchema = readFileSync(fileURLToPath(new URL('./original-schema.sql', import.meta.url)), 'utf8');
