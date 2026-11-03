'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { convertPresetText } = require('./converter');

const PRESET_EXTENSIONS = new Set(['.milk']);

function isPresetFile(filePath) {
  return PRESET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function findPresetFiles(inputDirectory, recursive = true) {
  const root = path.resolve(inputDirectory);
  const files = [];

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && recursive) {
        await visit(entryPath);
      } else if (entry.isFile() && isPresetFile(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files;
}

function defaultOutputForFile(inputFile) {
  const extension = path.extname(inputFile);
  return inputFile.slice(0, -extension.length) + '.json';
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeJson(outputFile, value, options) {
  const overwrite = options.overwrite === true;
  if (!overwrite && await pathExists(outputFile)) {
    return { status: 'skipped', reason: 'output exists' };
  }

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const spacing = options.pretty === false ? 0 : 2;
  const json = JSON.stringify(value, null, spacing) + '\n';
  try {
    await fs.writeFile(outputFile, json, {
      encoding: 'utf8',
      flag: overwrite ? 'w' : 'wx',
    });
  } catch (error) {
    if (!overwrite && error.code === 'EEXIST') {
      return { status: 'skipped', reason: 'output exists' };
    }
    throw error;
  }
  return { status: 'converted', bytes: Buffer.byteLength(json) };
}

async function convertFile(inputFile, outputFile, options = {}) {
  const inputPath = path.resolve(inputFile);
  if (!isPresetFile(inputPath)) {
    throw new Error(`Unsupported preset extension: ${path.extname(inputPath) || '(none)'}`);
  }

  const outputPath = path.resolve(outputFile || defaultOutputForFile(inputPath));
  if (!options.overwrite && await pathExists(outputPath)) {
    return {
      input: inputPath,
      output: outputPath,
      status: 'skipped',
      reason: 'output exists',
    };
  }
  const source = await fs.readFile(inputPath, 'utf8');
  const preset = await convertPresetText(source);
  const writeResult = await writeJson(outputPath, preset, options);

  return {
    input: inputPath,
    output: outputPath,
    ...writeResult,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    run
  );
  await Promise.all(workers);
  return results;
}

function notifyProgress(options, progress) {
  if (typeof options.onProgress === 'function') {
    options.onProgress(progress);
  }
}

async function convertPath(input, output, options = {}) {
  const inputPath = path.resolve(input);
  const inputStat = await fs.stat(inputPath);

  if (inputStat.isFile()) {
    return [await convertFile(inputPath, output, options)];
  }
  if (!inputStat.isDirectory()) {
    throw new Error('Input must be a preset file or directory');
  }

  const outputRoot = path.resolve(output || `${inputPath}-json`);
  const files = await findPresetFiles(inputPath, options.recursive !== false);
  const concurrency = Number.isInteger(options.concurrency) ? options.concurrency : 4;
  let completed = 0;

  notifyProgress(options, {
    completed,
    total: files.length,
    result: null,
  });

  return mapWithConcurrency(files, concurrency, async (file) => {
    const relativePath = path.relative(inputPath, file);
    const relativeOutput = relativePath.slice(0, -path.extname(relativePath).length) + '.json';
    const outputFile = path.join(outputRoot, relativeOutput);

    let result;
    try {
      result = await convertFile(file, outputFile, options);
    } catch (error) {
      result = {
        input: file,
        output: outputFile,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    completed += 1;
    notifyProgress(options, {
      completed,
      total: files.length,
      result,
    });
    return result;
  });
}

module.exports = {
  convertFile,
  convertPath,
  findPresetFiles,
};
