'use strict';

const { convertPresetText } = require('./src/converter');
const { convertFile, convertPath, findPresetFiles } = require('./src/files');

module.exports = {
  convertPresetText,
  convertFile,
  convertPath,
  findPresetFiles,
};
