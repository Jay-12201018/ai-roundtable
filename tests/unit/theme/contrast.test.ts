// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/renderer/theme/tokens.css'), 'utf8');

function braceBlock(css: string, from: number): string {
  const open = css.indexOf('{', from);
  if (open < 0) throw new Error('Missing block');
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error('Unclosed block');
}

function hexTokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(match => [match[1], match[2].toUpperCase()]));
}

const light = hexTokens(braceBlock(tokens, tokens.indexOf(':root {')));
const dark = hexTokens(braceBlock(tokens, tokens.indexOf(':root[data-theme="dark"]')));
const followed = hexTokens(braceBlock(tokens, tokens.indexOf('@media (prefers-color-scheme: dark)')));

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const textPairs: Array<[string, string]> = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'sidebar'],
  ['text-2', 'bg'], ['text-2', 'surface'], ['text-2', 'surface-2'], ['text-2', 'sidebar'],
  ['text-3', 'bg'], ['text-3', 'surface'], ['text-3', 'surface-2'], ['text-3', 'sidebar'],
  ['accent', 'surface'], ['accent', 'bg'], ['accent', 'sidebar'], ['accent', 'accent-soft'],
  ['on-accent', 'accent'], ['on-accent', 'accent-hover'],
  ['danger', 'surface'], ['danger', 'bg'], ['danger', 'danger-soft'],
  ['warn', 'surface'], ['warn', 'bg'], ['warn', 'warn-soft'],
  ['info', 'surface'], ['info', 'info-soft'],
  ['success', 'surface'], ['success', 'accent-soft'],
];

describe('shipped theme tokens', () => {
  it('keeps the followed-system dark palette the same as the chosen dark palette', () => {
    expect(followed).toEqual(dark);
  });

  it.each(['light', 'dark'] as const)('%s text is at least 4.5:1 on the surfaces it is written on', theme => {
    const palette = theme === 'light' ? light : dark;
    for (const [foreground, background] of textPairs) {
      const ratio = contrast(palette[foreground], palette[background]);
      expect(ratio, `${theme} --${foreground} on --${background} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['light', 'dark'] as const)('%s control borders are at least 3:1 against the surfaces they sit on', theme => {
    const palette = theme === 'light' ? light : dark;
    for (const background of ['surface', 'bg', 'surface-2', 'sidebar', 'surface-3']) {
      const ratio = contrast(palette['line-strong'], palette[background]);
      expect(ratio, `${theme} --line-strong on --${background} is ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
  });
});
