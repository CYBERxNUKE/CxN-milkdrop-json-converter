'use strict';

const { convertHLSLShader } = require('hlslparser-js');
const milkdropParser = require('milkdrop-eel-parser');
const {
  createBasePresetFuns,
  prepareShader,
  processUnOptimizedShader,
  splitPreset,
} = require('milkdrop-preset-utils');

function findClosingParenthesis(source, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitArguments(source) {
  const argumentsList = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') depth -= 1;
    if (source[index] === ',' && depth === 0) {
      argumentsList.push(source.slice(start, index));
      start = index + 1;
    }
  }
  argumentsList.push(source.slice(start));
  return argumentsList;
}

function splitStatements(source) {
  const statements = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') depth -= 1;
    if (source[index] === ';' && depth === 0) {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const statement = source.slice(start).trim();
  if (statement) statements.push(statement);
  return statements;
}

function combineExpressions(expressions) {
  if (expressions.length === 1) return expressions[0];
  return `exec2(${expressions[0]},${combineExpressions(expressions.slice(1))})`;
}

function rewriteFunctionCalls(source, functionName, rewrite) {
  const lowerSource = source.toLowerCase();
  const lowerName = functionName.toLowerCase();
  let result = '';
  let cursor = 0;

  while (cursor < source.length) {
    const functionIndex = lowerSource.indexOf(lowerName, cursor);
    if (functionIndex < 0) return result + source.slice(cursor);

    const before = functionIndex > 0 ? source[functionIndex - 1] : '';
    let openingIndex = functionIndex + functionName.length;
    while (/\s/.test(source[openingIndex] || '')) openingIndex += 1;
    const afterName = source[openingIndex];
    const hasIdentifierBoundary = !/[A-Za-z0-9_]/.test(before);
    if (!hasIdentifierBoundary || afterName !== '(') {
      result += source.slice(cursor, functionIndex + functionName.length);
      cursor = functionIndex + functionName.length;
      continue;
    }

    const closingIndex = findClosingParenthesis(source, openingIndex);
    if (closingIndex < 0) return result + source.slice(cursor);

    const argumentsList = splitArguments(
      source.slice(openingIndex + 1, closingIndex)
    ).map((argument) => rewriteFunctionCalls(argument, functionName, rewrite));
    result += source.slice(cursor, functionIndex);
    result += rewrite(argumentsList);
    cursor = closingIndex + 1;
  }
  return result;
}

function rewriteChainedAssignments(source) {
  const buffer = '(?:g?megabuf\\s*\\([^;]*?\\))';
  const symbol = '(?:[A-Za-z][A-Za-z0-9_]*)';
  const leftHandSide = `(?:${buffer}|${symbol})`;
  const chainedAssignment = new RegExp(
    `(${leftHandSide})\\s*=\\s*(${leftHandSide})\\s*([+\\-*/%]=|=(?!=))\\s*([^;]+)`,
    'gi'
  );

  let rewritten = source;
  for (let pass = 0; pass < 10; pass += 1) {
    const next = rewritten.replace(
      chainedAssignment,
      (match, outer, inner, operator, value) =>
        `${outer}=if(1,${inner}${operator}${value},0)`
    );
    if (next === rewritten) break;
    rewritten = next;
  }

  // A few older presets use an assignment for one term of a larger
  // expression. Preserve its return-value behavior through an if expression.
  rewritten = rewritten.replace(
    /\breg88\s*=\s*int\s*\(\s*frm\s*\)/gi,
    'if(1,reg88=int(frm),0)'
  );
  return rewritten.replace(
    /\(\s*([A-Za-z][A-Za-z0-9_]*)\s*([+\-*/%]=|=(?!=))\s*([^;(),]+)\s*\)/g,
    '(if(1,$1$2$3,0))'
  );
}

function rewriteLegacyFunctions(source) {
  let rewritten = source
    .replace(/([=(:,;+\-*/%<>!&|])\s*\+\s*(?=[A-Za-z_(])/g, '$1 ')
    .replace(/\bif\s*;\s*\(/gi, 'if(')
    .replace(/\b1\s*\/\s*t6\s*;\s*\)/gi, '1/t6)')
    .replace(/\)\s*;\s*\+\s*(?=below\s*\()/gi, ')+')
    .replace(/;\s*(?=\)\s*[*/+\-])/g, '')
    .replace(
      /\*\s*qradmv_l\s*\*=\s*\.5\s*\+\s*gang/gi,
      '*qradmv_l;qradmv_l*=.5+gang'
    );
  rewritten = rewriteChainedAssignments(rewritten);
  rewritten = rewriteFunctionCalls(rewritten, 'assign', (argumentsList) => {
    if (argumentsList.length !== 2) {
      return `assign(${argumentsList.join(',')})`;
    }
    // Assignments are statements in milkdrop-eel-parser. An always-true if
    // lets assign() remain usable as an expression and returns the new value.
    return `if(1,${argumentsList[0]}=${argumentsList[1]},0)`;
  });
  rewritten = rewriteFunctionCalls(rewritten, 'ceil', (argumentsList) => {
    if (argumentsList.length !== 1) return `ceil(${argumentsList.join(',')})`;
    return `(-1*floor(-1*(${argumentsList[0]})))`;
  });
  rewritten = rewriteFunctionCalls(rewritten, 'invsqrt', (argumentsList) => {
    if (argumentsList.length !== 1) {
      return `invsqrt(${argumentsList.join(',')})`;
    }
    return `(1/sqrt(${argumentsList[0]}))`;
  });
  rewritten = rewriteFunctionCalls(rewritten, 'while', (argumentsList) => {
    if (argumentsList.length !== 1) {
      return `while(${argumentsList.join(',')})`;
    }
    const statements = splitStatements(argumentsList[0]);
    if (statements.length < 2) return `while(${argumentsList[0]})`;
    return `while(${combineExpressions(statements)})`;
  });
  return rewriteFunctionCalls(rewritten, 'memset', (argumentsList) => {
    if (argumentsList.length !== 3) {
      return `memset(${argumentsList.join(',')})`;
    }
    const [destination, value, count] = argumentsList;
    return `user_memset_index=0;loop(${count},megabuf(${destination}+user_memset_index)=${value};user_memset_index+=1)`;
  });
}

function rewritePresetEquations(presetParts) {
  for (const field of ['presetInit', 'perFrame', 'perVertex']) {
    presetParts[field] = rewriteLegacyFunctions(presetParts[field] || '');
  }
  for (const item of [...presetParts.shapes, ...presetParts.waves]) {
    for (const field of ['init_eqs_str', 'frame_eqs_str', 'point_eqs_str']) {
      if (typeof item[field] === 'string') {
        item[field] = rewriteLegacyFunctions(item[field]);
      }
    }
  }
}

async function convertShader(shader) {
  if (shader.length === 0) return '';

  const shaderBodyName = 'main_shader_sentinel';
  let fullShader = prepareShader(shader);
  fullShader = fullShader.replace(
    'float4 shader_body (',
    `float4 ${shaderBodyName} (`
  );
  let convertedShader = await convertHLSLShader(
    fullShader,
    shaderBodyName,
    'fs'
  );
  convertedShader = processUnOptimizedShader(convertedShader);
  return convertedShader;
}

async function convertPreset(text) {
  const mainPresetText = text.split('[preset00]')[1];
  const presetParts = splitPreset(mainPresetText);
  rewritePresetEquations(presetParts);

  const parsedPreset = milkdropParser.convert_preset_wave_and_shape(
    presetParts.presetVersion,
    presetParts.presetInit,
    presetParts.perFrame,
    presetParts.perVertex,
    presetParts.shapes,
    presetParts.waves
  );
  const [presetMap, warpShader, compShader] = await Promise.all([
    createBasePresetFuns(parsedPreset, presetParts.shapes, presetParts.waves),
    convertShader(presetParts.warp),
    convertShader(presetParts.comp),
  ]);
  return {
    ...presetMap,
    baseVals: presetParts.baseVals,
    warp: warpShader,
    comp: compShader,
  };
}

module.exports = {
  convertPreset,
};
