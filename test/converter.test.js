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

test('convertPresetText normalizes legacy equation syntax', async () => {
  const source = [
    await fs.readFile(fixturePath, 'utf8'),
    'per_frame_2=wave_b=if(above((time*20)%2,0),1,0);',
    'per_frame_3=decay = + if (above(progress, 0.99), 0.9, 1);',
    'per_frame_4=q1=sin(+atan2(x,y));',
    'per_frame_5=q2=if (!(x==0), abs(.1/x), 0);',
    'per_frame_6=additive=above(sin(time*200),0.99l);',
    'per_frame_7=q3=if(below(x,0), -(x*x*x), x*x*x);',
    'per_frame_8=gamma=1 + bass*bass_att',
    'per_frame_9=chng=sin(time*.5);',
    'per_frame_10=r=g=b=0;',
    'per_frame_11=user_value=__value;',
    'per_frame_12=a=rg=rg_mid2;',
    'per_frame_13=/*',
    'per_frame_14=ignored=invalid;',
    'per_frame_15=*/q4=1;',
  ].join('\n');

  const preset = await convertPresetText(source);

  assert.match(preset.frame_eqs_str, /decay/);
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

test('convertPath reports directory progress', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milkdrop-converter-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const input = path.join(directory, 'input');
  const output = path.join(directory, 'output');
  const progress = [];
  await fs.mkdir(input);
  await fs.copyFile(fixturePath, path.join(input, 'one.milk'));
  await fs.copyFile(fixturePath, path.join(input, 'two.milk'));

  await convertPath(input, output, {
    onProgress(update) {
      progress.push({
        completed: update.completed,
        total: update.total,
        status: update.result && update.result.status,
      });
    },
  });

  assert.deepEqual(progress, [
    { completed: 0, total: 2, status: null },
    { completed: 1, total: 2, status: 'converted' },
    { completed: 2, total: 2, status: 'converted' },
  ]);
});
