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
];

const validIn64Normalizer = {
  'Valid': true,
  ' Valid': 'Valid',
  'Valid N.E.': ['Valid', 'N.E.'],
};

function NoTags(s) {
  return s.replace(/<i>/g, '').replace(/<\/i>/g, '');
}

interface OpIndexEntry {
  page: number, ops: string[]
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
      ['MOVS','MOVSB','MOVSW','MOVSD','MOVSQ']);
  assert.deepEqual(
      ExpandOpTitle('VPBROADCASTB/W/D/Q'),
      ['VPBROADCASTB', 'VPBROADCASTW', 'VPBROADCASTD', 'VPBROADCASTQ']);
  assert.deepEqual(
      ExpandOpTitle(' XTEST '),
      ['XTEST']);
}

ExpandOpTitleTest();

function PrintOpStatistics() {
  const opIndexList = ExtractOpIndex();
  const op2page = GetOpToPageDict(opIndexList);
  const alphaCount = [];
  const lenCount = {};
  let longestMnemonic = "";
  for(const k in op2page) {
    if(longestMnemonic.length < k.length) {
      longestMnemonic = k;
    }
    //
    if(lenCount[k.length] === undefined){
      lenCount[k.length] = 0;
    }
    lenCount[k.length]++;
    //
    const c = k.substr(0, 1);
    if(!alphaCount[c]){
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
PrintOpStatistics();

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

function ParseOpsInPage(pnum) {
  console.log(`ParseOpsInPage: ${pnum}`);
  const data = fs.readFileSync(filename, 'utf-8');
  const data_pages = data.split('<a name=');
  for (const page of data_pages) {
    const lines =
        page.split('\n').join('').split('&#160;').join(' ').split('<br/>');
    if (!lines[0].startsWith(`${pnum}>`)) continue;
    const opRefTitle = lines[1];
    if (lines[2] != 'Opcode') continue;
    const ops = [];
    for (var i = 10; i < lines.length;) {
      if (!lines[i].match(/^[0-9A-F]{2}/) && !lines[i].match(/^REX.*/)) {
        // console.log(`Not matched on ${lines[i]}`)
        break;
      }
      const opcode = NoTags(lines[i++]);
      const instr = NoTags(lines[i++]);
      let opEn;
      for (;;) {
        if (i >= lines.length) {
          throw new Error('No valid opEn found');
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
        if (description.endsWith('.')) break;
      }
      ops.push({
        opcode: opcode,
        instr: instr,
        op_en: opEn,
        valid_in_64: validIn64,
        compat_legacy: compatLegacy,
        description: description
      });
    }
    console.log('----');
    console.log(opRefTitle);
    console.log(ops);
  }
}

/*
ParseOpsInPage(133);  // ADD
ParseOpsInPage(699);  // MOV
*/
