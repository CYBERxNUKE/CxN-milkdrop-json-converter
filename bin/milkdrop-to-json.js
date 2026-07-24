#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { convertPath } = require('..');

function printHelp() {
  console.log(`Usage:
  milkdrop-to-json <input> [output] [options]

Input may be a .milk file or a directory.

Options:
  --overwrite       Replace existing JSON files
  --compact         Write compact JSON
  --no-recursive    Do not scan nested directories
  --jobs <number>   Concurrent directory conversions (default: 4)
  --report <file>   Write the conversion report to this file
  --no-report       Do not write conversion-report.json
  --json-summary    Print the final summary as JSON
  -h, --help        Show this help
`);
}

function parseArguments(argv) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
    } else if (argument === '--overwrite') {
      options.overwrite = true;
    } else if (argument === '--compact') {
      options.pretty = false;
    } else if (argument === '--no-recursive') {
      options.recursive = false;
    } else if (argument === '--json-summary') {
      options.jsonSummary = true;
    } else if (argument === '--no-report') {
      options.report = false;
    } else if (argument === '--report') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) {
        throw new Error('--report requires a file path');
      }
      options.report = value;
    } else if (argument === '--jobs') {
      const value = Number.parseInt(argv[++index], 10);
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        throw new Error('--jobs must be an integer from 1 to 64');
      }
      options.concurrency = value;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }

  if (positionals.length > 2) {
    throw new Error('Expected input and optional output paths');
  }

  return {
    input: positionals[0],
    output: positionals[1],
    options,
  };
}

function summarize(results) {
  const summary = {
    total: results.length,
    converted: 0,
    skipped: 0,
    failed: 0,
  };
  for (const result of results) {
    if (Object.hasOwn(summary, result.status)) summary[result.status] += 1;
  }
  return summary;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function createProgressRenderer(enabled) {
  const startedAt = Date.now();
  const counts = { converted: 0, skipped: 0, failed: 0 };
  let lastRenderedAt = 0;
  let lastLineLength = 0;

  return ({ completed, total, result }) => {
    if (!enabled) return;
    if (result && Object.hasOwn(counts, result.status)) {
      counts[result.status] += 1;
    }

    const now = Date.now();
    const isComplete = completed === total;
    const interval = process.stdout.isTTY ? 100 : 2000;
    if (!isComplete && completed > 0 && now - lastRenderedAt < interval) return;
    lastRenderedAt = now;

    const width = 30;
    const ratio = total === 0 ? 1 : completed / total;
    const filled = Math.min(width, Math.floor(ratio * width));
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
    const percent = (ratio * 100).toFixed(1).padStart(5);
    const line = `[${bar}] ${percent}% ${completed}/${total}`
      + ` converted=${counts.converted}`
      + ` skipped=${counts.skipped}`
      + ` failed=${counts.failed}`
      + ` elapsed=${formatDuration(now - startedAt)}`;

    if (process.stdout.isTTY) {
      const padding = ' '.repeat(Math.max(0, lastLineLength - line.length));
      process.stdout.write(`\r${line}${padding}`);
      lastLineLength = line.length;
      if (isComplete) process.stdout.write('\n');
    } else {
      console.log(line);
    }
  };
}

async function getInputType(input) {
  const stat = await fs.stat(path.resolve(input));
  return stat.isDirectory() ? 'directory' : 'file';
}

function getResolvedOutput(input, output, inputType) {
  if (output) return path.resolve(output);
  const inputPath = path.resolve(input);
  if (inputType === 'directory') return `${inputPath}-json`;
  const extension = path.extname(inputPath);
  return inputPath.slice(0, -extension.length) + '.json';
}

function getDefaultReportPath(resolvedOutput, inputType) {
  const reportDirectory = inputType === 'directory'
    ? resolvedOutput
    : path.dirname(resolvedOutput);
  return path.join(reportDirectory, 'conversion-report.json');
}

async function writeReport(
  reportPath,
  input,
  resolvedOutput,
  durationMs,
  summary,
  results
) {
  const failed = results
    .filter((result) => result.status === 'failed')
    .map(({ input: inputFile, output: outputFile, reason }) => ({
      input: inputFile,
      output: outputFile,
      reason,
    }));
  const report = {
    generatedAt: new Date().toISOString(),
    input: path.resolve(input),
    output: resolvedOutput,
    durationMs,
    summary,
    failed,
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.options.help || !parsed.input) {
    printHelp();
    process.exitCode = parsed.input || parsed.options.help ? 0 : 1;
    return;
  }

  const inputType = await getInputType(parsed.input);
  const resolvedOutput = getResolvedOutput(parsed.input, parsed.output, inputType);
  const renderProgress = createProgressRenderer(
    inputType === 'directory' && !parsed.options.jsonSummary
  );
  parsed.options.onProgress = renderProgress;
  const startedAt = Date.now();
  const results = await convertPath(parsed.input, parsed.output, parsed.options);
  const durationMs = Date.now() - startedAt;
  const summary = summarize(results);
  let reportPath = null;

  if (parsed.options.report !== false) {
    reportPath = typeof parsed.options.report === 'string'
      ? path.resolve(parsed.options.report)
      : getDefaultReportPath(resolvedOutput, inputType);
    await writeReport(
      reportPath,
      parsed.input,
      resolvedOutput,
      durationMs,
      summary,
      results
    );
  }

  if (parsed.options.jsonSummary) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else if (inputType === 'file') {
    for (const result of results) {
      const detail = result.reason ? ` (${result.reason})` : '';
      console.log(`${result.status.toUpperCase()}: ${result.input} -> ${result.output}${detail}`);
    }
  } else if (summary.failed > 0) {
    console.log('Failed presets:');
    for (const result of results.filter((item) => item.status === 'failed')) {
      console.log(`FAILED: ${result.input} (${result.reason})`);
    }
  }

  if (!parsed.options.jsonSummary) {
    console.log(`Total:     ${summary.total}`);
    console.log(`Converted: ${summary.converted}`);
    console.log(`Skipped:   ${summary.skipped}`);
    console.log(`Failed:    ${summary.failed}`);
    console.log(`Duration:  ${formatDuration(durationMs)}`);
    if (reportPath) console.log(`Report:    ${reportPath}`);
  }

  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
