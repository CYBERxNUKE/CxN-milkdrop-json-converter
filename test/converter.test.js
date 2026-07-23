'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  convertPresetText,
  convertPath,
  findPresetFiles,
} = require('..');

const fixturePath = path.join(__dirname, 'fixtures', 'simple.milk');

test('convertPresetText creates a Butterchurn preset object', async () => {
  const source = await fs.readFile(fixturePath, 'utf8');
  const preset = await convertPresetText(source);

  assert.equal(preset.baseVals.rating, 3);
  assert.equal(preset.baseVals.wave_r, 0.5);
  assert.equal(preset.shapes.length, 4);
  assert.equal(preset.waves.length, 4);
  assert.match(preset.frame_eqs_str, /Math\.sin/);
});

test('convertPresetText rejects empty input', async () => {
  await assert.rejects(convertPresetText(' \r\n '), /empty/);
});

test('convertPath preserves folders and skips existing output', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milkdrop-converter-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const input = path.join(directory, 'input');
  const nested = path.join(input, 'nested');
  const output = path.join(directory, 'output');
  await fs.mkdir(nested, { recursive: true });
  await fs.copyFile(fixturePath, path.join(input, 'one.milk'));
  await fs.copyFile(fixturePath, path.join(nested, 'two.milk'));

  const files = await findPresetFiles(input);
  assert.equal(files.length, 2);

  const firstRun = await convertPath(input, output, { concurrency: 2 });
  assert.deepEqual(firstRun.map((result) => result.status), ['converted', 'converted']);
  await fs.access(path.join(output, 'one.json'));
  await fs.access(path.join(output, 'nested', 'two.json'));

  const secondRun = await convertPath(input, output);
  assert.deepEqual(secondRun.map((result) => result.status), ['skipped', 'skipped']);
});
