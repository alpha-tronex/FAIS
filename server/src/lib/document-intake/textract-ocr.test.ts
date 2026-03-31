import assert from 'node:assert/strict';
import test from 'node:test';
import { joinTextractLineBlocks } from './textract-ocr.js';

test('joinTextractLineBlocks joins LINE blocks in order', () => {
  const text = joinTextractLineBlocks([
    { BlockType: 'PAGE' },
    { BlockType: 'LINE', Text: 'Hello' },
    { BlockType: 'WORD', Text: 'x' },
    { BlockType: 'LINE', Text: 'World' }
  ]);
  assert.equal(text, 'Hello\nWorld');
});

test('joinTextractLineBlocks returns empty for missing blocks', () => {
  assert.equal(joinTextractLineBlocks(undefined), '');
  assert.equal(joinTextractLineBlocks([]), '');
});
