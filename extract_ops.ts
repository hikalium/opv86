const fs = require('fs');
const assert = require('assert').strict;

// pdftohtml version 0.86.1
// pdftohtml 325383-sdm-vol-2abcd.pdf
const filename = '325383-sdm-vol-2abcds.html'

const opEnList = [
  'MR',
  'RM',
  'FD',
  'TD',
  'OI',
  'MI',
  'I',
  'ZO',
  'O',
  'D',
  'M',
  'II',
  'NA',
];

const validIn64Normalizer = {
  'Valid': true,
  ' Valid': 'Valid',
  'Valid ': 'Valid',
  'Valid N.E.': ['Valid', 'N.E.'],
  'Valid Valid': ['Valid', 'Valid'],
  'Invalid': true,
  'N. E.': 'N.E.',
  'Valid*': true,
  'N.S.': true,
  'N.E.': true,
  'V/N.E.': true,
};

function NoTags(s) {
  return s.replace(/<i>/g, '').replace(/<\/i>/g, '');
}

interface OpIndexEntry {
  page: number;
  ops: string[];
}

function ExpandOpTitle(title: string): string[] {
  const suffixList = ['8', '16', '32', '64', 'B', 'W', 'D', 'Q'];
  const commaSeparated = title.split(',');
  let ops = [];
  for (const s of commaSeparated) {
    const slashSeparated = s.split('/');
    if (slashSeparated.length < 2 || !suffixList.includes(slashSeparated[1])) {
      ops = ops.concat(slashSeparated);
      continue;
    }
    // Adjustment logic for MOVDQU,VMOVDQU8/16/32/64, etc...
    ops.push(slashSeparated[0]);
    let base = slashSeparated[0];
    for (const suffix of suffixList) {
      if (!base.endsWith(suffix)) continue;
      base = base.substr(0, base.length - suffix.length);
    }
    for (let i = 1; i < slashSeparated.length; i++) {
      ops.push(base + slashSeparated[i]);
    }
  }
  return ops.map((e) => e.trim());
}

function ExpandOpTitleTest() {
  assert.deepEqual(
      ExpandOpTitle('MOVDQU,VMOVDQU8/16/32/64'),
      ['MOVDQU', 'VMOVDQU8', 'VMOVDQU16', 'VMOVDQU32', 'VMOVDQU64']);
  assert.deepEqual(
      ExpandOpTitle('MOVDQA,VMOVDQA32/64'),
      ['MOVDQA', 'VMOVDQA32', 'VMOVDQA64']);
  assert.deepEqual(
      ExpandOpTitle('MOVS/MOVSB/MOVSW/MOVSD/MOVSQ'),
      ['MOVS', 'MOVSB', 'MOVSW', 'MOVSD', 'MOVSQ']);
  assert.deepEqual(
      ExpandOpTitle('VPBROADCASTB/W/D/Q'),
      ['VPBROADCASTB', 'VPBROADCASTW', 'VPBROADCASTD', 'VPBROADCASTQ']);
  assert.deepEqual(ExpandOpTitle(' XTEST '), ['XTEST']);
}

ExpandOpTitleTest();

function PrintOpStatistics() {
  const opIndexList = ExtractOpIndex();
  const op2page = GetOpToPageDict(opIndexList);
  const alphaCount = [];
  const lenCount = {};
  let longestMnemonic = '';
  for (const k in op2page) {
    if (longestMnemonic.length < k.length) {
      longestMnemonic = k;
    }
    //
    if (lenCount[k.length] === undefined) {
      lenCount[k.length] = 0;
    }
    lenCount[k.length]++;
    //
    const c = k.substr(0, 1);
    if (!alphaCount[c]) {
      alphaCount[c] = 0;
    }
    alphaCount[c]++;
  }
  console.log(`Longest Mnemonic: ${longestMnemonic}`);
  console.log(alphaCount);
  console.log(lenCount);
  const lenSorted = Object.keys(op2page).sort((a, b) => a.length - b.length);
  console.log(lenSorted.toString());
}

function ExtractOpIndex(): OpIndexEntry[] {
  const data = fs.readFileSync(filename, 'utf-8');
  const data_refs = data.split('<a href="');
  let lastPage = 0;
  const opPageList: OpIndexEntry[] = [];
  for (const refs of data_refs) {
    if (!refs.startsWith(filename + '#')) continue;
    const v = refs.split('">');
    const pnum = parseInt(v[0].split('#')[1]);
    if (pnum < lastPage) {
      // extract normal index only. do not include figure, appendix, etc...
      break;
    }
    lastPage = pnum;
    const w = v[1].split('\n');
    // if(w[0].indexOf(" Instructions (") == -1) continue;
    const title = w[0].split('&#160;').join(' ');
    if (title.indexOf('—') == -1) continue;
    const optitle = title.split('—')[0];
    opPageList.push({page: pnum, ops: ExpandOpTitle(optitle)});
  }
  return opPageList;
}

function GetOpToPageDict(index: OpIndexEntry[]): Record<string, number[]> {
  const dict: Record<string, number[]> = {};
  for (const e of index) {
    for (const op of e.ops) {
      if (!dict[op]) {
        dict[op] = [e.page];
        continue;
      }
      dict[op].push(e.page);
    }
  }
  return dict;
}

interface Op {
  opcode: string;
  instr: string;
  op_en: string;
  valid_in_64: string;
  compat_legacy: string;
  description: string;
  page: number;
}
function IsHeaderMatched(lines, pattern) {
  let li = 2;
  for (let pi = 0; pi < pattern.length; pi++, li++) {
    if (pattern[pi] !== lines[li]) return false;
  }
  return true;
}

function IsBeginningOfOp(nextToken: string): boolean {
  return nextToken !== undefined &&
      (nextToken.match(/^\s*[0-9A-F]{2}$/) ||
       nextToken.match(/^\s*[0-9A-F]{2}\s/) ||
       nextToken.match(/^(REX|NP).*/)) !== null;
}
function IsEndOfOpSection(nextToken: string): boolean {
  return nextToken === undefined ||
      (nextToken.match(/Description\s*$/) ||
       nextToken.match('Instruction Operand Encoding')) != null;
}

class Parser {
  constructor(lines) {
    this.lines = lines;
  }
  SetIndex(index: number) {
    this.index = index;
  }
  Peek() {
    return this.lines[this.index];
  }
  Pop() {
    return this.lines[this.index++];
  }
  Insert(s: string) {
    this.lines.splice(this.index, 0, s);
  }
  private lines: string[];
  private index: number;
}

const headerPattern00 = [
  'Opcode',
  'Instruction',
  'Op/  64-bit ',
  'Compat/',
  'Description',
  'En',
  'Mode',
  'Leg Mode',
];
const headerPattern01 = [
  'Opcode',
  'Instruction',
  'Op/  64-Bit ',
  'Compat/',
  'Description',
  'En',
  'Mode',
  'Leg Mode',
];
function ParseOpsInPage01(pnum: number, lines: string[]): Op[] {
  const parser = new Parser(lines);
  const ops = [];
  parser.SetIndex(10);
  while (parser.Peek() !== undefined) {
    if (!IsBeginningOfOp(parser.Peek()) || IsEndOfOpSection(parser.Peek())) {
      console.log(`Not matched on ${parser.Peek()}`)
      break;
    }
    const opcode = NoTags(parser.Pop());
    const instr = NoTags(parser.Pop());
    const last_token = parser.Peek();
    let opEn;
    for (;;) {
      if (parser.Peek() === undefined) {
        throw new Error(`No valid opEn found. last_token = ${last_token}`);
      }
      opEn = parser.Pop();
      if (opEnList.includes(opEn)) {
        break;
      }
    }
    let validIn64 = parser.Pop();
    let v = validIn64Normalizer[validIn64];
    if (v === undefined) {
      throw new Error(`Not a valid validIn64: '${validIn64}'`);
    }
    if (v !== true) {
      if (typeof v === 'string') {
        validIn64 = validIn64Normalizer[validIn64];
      } else if (v instanceof Array && v.length == 2) {
        validIn64 = v[0];
        parser.Insert(v[1]);
      } else {
        throw new Error(`Not a valid v: '${v}'`);
      }
    }
    const compatLegacy = parser.Pop();
    let description = '';
    for (;;) {
      description += NoTags(parser.Pop());
      if (IsBeginningOfOp(parser.Peek()) || IsEndOfOpSection(parser.Peek()))
        break;
    }
    ops.push({
      opcode: opcode,
      instr: instr,
      op_en: opEn,
      valid_in_64: validIn64,
      compat_legacy: compatLegacy,
      description: description,
      page: pnum,
    });
  }
  return ops;
}
function ParseOpsInPage01Test() {
  assert.deepEqual(
      ParseOpsInPage01(
          0,
          [
            '224></a>INSTRUCTION SET REFERENCE, A-L',
            'CALL—Call Procedure',
            'Opcode',
            'Instruction',
            'Op/  64-bit ',
            'Compat/',
            'Description',
            'En',
            'Mode',
            'Leg Mode',
            'E8 <i>cw</i>',
            'CALL <i>rel16</i>',
            'D',
            'N.S.',
            'Valid',
            'Call near, relative, displacement relative to next ',
            'instruction.',
            'E8 <i>cd</i>',
            'CALL <i>rel32</i>',
            'D',
            'Valid',
            'Valid',
            'Call near, relative, displacement relative to next ',
            'instruction. 32-bit displacement sign extended to ',
            '64-bits in 64-bit mode.',
            'FF /2',
            'CALL <i>r/m16</i>',
            'M',
            'N.E.',
            'Valid',
            'Call near, absolute indirect, address given in <i>r/m16. </i>',
          ]),
      [
        {
          opcode: 'E8 cw',
          instr: 'CALL rel16',
          op_en: 'D',
          valid_in_64: 'N.S.',
          compat_legacy: 'Valid',
          description:
              'Call near, relative, displacement relative to next instruction.',
          page: 0
        },
        {
          opcode: 'E8 cd',
          instr: 'CALL rel32',
          op_en: 'D',
          valid_in_64: 'Valid',
          compat_legacy: 'Valid',
          description:
              'Call near, relative, displacement relative to next instruction. 32-bit displacement sign extended to 64-bits in 64-bit mode.',
          page: 0
        },
        {
          opcode: 'FF /2',
          instr: 'CALL r/m16',
          op_en: 'M',
          valid_in_64: 'N.E.',
          compat_legacy: 'Valid',
          description: 'Call near, absolute indirect, address given in r/m16. ',
          page: 0
        },

      ]);
}
ParseOpsInPage01Test();

const headerPattern02 = [
  // ADCX
  'Opcode/',
  'Op/  64/32bit  CPUID ',
  'Description',
  'Instruction',
  'En',
  'Mode ',
  'Feature ',
  'Support',
  'Flag',
];
function ParseOpsInPage02(pnum: number, lines: string[]): Op[] {
  const parser = new Parser(lines);
  const ops = [];
  parser.SetIndex(11);
  const isExpected6432Support = {
    'V/V': true,
    'V/NE': true,
  };
  const CPUIDFeatureFlags = {
    'ADX': true,
  };
  while (parser.Peek() !== undefined) {
    if (!IsBeginningOfOp(parser.Peek()) || IsEndOfOpSection(parser.Peek())) {
      console.log(`Not matched on ${parser.Peek()}`)
      break;
    }
    const opcode = NoTags(parser.Pop());
    const last_token = parser.Peek();
    let opEn;
    for (;;) {
      if (parser.Peek() === undefined) {
        throw new Error(`No valid opEn found. last_token = ${last_token}`);
      }
      opEn = parser.Pop();
      if (opEnList.includes(opEn)) {
        break;
      }
    }
    let v = parser.Pop();
    if (!isExpected6432Support[v]) {
      throw new Error(`Not a valid v: '${v}'`);
    }
    let cpuidf = parser.Pop();
    if (!CPUIDFeatureFlags[cpuidf]) {
      throw new Error(`Not a valid cpuidf: '${cpuidf}'`);
    }
    let description = NoTags(parser.Pop());
    const instr = NoTags(parser.Pop());
    while (!IsBeginningOfOp(parser.Peek()) &&
           !IsEndOfOpSection(parser.Peek())) {
      description += NoTags(parser.Pop());
    }
    ops.push({
      opcode: opcode,
      instr: instr,
      op_en: opEn,
      description: description,
      page: pnum,
    });
  }
  return ops;
}
function ParseOpsInPage02Test() {
  assert.deepEqual(
      ParseOpsInPage02(
          0,
          [
            '131></a>INSTRUCTION SET REFERENCE, A-L',
            'ADCX — Unsigned Integer Addition of Two Operands with Carry Flag',
            'Opcode/',
            'Op/  64/32bit  CPUID ',
            'Description',
            'Instruction',
            'En',
            'Mode ',
            'Feature ',
            'Support',
            'Flag',
            '66 0F 38 F6 /r',
            'RM',
            'V/V',
            'ADX',
            'Unsigned addition of r32 with CF, r/m32 to r32, writes CF.',
            'ADCX r32, r/m32',
            '66 REX.w 0F 38 F6 /r',
            'RM',
            'V/NE',
            'ADX',
            'Unsigned addition of r64 with CF, r/m64 to r64, writes CF.',
            'ADCX r64, r/m64',
            'Instruction Operand Encoding',
          ]),
      [
        {
          opcode: '66 0F 38 F6 /r',
          instr: 'ADCX r32, r/m32',
          op_en: 'RM',
          description:
              'Unsigned addition of r32 with CF, r/m32 to r32, writes CF.',
          page: 0
        },
        {
          opcode: '66 REX.w 0F 38 F6 /r',
          instr: 'ADCX r64, r/m64',
          op_en: 'RM',
          description:
              'Unsigned addition of r64 with CF, r/m64 to r64, writes CF.',
          page: 0
        }
      ]);
}
ParseOpsInPage02Test();

const headerPattern03 = [
  // CLFLUSH
  'Opcode /',
  'Op/  64-bit ',
  'Compat/',
  'Description',
  'Instruction',
  'En',
  'Mode',
  'Leg Mode',
];

function ReadOpEn(parser: Parser) {
  const last_token = parser.Peek();
  let opEn;
  while (opEn = parser.Pop()) {
    if (opEnList.includes(opEn)) {
      return opEn;
    }
  }
  throw new Error(`No valid opEn found. last_token = ${last_token}`);
}
function ParseOpsInPage03(pnum: number, lines: string[]): Op[] {
  const parser = new Parser(lines);
  const ops = [];
  const isExpected6432Support = {
    'V/V': true,
    'V/NE': true,
  };
  const CPUIDFeatureFlags = {
    'ADX': true,
  };
  parser.SetIndex(10);
  while (parser.Peek() !== undefined) {
    if (!IsBeginningOfOp(parser.Peek()) || IsEndOfOpSection(parser.Peek())) {
      console.log(`Not matched on ${parser.Peek()}`)
      break;
    }
    const opcode = NoTags(parser.Pop());
    const opEn = ReadOpEn(parser);
    let validIn64 = parser.Pop();
    let validInCompatLegacy = parser.Pop();
    let description = NoTags(parser.Pop());
    const instr = NoTags(parser.Pop());
    while (!IsBeginningOfOp(parser.Peek()) &&
           !IsEndOfOpSection(parser.Peek())) {
      description += NoTags(parser.Pop());
    }
    ops.push({
      opcode: opcode,
      instr: instr,
      op_en: opEn,
      description: description,
      page: pnum,
    });
  }
  return ops;
}
function ParseOpsInPage03Test() {
  assert.deepEqual(
      ParseOpsInPage03(
          0,
          [
            '244></a>INSTRUCTION SET REFERENCE, A-L',
            'CLFLUSH—Flush Cache Line',
            'Opcode /',
            'Op/  64-bit ',
            'Compat/',
            'Description',
            'Instruction',
            'En',
            'Mode',
            'Leg Mode',
            'NP 0F AE /7',
            'M',
            'Valid',
            'Valid',
            'Flushes cache line containing <i>m8</i>.',
            'CLFLUSH <i>m8</i>',
            'Instruction Operand Encoding',
          ]),
      [
        {
          opcode: 'NP 0F AE /7',
          instr: 'CLFLUSH m8',
          op_en: 'M',
          description: 'Flushes cache line containing m8.',
          page: 0
        },
      ]);
}
ParseOpsInPage03Test();

function ParseOpsInPage(data_pages: string[], pnum: number): Op[] {
  const page = data_pages[pnum];
  if (page === undefined) {
    throw new Error(`page not found: ${pnum}`);
  }
  const lines =
      page.split('\n').join('').split('&#160;').join(' ').split('<br/>');
  if (!lines[0].startsWith(`${pnum}>`)) {
    throw new Error(
        `page not matched: expected ${pnum} but got line ${lines[0]}`);
  }
  let ops = [];
  const opRefTitle = lines[1];
  if (IsHeaderMatched(lines, headerPattern00) ||
      IsHeaderMatched(lines, headerPattern01)) {
    ops = ops.concat(ParseOpsInPage01(pnum, lines));
  } else if (IsHeaderMatched(lines, headerPattern02)) {
    ops = ops.concat(ParseOpsInPage02(pnum, lines));
  } else if (IsHeaderMatched(lines, headerPattern03)) {
    ops = ops.concat(ParseOpsInPage03(pnum, lines));
  } else {
    throw new Error('Not matched with pattern');
  }
  console.log(`==== ${pnum}: ${opRefTitle}: ${ops.length} ====`);
  return ops;
}

interface Result {
  source_file: string;
  date_parsed: string;
  document_id: string;
  document_version: string;
  ops: Op[];
}

function SplitIntoPages(data: string): string[] {
  const data_chunks = data.split('<a name=');
  const pages: string[] = [];
  for (const page of data_chunks) {
    const first_line = page.split('\n')[0];
    let match;
    if (!(match = first_line.match(/(\d+)>/))) continue;
    const idx = parseInt(match[1]);
    if (pages[idx]) {
      // only store first page found
      continue;
    }
    pages[parseInt(match[1])] = page;
  }
  return pages;
}

function ParseOps(data_pages: string[], opIndex: OpIndexEntry[]): Result {
  let failedOps = {};
  let allops = [];
  for (const e of opIndex) {
    try {
      const ops = ParseOpsInPage(data_pages, e.page);
      if (ops.length == 0) {
        throw new Error('Zero ops returned. Parse failed?');
      }
      allops = allops.concat(ops);
    } catch (err) {
      failedOps[e.ops.toString()] = err.toString();
    }
  }
  const idAndVersion = ExtractDocIdAndVersion(data_pages);
  const result: Result = {
    source_file: filename,
    date_parsed: new Date().toISOString(),
    ops: allops,
    document_id: idAndVersion.document_id,
    document_version: idAndVersion.document_version,
  };
  fs.writeFileSync('failed.json', JSON.stringify(failedOps, null, ' '));
  fs.writeFileSync('ops.json', JSON.stringify(result, null, ' '));
  return result;
}

function ExtractDocIdAndVersion(data_pages: string[]) {
  const rows = data_pages[1].split('\n');
  let docId;
  let version;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].startsWith('Order Number:')) continue;
    docId = rows[i]
                .split('&#160;')
                .join(' ')
                .split(':')[1]
                .split('<br/>')[0]
                .trim();
    version = rows[i + 1].split('&#160;').join(' ').split('<br/>').join('');
    break;
  }
  return {document_id: docId, document_version: version};
}

function EnsureResult(result: Result) {
  const ops: Op[] = result.ops;
  console.log('Checking result...');
  console.log(`${ops.length} ops found.`);
  const op2instr: Record<string, string[]> = {};
  for (const op of ops) {
    if (!op2instr[op.opcode]) {
      op2instr[op.opcode] = [];
    }
    op2instr[op.opcode].push(op.instr);
  }

  assert.ok(op2instr['83 /2 ib'].includes('ADC r/m16, imm8'));
  assert.ok(op2instr['REX.W + 13 /r'].includes('ADC r64, r/m64'));

  assert.ok(op2instr['04 ib'].includes('ADD AL, imm8'));
  assert.ok(op2instr['REX.W + 03 /r'].includes('ADD r64, r/m64'));

  assert.ok(op2instr['88 /r'].includes('MOV r/m8,r8'));
  assert.ok(op2instr['REX.W + C7 /0 id'].includes('MOV r/m64, imm32'));

  assert.ok(op2instr['0F 05'].includes('SYSCALL'));

  console.log('OK');
}
(() => {
  const data = fs.readFileSync(filename, 'utf-8');
  const data_pages = SplitIntoPages(data);
  // ParseOpsInPage(1237);
  const result: Result = ParseOps(data_pages, ExtractOpIndex());
  EnsureResult(result);
})();
