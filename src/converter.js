'use strict';

let converter;

function getConverter() {
  if (converter) return converter;

  const bundle = require('milkdrop-preset-converter');
  converter = bundle.default || bundle;
  if (!converter || typeof converter.convertPreset !== 'function') {
    throw new Error('milkdrop-preset-converter did not expose convertPreset()');
  }
  return converter;
}

function normalizeSource(source) {
  if (typeof source !== 'string') {
    throw new TypeError('Preset source must be a string');
  }

  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    throw new Error('Preset source is empty');
  }
  return normalized;
}

async function convertPresetText(source) {
  const normalized = normalizeSource(source);
  const result = await getConverter().convertPreset(normalized);

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Converter returned an invalid preset object');
  }
  if (!result.baseVals || !Array.isArray(result.shapes) || !Array.isArray(result.waves)) {
    throw new Error('Converted preset is missing required Butterchurn fields');
  }

  return result;
}

module.exports = {
  convertPresetText,
};
