'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.join(__dirname, '..', 'bin', 'milkdrop-to-json.js');
const fixturePath = path.join(__dirname, 'fixtures', 'simple.milk');

function runCli(argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...argumentsList], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI shows progress and writes a failure report', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'milkdrop-cli-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));

  const input = path.join(directory, 'input');
  const output = path.join(directory, 'output');
  await fs.mkdir(input);
  await fs.copyFile(fixturePath, path.join(input, 'good.milk'));
  await fs.writeFile(path.join(input, 'bad.milk'), ' \n', 'utf8');

  const result = await runCli([input, output, '--jobs', '2']);
  const report = JSON.parse(
    await fs.readFile(path.join(output, 'conversion-report.json'), 'utf8')
  );

  assert.equal(result.code, 2);
  assert.match(result.stdout, /\[#{30}\] 100\.0% 2\/2/);
  assert.match(result.stdout, /Converted: 1/);
  assert.match(result.stdout, /Failed:\s+1/);
  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.converted, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.output, output);
  assert.equal(typeof report.durationMs, 'number');
  assert.equal(report.failed.length, 1);
  assert.match(report.failed[0].input, /bad\.milk$/);
  assert.match(report.failed[0].reason, /empty/);
});
