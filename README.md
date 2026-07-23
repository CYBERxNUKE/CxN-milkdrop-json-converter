# milkdrop-json-converter

Convert MilkDrop preset files into Butterchurn-compatible JSON.

This project is built around Jordan Berg's original
[`milkdrop-preset-converter`](https://github.com/jberg/milkdrop-preset-converter).
See [Third-party notices](THIRD_PARTY_NOTICES.md) for its related upstream
projects and licensing information.

The supported preset extension is `.milk`.

## Requirements

- Node.js 18 or newer
- npm

## Install

From this directory:

```text
npm ci
```

This installs `node_modules` locally from `package-lock.json`. Dependencies are
not stored in this repository.

## Command line

Convert one preset next to the source file:

```text
npm run convert -- "presets/Aurora.milk"
```

Choose the output file:

```text
npm run convert -- "presets/Aurora.milk" "output/Aurora.json"
```

Convert a directory recursively while preserving its subfolders:

```text
npm run convert -- "presets" "converted" --jobs 4
```

Existing files are skipped by default. Pass `--overwrite` to replace them.
Run `npm run convert -- --help` for every option. You can also run `npm link`
once to install the shorter `milkdrop-to-json` command globally.

Directory conversions display an ASCII progress bar with converted, skipped,
and failed counts. At the end, the command prints a summary and writes
`conversion-report.json` in the output directory. The report contains the
summary and a list of every failed preset with its error. Use `--no-report` to
disable the report or `--report "path/to/report.json"` to choose its location.

## Library API

```js
const {
  convertPresetText,
  convertFile,
  convertPath,
} = require('milkdrop-json-converter');

const presetObject = await convertPresetText(milkSource);
await convertFile('input.milk', 'output.json');
await convertPath('preset-directory', 'json-directory', {
  concurrency: 4,
  overwrite: false,
});
```

`convertPath()` returns one result per input with a `converted`, `skipped`, or
`failed` status. A directory conversion does not stop when one preset is bad.

## Output

The JSON includes Butterchurn base values, custom shapes and waves, compiled
equation strings, and converted GLSL shaders.

## Notes

- MilkDrop 2 shaders can require more conversion work than MilkDrop 1 presets.
- Presets may reference external textures that must be supplied separately.
- Treat presets from unknown sources as untrusted input.
