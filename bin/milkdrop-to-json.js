#!/usr/bin/env node
'use strict';

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

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.options.help || !parsed.input) {
    printHelp();
    process.exitCode = parsed.input || parsed.options.help ? 0 : 1;
    return;
  }

  const results = await convertPath(parsed.input, parsed.output, parsed.options);
  const summary = summarize(results);

  if (parsed.options.jsonSummary) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    for (const result of results) {
      const detail = result.reason ? ` (${result.reason})` : '';
      console.log(`${result.status.toUpperCase()}: ${result.input} -> ${result.output}${detail}`);
    }
    console.log(
      `Done: ${summary.converted} converted, ${summary.skipped} skipped, ${summary.failed} failed`
    );
  }

  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
