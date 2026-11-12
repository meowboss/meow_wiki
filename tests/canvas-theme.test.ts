import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasThemeSchema,
  compositionSchema,
  compositionDocumentSchema,
  createDefaultComposition,
} from '../packages/canvas-contract/index.ts';
import {
  canvasContrastRatio,
  canvasThemeStyle,
  CANVAS_THEME_PRESETS,
  DEFAULT_CANVAS_THEME,
} from '../web/features/canvas/theme.ts';

test('theme is optional, partial and never adds defaults to old documents', () => {
  for (const surface of ['home', 'wiki', 'collaboration'] as const) {
    const original = createDefaultComposition(surface);
    assert.equal(Object.hasOwn(original, 'theme'), false);
    assert.deepEqual(compositionSchema.parse(original), original);
    const { revision: _revision, ...document } = original;
    assert.deepEqual(compositionDocumentSchema.parse(document), document);
    assert.deepEqual(compositionSchema.parse({ ...original, theme: {} }).theme, {});
    assert.deepEqual(compositionSchema.parse({ ...original, theme: { font: 'mono' } }).theme, {
      font: 'mono',
    });
    assert.deepEqual(canvasThemeStyle(undefined), {});
  }
});

test('theme strict fields reject CSS, URLs, alpha colors and out-of-range values', () => {
  const invalid = [
    { unknown: true },
    { background: '#ffffff' },
    { css: 'color:red' },
    { foreground: 'red' },
    { foreground: '#fff' },
    { foreground: '#ffffff80' },
    { foreground: '#ffff' },
    { accent: 'url(https://example.com)' },
    { accent: '#123456; color:red' },
    { font: 'serif; background:url(x)' },
    { font: 'url(x)' },
    { fontSize: 13 },
    { fontSize: 23 },
    { fontSize: 16.5 },
    { fontSize: '16' },
    { lineHeight: 1.29 },
    { lineHeight: 2.21 },
    { lineHeight: Infinity },
    { lineHeight: NaN },
    null,
    [],
  ];
  for (const theme of invalid) {
    assert.equal(canvasThemeSchema.safeParse(theme).success, false, JSON.stringify(theme));
    assert.equal(
      compositionSchema.safeParse({ ...createDefaultComposition('wiki'), theme }).success,
      false,
    );
  }
  for (const font of ['sans', 'serif', 'mono']) {
    assert.equal(
      canvasThemeSchema.safeParse({
        foreground: '#AbC123',
        accent: '#000000',
        font,
        fontSize: 14,
        lineHeight: 1.3,
      }).success,
      true,
    );
    assert.equal(
      canvasThemeSchema.safeParse({ font, fontSize: 22, lineHeight: 2.2 }).success,
      true,
    );
  }
});

test('background keeps legacy hex forms while theme remains opaque', () => {
  for (const background of ['#abc', '#abcd', '#aabbcc', '#aabbccdd']) {
    assert.equal(
      compositionSchema.safeParse({ ...createDefaultComposition('home'), background }).success,
      true,
    );
  }
});

test('theme render defaults and presets do not mutate stored values', () => {
  const theme = { accent: '#abcdef' };
  const copy = structuredClone(theme);
  const style = canvasThemeStyle(theme) as Record<string, unknown>;
  assert.deepEqual(theme, copy);
  assert.equal(style['--canvas-accent'], '#abcdef');
  assert.equal(style['--canvas-foreground'], DEFAULT_CANVAS_THEME.foreground);
  assert.equal(style['--canvas-font-size'], '16px');
  for (const preset of Object.values(CANVAS_THEME_PRESETS)) {
    assert.equal(
      compositionSchema.safeParse({ ...createDefaultComposition('wiki'), ...preset }).success,
      true,
    );
    assert.ok(canvasContrastRatio(preset.theme.foreground, preset.background)! >= 4.5);
  }
});

test('WCAG contrast uses linear sRGB, handles legacy hex, ignores alpha, rejects CSS', () => {
  assert.equal(canvasContrastRatio('#000000', '#ffffff'), 21);
  assert.equal(canvasContrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(canvasContrastRatio('#fff', '#000'), 21);
  assert.equal(canvasContrastRatio('#fff0', '#000f'), 21);
  assert.equal(canvasContrastRatio('#ffffff00', '#000000ff'), 21);
  assert.ok(Math.abs(canvasContrastRatio('#777777', '#ffffff')! - 4.478) < 0.001);
  assert.ok(canvasContrastRatio('#777777', '#ffffff')! < 4.5);
  assert.equal(canvasContrastRatio('url(x)', '#ffffff'), undefined);
  assert.equal(canvasContrastRatio('#fff', 'white'), undefined);
});
