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

function IsHeaderMatched(lines, pattern) {
  let li = 2;
  for (let pi = 0; pi < pattern.length; pi++, li++) {
    if (pattern[pi] !== lines[li]) return false;
  }
  return true;
}

function IsBeginningOfOp(nextToken: string): boolean {
  return (nextToken.match(/^\s*[0-9A-F]{2}$/) ||
          nextToken.match(/^\s*[0-9A-F]{2}\s/) || nextToken.match(/^REX.*/)) !==
      null;
}
function IsEndOfOpSection(nextToken: string): boolean {
  return (nextToken.match(/Description\s*$/) ||
          nextToken.match('Instruction Operand Encoding')) != null;
}

function ParseOpsInPage01(pnum: number, lines: string[]): Op[] {
  const ops = [];
  for (var i = 10; i < lines.length;) {
    console.log(`First Op Token: ${lines[i]}`)
    if (!IsBeginningOfOp(lines[i]) || IsEndOfOpSection(lines[i])) {
      console.log(`Not matched on ${lines[i]}`)
      break;
    }
    const opcode = NoTags(lines[i++]);
    const instr = NoTags(lines[i++]);
    const last_token = lines[i];
    let opEn;
    for (;;) {
      if (i >= lines.length) {
        throw new Error(`No valid opEn found. last_token = ${last_token}`);
      }
      opEn = lines[i++];
      if (opEnList.includes(opEn)) {
        break;
      }
    }
    let validIn64 = lines[i++];
    let v = validIn64Normalizer[validIn64];
    if (v === undefined) {
      throw new Error(`Not a valid validIn64: '${validIn64}'`);
    }
    if (v !== true) {
      if (typeof v === 'string') {
        validIn64 = validIn64Normalizer[validIn64];
      } else if (v instanceof Array && v.length == 2) {
        validIn64 = v[0];
        lines.splice(i, 0, v[1]);
      } else {
        throw new Error(`Not a valid v: '${v}'`);
      }
    }
    const compatLegacy = lines[i++];
    let description = '';
    for (;;) {
      description += NoTags(lines[i++]);
      console.log(description);
      if (IsBeginningOfOp(lines[i]) || IsEndOfOpSection(lines[i])) break;
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

function ParseOpsInPage(pnum: number): Op[] {
  console.log(`ParseOpsInPage: ${pnum}`);
  const data = fs.readFileSync(filename, 'utf-8');
  const data_pages = data.split('<a name=');
  let ops = [];
  for (const page of data_pages) {
    const lines =
        page.split('\n').join('').split('&#160;').join(' ').split('<br/>');
    if (!lines[0].startsWith(`${pnum}>`)) continue;
    console.log(lines);
    const opRefTitle = lines[1];
    if (IsHeaderMatched(lines, headerPattern00) ||
        IsHeaderMatched(lines, headerPattern01)) {
      ops = ops.concat(ParseOpsInPage01(pnum, lines));
    } else{
      throw new Error('Not matched with pattern');
    }
    console.log('----');
    console.log(opRefTitle);
    console.log(ops);
  }
  return ops;
}

function ParseOps(opIndex: OpIndexEntry[]) {
  const ignorePageOps = [
    'ADCX',
    'ADDPD',
    'ADDPS',
  ];
  const shouldSkipThisOps = (e: OpIndexEntry) => {
    for (const op of e.ops) {
      if (ignorePageOps.includes(op)) {
        return true;
      }
    }
    return false;
  };
  let failedOps = {};
  let allops = [];
  for (const e of opIndex) {
    // if(shouldSkipThisOps(e)) continue;
    console.log('----');
    console.log(e.ops);
    console.log('----');
    console.log(e.page);
    try {
      const ops = ParseOpsInPage(e.page);
      if (ops.length == 0) {
        throw new Error('Zero ops returned. Parse failed?');
      }
      console.log(ops);
      allops = allops.concat(ops);
    } catch (err) {
      failedOps[e.ops.toString()] = err.toString();
    }
    console.log(failedOps);
  }
  fs.writeFileSync('failed.json', JSON.stringify(failedOps, null, ' '));
  fs.writeFileSync('ops.json', JSON.stringify(allops, null, ' '));
}
// ParseOps(ExtractOpIndex());
ParseOpsInPage(131);
