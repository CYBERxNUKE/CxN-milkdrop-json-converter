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

function findOpeningParenthesis(source, closingIndex) {
  let depth = 0;
  for (let index = closingIndex; index >= 0; index -= 1) {
    if (source[index] === ')') depth += 1;
    if (source[index] === '(') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

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

function powerLeftBoundary(source, caretIndex) {
  let end = caretIndex - 1;
  while (end >= 0 && /\s/.test(source[end])) end -= 1;
  if (end < 0) return -1;

  if (source[end] === ')') {
    let start = findOpeningParenthesis(source, end);
    if (start < 0) return -1;
    let nameEnd = start - 1;
    while (nameEnd >= 0 && /\s/.test(source[nameEnd])) nameEnd -= 1;
    if (nameEnd >= 0 && /[A-Za-z0-9_]/.test(source[nameEnd])) {
      while (nameEnd >= 0 && /[A-Za-z0-9_]/.test(source[nameEnd])) nameEnd -= 1;
      start = nameEnd + 1;
    }
    return start;
  }

  let start = end;
  while (start >= 0 && /[A-Za-z0-9_.]/.test(source[start])) start -= 1;
  return start + 1;
}

function powerRightBoundary(source, caretIndex) {
  let start = caretIndex + 1;
  while (start < source.length && /\s/.test(source[start])) start += 1;
  if (/[+-]/.test(source[start] || '')) start += 1;
  while (start < source.length && /\s/.test(source[start])) start += 1;
  if (start >= source.length) return -1;

  if (source[start] === '(') {
    const end = findClosingParenthesis(source, start);
    return end < 0 ? -1 : end + 1;
  }

  let end = start;
  while (end < source.length && /[A-Za-z0-9_.]/.test(source[end])) end += 1;
  let openingIndex = end;
  while (openingIndex < source.length && /\s/.test(source[openingIndex])) {
    openingIndex += 1;
  }
  if (source[openingIndex] === '(') {
    const closingIndex = findClosingParenthesis(source, openingIndex);
    return closingIndex < 0 ? -1 : closingIndex + 1;
  }
  return end;
}

function rewritePowerOperators(equation) {
  let rewritten = equation;
  for (let pass = 0; pass < 50; pass += 1) {
    const caretIndex = rewritten.lastIndexOf('^');
    if (caretIndex < 0) break;
    const leftStart = powerLeftBoundary(rewritten, caretIndex);
    const rightEnd = powerRightBoundary(rewritten, caretIndex);
    if (leftStart < 0 || rightEnd < 0 || leftStart >= caretIndex || rightEnd <= caretIndex) {
      break;
    }
    const left = rewritten.slice(leftStart, caretIndex).trim();
    const right = rewritten.slice(caretIndex + 1, rightEnd).trim();
    rewritten = `${rewritten.slice(0, leftStart)}pow(${left},${right})${rewritten.slice(rightEnd)}`;
  }
  return rewritten;
}

function rewriteBufferIndexing(equation) {
  let rewritten = equation;
  for (let pass = 0; pass < 100; pass += 1) {
    const closingBracket = rewritten.indexOf(']');
    if (closingBracket < 0) break;
    const openingBracket = rewritten.lastIndexOf('[', closingBracket);
    if (openingBracket < 0) break;

    let baseEnd = openingBracket - 1;
    while (baseEnd >= 0 && /\s/.test(rewritten[baseEnd])) baseEnd -= 1;
    let baseStart = baseEnd;
    if (rewritten[baseEnd] === ')') {
      baseStart = findOpeningParenthesis(rewritten, baseEnd);
    } else {
      while (baseStart >= 0 && /[A-Za-z0-9_.]/.test(rewritten[baseStart])) {
        baseStart -= 1;
      }
      baseStart += 1;
    }
    if (baseStart < 0 || baseStart > baseEnd) break;

    const base = rewritten.slice(baseStart, baseEnd + 1);
    const index = rewritten.slice(openingBracket + 1, closingBracket);
    rewritten = `${rewritten.slice(0, baseStart)}megabuf((${base})+(${index}))${rewritten.slice(closingBracket + 1)}`;
  }
  return rewritten;
}

function joinEquationContinuationLines(sourceLines) {
  const lines = [...sourceLines];
  const equationKey = /^(?:per_(?:frame|pixel)|(?:wave|shape)(?:code)?_\d+_)/i;
  for (let index = 0; index < lines.length; index += 1) {
    if (!equationKey.test(lines[index])) continue;
    const separator = lines[index].indexOf('=');
    if (separator < 0 || lines[index][separator + 1] === '`') continue;

    let equation = lines[index].slice(separator + 1);
    while (!hasBalancedParentheses(equation)) {
      let continuationIndex = index + 1;
      while (continuationIndex < lines.length && !lines[continuationIndex].trim()) {
        continuationIndex += 1;
      }
      if (
        continuationIndex >= lines.length
        || equationKey.test(lines[continuationIndex])
        || /^\s*\[/.test(lines[continuationIndex])
      ) {
        break;
      }
      equation += lines[continuationIndex].trim();
      lines[index] += lines[continuationIndex].trim();
      lines[continuationIndex] = '';
    }
  }
  return lines;
}

function normalizeEquationSyntax(source) {
  const commentState = { inBlockComment: false };
  const lines = joinEquationContinuationLines(source.split('\n'));
  return lines
    .map((line, index) => {
      if (!/^(?:per_(?:frame|pixel)|(?:wave|shape)(?:code)?_\d+_)/i.test(line)) {
        return line;
      }

      const separator = line.indexOf('=');
      if (separator < 0 || line[separator + 1] === '`') return line;

      const key = line.slice(0, separator + 1);
      const rawEquation = line.slice(separator + 1);
      let equation = /^\s*(?:\/\/|\\+)/.test(rawEquation)
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
        .replace(/;\s*(?=\))/g, '')
        .replace(/\)\s*-\s*rad\s*\)\s*-\s*2\s*&/gi, ')-rad-2&')
        .replace(/-\s*\.\s*\*\s*3\b/g, '-.3')
        .replace(
          /(\bmid_changed\s*=\s*bnot\([^;\n]*abs\s*\(\s*bass_effect\s*\)\s*\)\s*);/gi,
          '$1);'
        )
        .replace(
          /^(\s*ib_a\s*=.*,\s*0\s*\))\s*\)\s*;?\s*$/i,
          '$1;'
        )
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
        .replace(/\bgmem\s*\[([^\]]+)\]/gi, 'gmegabuf($1)')
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
        )
        .replace(/\bv1\s*\/\s*ang\b/gi, 'v1ang')
        .replace(
          /(\.88\s*\/\s*cy)\s*=\s*(\.5\s*\+\s*sin)/gi,
          '$1;cy=$2'
        )
        .replace(/\btime(?=\d)/gi, 'time*')
        .replace(
          /\b1\s*\/\s*square\s*=\s*([^;]+);/gi,
          'square=1/($1);'
        )
        .replace(
          /(^|[;,(])\s*\d+(?:\.\d+)?\s*=\s*(?=[A-Za-z][A-Za-z0-9_]*\s*=)/g,
          '$1'
        )
        .replace(
          /\bcye\s*=\s*\(cy\s*\+\s*\.1\)\s*=\s*2\s*&/gi,
          'cye=(cy+.1)-2&'
        )
        .replace(
          /if\s*\(\s*above\s*\(\s*x\s*\*\s*\.3\s*\)\s*\)\s*,/gi,
          'if(above(x*.3),'
        )
        .replace(
          /\bbass_att\s*\*\s*10\s*=\s*(?=above\s*\()/gi,
          'user_bass_att10='
        )
        .replace(/\bmx\s*\(/gi, 'mx*(')
        .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*=\s*;/g, '')
        .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*=\s*$/g, '');
      equation = rewriteBufferIndexing(equation);
      equation = rewritePowerOperators(equation);
      equation = rewriteTernaryAssignments(equation);
      if (/^;*$/.test(equation.trim())) equation = '';
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
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(
      /[^\x00-\x7F]+/g,
      (value) => `user_unicode_${Array.from(value, (character) =>
        character.codePointAt(0).toString(16)).join('_')}`
    ));
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
