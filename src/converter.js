'use strict';

let converter;

function getConverter() {
  if (converter) return converter;

  const bundle = require('./preset-converter');
  converter = bundle.default || bundle;
  if (!converter || typeof converter.convertPreset !== 'function') {
    throw new Error('milkdrop-preset-converter did not expose convertPreset()');
  }
  return converter;
}

function hasBalancedParentheses(value) {
  let depth = 0;
  for (const character of value.replace(/\/\/.*$/, '')) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function addMissingTerminator(equation, continuesOnNextLine) {
  const commentIndex = equation.indexOf('//');
  const code = (commentIndex < 0 ? equation : equation.slice(0, commentIndex)).trimEnd();
  const comment = commentIndex < 0 ? '' : equation.slice(commentIndex);

  if (
    !code
    || continuesOnNextLine
    || /[;,(+\-*/%<>=!&|]$/.test(code)
    || !hasBalancedParentheses(code)
    || !/^[A-Za-z][A-Za-z0-9_]*\s*=/.test(code)
  ) {
    return equation;
  }
  return `${code};${comment}`;
}

function stripEquationBlockComments(value, state) {
  let result = '';
  let index = 0;
  while (index < value.length) {
    if (state.inBlockComment) {
      const end = value.indexOf('*/', index);
      if (end < 0) return result;
      state.inBlockComment = false;
      index = end + 2;
    } else {
      const start = value.indexOf('/*', index);
      const lineComment = value.indexOf('//', index);
      if (lineComment >= 0 && (start < 0 || lineComment < start)) {
        return result + value.slice(index, lineComment);
      }
      if (start < 0) return result + value.slice(index);
      result += value.slice(index, start);
      state.inBlockComment = true;
      index = start + 2;
    }
  }
  return result;
}

function rewriteTernaryExpression(expression) {
  let depth = 0;
  let questionIndex = -1;
  let nestedQuestions = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth !== 0) continue;
    if (character === '?' && questionIndex < 0) {
      questionIndex = index;
    } else if (character === '?' && questionIndex >= 0) {
      nestedQuestions += 1;
    } else if (character === ':' && questionIndex >= 0) {
      if (nestedQuestions > 0) {
        nestedQuestions -= 1;
      } else {
        const condition = expression.slice(0, questionIndex);
        const whenTrue = expression.slice(questionIndex + 1, index);
        const whenFalse = expression.slice(index + 1);
        return `if(${condition},${rewriteTernaryExpression(whenTrue)},${rewriteTernaryExpression(whenFalse)})`;
      }
    }
  }
  return expression;
}

function rewriteTernaryAssignments(equation) {
  return equation.replace(
    /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*([^;]+)/g,
    (match, name, expression) => {
      if (!expression.includes('?')) return match;
      return `${name}=${rewriteTernaryExpression(expression)}`;
    }
  );
}

function normalizeEquationSyntax(source) {
  const commentState = { inBlockComment: false };
  const lines = source.split('\n');
  return lines
    .map((line, index) => {
      if (!/^(?:per_(?:frame|pixel)|(?:wave|shape)(?:code)?_\d+_)/i.test(line)) {
        return line;
      }

      const separator = line.indexOf('=');
      if (separator < 0 || line[separator + 1] === '`') return line;

      const key = line.slice(0, separator + 1);
      const rawEquation = line.slice(separator + 1);
      let equation = /^\s*\/\//.test(rawEquation)
        ? ''
        : stripEquationBlockComments(rawEquation, commentState);
      if (
        /^(?:per_(?:frame|pixel)|(?:wave|shape)(?:code)?_\d+_)[^=]*=\s*\/\//i.test(equation)
      ) {
        equation = '';
      }

      equation = equation
        .replace(/([=(:,;+\-*/%<>!&|])\s*\+\s*(?=[A-Za-z_(])/g, '$1 ')
        .replace(/(^|[=(:,;+\-*/%<>!&|])\s*-\s*(?=\()/g, '$1 -1*')
        .replace(/!\s*(?=\()/g, 'bnot')
        .replace(/!(?!=)\s*([A-Za-z][A-Za-z0-9_]*)/g, 'bnot($1)')
        .replace(/(\d(?:\.\d*)?)l\b/gi, '$1')
        .replace(/(?<![A-Za-z0-9_])_+aboeq\b/gi, 'above')
        .replace(/(?<![A-Za-z0-9_])_+([A-Za-z][A-Za-z0-9_]*)/g, 'user_$1')
        .replace(/\+\.\+(?=\d)/g, '+')
        .replace(/,\s*0\s*=\s*(?=\d)/g, ', ')
        .replace(/,\s*\.\s*-\s*(\d+)/g, ', -.$1')
        .replace(/^\s*\\+/, '')
        .replace(
          /\btex_ang\s*=\s*ang\s*\/\s*t8\s*=\s*ang\s*\*/gi,
          'tex_ang=ang/t8;ang=ang*'
        )
        .replace(
          /\bzoom\s*=\s*0\.8\s*=\s*0\.23\s*\*\s*cos\s*\(/gi,
          'zoom=0.8+0.23*cos('
        )
        .replace(/\btex\s*\+\s*zoom\s*=/gi, 'tex_zoom=')
        .replace(/\bif\s*;\s*\(/gi, 'if(')
        .replace(/;\s*(?=\)\s*[*/+\-])/g, '')
        .replace(
          /\bspec\s*=\s*\(\s*sbass\s*\+\s*stre\s*=\s*smid\s*\)/gi,
          'spec=(sbass+stre+smid)'
        )
        .replace(
          /\(\s*bass\s*\+\s*treb\s*=\s*mid\s*\)/gi,
          '(bass+treb+mid)'
        )
        .replace(/\btreb\s*\.\s*6\b/gi, 'treb*.6')
        .replace(/\$pi\b/gi, '3.141592653589793')
        .replace(
          /\b([A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d*)?|\.\d+)\s*\^\s*(\([^()]*\)|[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d*)?|\.\d+)/g,
          'pow($1,$2)'
        )
        .replace(/\bgmem\s*\[([^\]]+)\]/gi, 'gmegabuf($1)')
        .replace(
          /\b(?!gmem\b)([A-Za-z][A-Za-z0-9_]*)\s*\[([^\]]+)\]/gi,
          'megabuf($1+($2))'
        )
        .replace(
          /\b(\d+(?:\.\d*)?|\.\d+)[eE]([+\-]?\d+)\b/g,
          '($1*pow(10,$2))'
        )
        .replace(
          /\(\s*8\s*\*\s*i\s*\)\s*\[([^\]]+)\]/gi,
          'megabuf(8*i+($1))'
        )
        .replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*\[\s*\]/g, 'megabuf($1)')
        .replace(
          /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/g,
          '$3=$4;$2=$4;$1=$4'
        )
        .replace(
          /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*([A-Za-z][A-Za-z0-9_]*|-?(?:\d+(?:\.\d*)?|\.\d+))/g,
          '$2=$3;$1=$3'
        )
        .replace(
          /if\s*\(\s*c\s*>=\s*30\s*,\s*\(d\s*=\s*mid\)\s*&\s*\(c\s*=\s*0\)\s*,\s*\(d\s*=\s*d\)\s*&\s*\(c\s*=\s*c\)\s*\)\s*;/gi,
          'd=if(c>=30,mid,d);c=if(c>=30,0,c);'
        )
        .replace(
          /if\s*\(\s*dbl_beat\s*,\s*\(j0\s*=\s*rand\(2\)\s*-\s*1\)\s*\*\s*jscale\s*;\s*j1\s*=\s*0\s*;\s*j2\s*=\s*\(\(rand\(6\)\s*-\s*2\)\)\s*\*\s*jscale\s*,\s*0\s*\)/gi,
          'if(dbl_beat,exec3(j0=rand(2)-1,j1=0,j2=(rand(6)-2)*jscale),0)'
        )
        .replace(
          /bnot\(schange\)\s*\*\s*blank\s*;;\s*\*\s*\(fastpace\)\s*;;/gi,
          'bnot(schange)*blank*(fastpace);'
        );
      equation = rewriteTernaryAssignments(equation);
      const nextLine = lines[index + 1] || '';
      const nextSeparator = nextLine.indexOf('=');
      const continuesOnNextLine = nextSeparator >= 0
        && /^(?:per_(?:frame|pixel)|(?:wave|shape)(?:code)?_\d+_)/i.test(nextLine)
        && !/^\s*\/\//.test(nextLine.slice(nextSeparator + 1))
        && /^\s*[+\-*/%&|]/.test(nextLine.slice(nextSeparator + 1));
      return key + addMissingTerminator(equation, continuesOnNextLine);
    })
    .join('\n');
}

function normalizeSource(source) {
  if (typeof source !== 'string') {
    throw new TypeError('Preset source must be a string');
  }

  const normalized = normalizeEquationSyntax(source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n'));
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
