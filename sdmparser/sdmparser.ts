const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const parser = require('fast-xml-parser');
const he = require('he');

interface SDMDataAttr {
  source_file: string;
  date_parsed: string;
  document_id: string;
  document_version: string;
}

interface SDMData {
  attributes: SDMDataAttr;
}

interface SDMText {
  text?: string;
  attr: any;
  i?: string;
  a?: {text: string, attr: {href?: string, top?: string, left?: string}};
}

interface SDMPage {
  attr: any;
  fontspec: any;
  text: SDMText[];
}

interface SDMInstr {
  opcode: string;
  opcode_parsed: string[];
  instr: string;
  instr_parsed: string[];
  op_en?: string;
  valid_in_64bit_mode?: boolean;
  valid_in_compatibility_mode?: boolean;
  valid_in_legacy_mode?: boolean;
  cpuid_feature_flag?: string;
  description: string;
}


function ExtractSDMDataAttr(filepath: string, firstPage: SDMPage): SDMDataAttr {
  console.log(firstPage);
  const result = {
    source_file: path.basename(filepath),
    date_parsed: new Date().toISOString(),
    document_id: null,
    document_version: null
  };
  for (let i = 0; i < firstPage.text.length; i++) {
    const s = firstPage.text[i].text;
    if (!s || !s.startsWith('Order Number:'))
      continue;
    result.document_id = s.split(':')[1].trim();
    result.document_version = firstPage.text[i + 1].text.trim();
  }
  return result;
}

function ExpandMnemonic(title: string): string[] {
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
      if (!base.endsWith(suffix))
        continue;
      base = base.substr(0, base.length - suffix.length);
    }
    for (let i = 1; i < slashSeparated.length; i++) {
      ops.push(base + slashSeparated[i]);
    }
  }
  return ops.map((e) => e.trim());
}

function TestExpandMnemonic() {
  assert.deepEqual(
      ExpandMnemonic('MOVDQU,VMOVDQU8/16/32/64'),
      ['MOVDQU', 'VMOVDQU8', 'VMOVDQU16', 'VMOVDQU32', 'VMOVDQU64']);
  assert.deepEqual(
      ExpandMnemonic('MOVDQA,VMOVDQA32/64'),
      ['MOVDQA', 'VMOVDQA32', 'VMOVDQA64']);
  assert.deepEqual(
      ExpandMnemonic('MOVS/MOVSB/MOVSW/MOVSD/MOVSQ'),
      ['MOVS', 'MOVSB', 'MOVSW', 'MOVSD', 'MOVSQ']);
  assert.deepEqual(
      ExpandMnemonic('VPBROADCASTB/W/D/Q'),
      ['VPBROADCASTB', 'VPBROADCASTW', 'VPBROADCASTD', 'VPBROADCASTQ']);
  assert.deepEqual(ExpandMnemonic(' XTEST '), ['XTEST']);
}

interface SDMInstrIndex {
  mnemonics: string[];
  physical_page: number;
}

function ExtractSDMInstrIndex(sdmPages: SDMPage[]): SDMInstrIndex[] {
  const index =
      sdmPages.filter((e) => e && e.text)
          .map((e) => e.text)
          .flat()
          .filter((e) => e.a !== undefined)
          .map((e) => e.a)
          .filter((e) => e.text && e.text.toString().indexOf('—') != -1)
          .map((e): SDMInstrIndex => {
            const title = e.text.toString().split('.')[0].split('—')[0];
            return {
              mnemonics: ExpandMnemonic(title),
              physical_page: parseInt(e.attr.href.split('#')[1]),
            };
          });
  const instrIndex = [];
  let lastPage = 0;
  for (const e of index) {
    if (lastPage > e.physical_page)
      break;
    lastPage = e.physical_page;
    instrIndex.push(e);
  }
  return instrIndex;
}

function ParseXMLToSDMPages(data: string): SDMPage[] {
  // returns array of SDMPage. Index of the array equals physical page number in
  // SDM.
  const options = {
    attributeNamePrefix: '',
    attrNodeName: 'attr',  // default is 'false'
    textNodeName: 'text',
    ignoreAttributes: false,
    ignoreNameSpace: false,
    allowBooleanAttributes: false,
    parseNodeValue: false,
    parseAttributeValue: false,
    trimValues: true,
    cdataTagName: '__cdata',  // default is 'false'
    cdataPositionChar: '\\c',
    parseTrueNumberOnly: true,
    arrayMode: false,  //"strict"
    attrValueProcessor: (val, attrName) =>
        he.decode(val, {isAttributeValue: true}),         // default is a=>a
    tagValueProcessor: (val, tagName) => he.decode(val),  // default is a=>a
    stopNodes: ['parse-me-as-string']
  };
  if (!parser.validate(data)) {
    console.error(
        'Not a valid xml. Please generate with `pdftohtml -xml 325383-sdm-vol-2abcd.pdf`')
    process.exit();
  }
  const sdm = parser.parse(data, options);
  assert.ok(sdm.pdf2xml.page);
  sdm.pdf2xml.page.unshift(null);  // align page 1 to index 1
  for (let p of sdm.pdf2xml.page) {
    if (!p || !p.text)
      continue;
    for (let t of p.text) {
      if (!t.attr.top || !t.attr.left)
        continue;
      t.attr.top = parseInt(t.attr.top);
      t.attr.left = parseInt(t.attr.left);
      delete t.attr.width;
      delete t.attr.height;
      delete t.attr.font;
    }
  }
  return <SDMPage[]>sdm.pdf2xml.page;
}

function CanonicalizeValidIn64(str: string): boolean {
  if (str === 'Invalid') {
    return false;
  }
  if (str === 'Inv.') {
    return false;
  }
  if (str === 'N.E.') {
    return false;
  }
  if (str === 'N.S.') {
    return false;
  }
  if (str === 'Valid') {
    return true;
  }
  throw new Error(`${str} is not valid for ValidIn64`);
}
function CanonicalizeCompatLeg(str: string): boolean {
  if (str === 'Valid') {
    return true;
  }
  if (str === 'Invalid') {
    return true;
  }
  if (str === 'N.E.') {
    return false;
  }
  throw new Error(`${str} is not valid for CompatLeg`);
}
function CanonicalizeValidIn3264(str: string):
    {valid32: boolean, valid64: boolean} {
  if (str === 'V/V') {
    return {valid32: true, valid64: true};
  }
  throw new Error(`${str} is not valid for 64/32 bit Mode Support`);
}
function GetText(t: SDMText): string {
  if (t.i)
    return ' ' + t.i + ' ';
  if (t.text)
    return t.text;
  return '';
}

class SDMTextStream {
  private s: SDMText[];
  private nextIndex: number;
  constructor(s: SDMText[]) {
    this.s = s;
    this.nextIndex = 0;
  }
  next(): SDMText {
    if (this.nextIndex >= this.s.length) {
      throw new Error('No more tokens in this row!');
    }
    return this.s[this.nextIndex++];
  }
  peek(ofs: number = 0): SDMText {
    if (this.nextIndex + ofs >= this.s.length) {
      throw new Error('No more tokens in this row!');
    }
    return this.s[this.nextIndex + ofs];
  }
  hasNext(): boolean {
    return this.nextIndex < this.s.length;
  }
  getFollowing(count: number = undefined): SDMText[] {
    return this.s.concat().splice(this.nextIndex, count);
  }
}

function GetNonEmptyText(s: SDMTextStream): string {
  while (true) {
    const t = GetText(s.next());
    if (t !== '')
      return t;
  }
}

function MakeRows(tokens: SDMText[]): SDMText[][] {
  // Convert list of tokens into list of rows of tokens.
  const textRows = [];
  let row = [];
  let currentTop = tokens[0].attr.top;
  for (let t of tokens) {
    if (t.attr.top > currentTop + 7) {
      textRows.push(row);
      currentTop = t.attr.top;
      row = [];
    }
    row.push(t);
  }
  if (row.length) {
    textRows.push(row);
  }
  for (const k in textRows) {
    textRows[k] = textRows[k].sort((lhs: SDMText, rhs: SDMText) => {
      return lhs.attr.left - rhs.attr.left;
    });
  }
  console.error('rows:');
  console.error(
      textRows
          .map(e => e.map(e => `${GetText(e)}@${e.attr.left}`).join('\', \''))
          .join('\n'));
  console.error('rows end');
  return textRows;
}
function MakeCols(tokens: SDMText[], colLeftList: number[]): SDMText[][] {
  // Convert list of tokens into list of columns
  // colLeftList: 'left' values for each columns. Should be monotonically
  // increasing.
  const textCols = [];
  let row = [];
  let currentTop = tokens[0].attr.top;
  const getColIndex = (t) => {
    for (let i = 0; i < colLeftList.length; i++) {
      if (t.attr.left < colLeftList[i] - 5) {
        return i - 1;
      }
    }
    return colLeftList.length - 1;
  };
  for (const t of tokens) {
    const colIndex = getColIndex(t);
    if (!textCols[colIndex]) {
      textCols[colIndex] = [];
    }
    textCols[colIndex].push(t);
  }
  return textCols;
}
function MakeTable(
    tokens: SDMText[], colLeftList: number[],
    keyColIndex: number): SDMText[][][] {
  // returns table[table row][col][token index]
  const textCols = MakeCols(tokens, colLeftList);
  console.error(textCols);
  const keyCol = textCols[keyColIndex];
  const table = [];
  for (let keyTokenIndex = 0; keyTokenIndex < keyCol.length; keyTokenIndex++) {
    const keyTokenTop = keyCol[keyTokenIndex].attr.top;
    const nextKeyTokenTop = (keyCol[keyTokenIndex + 1] !== undefined) ?
        keyCol[keyTokenIndex + 1].attr.top :
        null;
    console.error(`${keyTokenIndex}: ${keyTokenTop} => ${nextKeyTokenTop}`);
    const tableRow = [];
    for (const col of textCols) {
      const cell = [];
      for (const t of col) {
        if (t.attr.top <= keyTokenTop - 10)
          continue;
        if (nextKeyTokenTop && t.attr.top >= nextKeyTokenTop)
          break;
        cell.push(t);
      }
      tableRow.push(cell);
    }
    table.push(tableRow);
  }
  console.error(JSON.stringify(
      table.map(tr => tr.map(c => c.map(t => GetText(t)))), null, ' '));
  return table;
}

function IsEndOfInstrTable(t: SDMText) {
  // Returns true if t is a next section header or text at the bottom of a page
  // like "MOV—Move"
  const s = GetText(t);
  if (s === 'Description' && t.attr.top >= 200) {
    // 'Description in outside of table, not in the table header'
    return true;
  }
  return s === 'Instruction Operand Encoding' || s === 'NOTES:' ||
      s === 'NOTE:' || s === 'NOTE' || s.indexOf('—') !== -1 ||
      s.match(/^\d-\d+/) !== null;
}

function CanonicalizeInstr(s: string): string[] {
  const canonicalized = [];
  let sep = s.split(' ');
  const reMnemonic = /^[A-Z]\w+$/;
  const mn = sep[0];
  if (!reMnemonic.test(mn)) {
    throw new Error(`${mn} does not match with reMnemonic`);
  }
  canonicalized.push(mn);
  sep = sep.splice(1);

  if (mn === 'REP' || mn === 'REPE' || mn === 'REPNE') {
    // REP <instr> <operands, ...>
    const subMn = sep[0];
    if (!reMnemonic.test(subMn)) {
      throw new Error(`${subMn} does not match with reMnemonic`);
    }
    canonicalized.push(subMn);
    sep = sep.splice(1);
  }
  // operands
  const operands = sep.join(' ').split(',').map(s => s.trim());
  const reOperandList = [
    'r(/m)?(8|16|32|64)',
    'r16/r32/m16',
    'r64/m16',
    'm(16&(32|64))?',
    'm(8|16|32|64)',
    'm(32|64|80)fp',
    'm(32|16)int',
    '(m|ptr)16:(16|32|64)',
    '(A|C|D|B)(L|H|X)',
    '(R|E)(A|C|D|B)X',
    'Sreg',
    '(ES|CS|SS|DS|FS|GS)',
    'xmm(1|2|3)',
    'xmm1 {k1}{z}',
    'm64 {k1}',
    'xmm1/m64',
    'DR0–DR7',
    'CR0–CR7|CR8',
    'moffs(8|16|32|64)',
    'imm(8|16|32|64)',
    'rel(8|16|32|64)',
    'ST\\((0|i)\\)',
    '1',
  ];
  const reRemovePunctuator = /\s*\**\s*$/;
  const reRemoveSpaces = /\s/g;
  const reRemoveExtraCharLeft = /^1\s+/;
  const reOperand = new RegExp('^((' + reOperandList.join(')|(') + '))$');
  for (const operand of operands) {
    if (operand.length === 0) {
      continue;
    }
    if (reOperand.test(operand)) {
      canonicalized.push(operand);
      continue;
    }
    const operandWithoutPunctuator = operand.replace(reRemovePunctuator, '');
    if (reOperand.test(operandWithoutPunctuator)) {
      canonicalized.push(operandWithoutPunctuator);
      continue;
    }
    const operandSpaceRemoved =
        operandWithoutPunctuator.replace(reRemoveSpaces, '');
    if (reOperand.test(operandSpaceRemoved)) {
      canonicalized.push(operandSpaceRemoved);
      continue;
    }
    const operandExtraLeftRemoved = operand.replace(reRemoveExtraCharLeft, '');
    if (reOperand.test(operandExtraLeftRemoved)) {
      canonicalized.push(operandExtraLeftRemoved);
      continue;
    }
    if (mn === 'ENTER' && (operand === '0' || operand === '1')) {
      canonicalized.push(operandExtraLeftRemoved);
      continue;
    }
    throw new Error(`${operand} does not match operand criteria`);
  }
  return canonicalized;
}
function TestCanonicalizeInstr() {
  assert.deepEqual(
      CanonicalizeInstr('REP OUTS DX, r/m32'), ['REP', 'OUTS', 'DX', 'r/m32']);
  assert.deepEqual(
      CanonicalizeInstr('VMOVSD xmm1 {k1}{z}, xmm2, xmm3'),
      ['VMOVSD', 'xmm1 {k1}{z}', 'xmm2', 'xmm3']);
}

function CanonicalizeOpcode(s: string): string[] {
  const canonicalized = [];
  const reREXPrefix = /^(REX(\.R|\.W)?)(\s*\+\s*)?/;
  const reOpByte = /^[0-9A-F]{2}(\s|$|\/|\+)/;
  const reImm = /^(i(b|w|d|o))/;
  const reRemovePunctuator = /\**/g;
  s = s.trim().replace(reRemovePunctuator, '');
  if (s.startsWith('NP')) {
    canonicalized.push(s.substr(0, 2));
    s = s.substr(2).trim();
  }
  if (s.startsWith('NFx')) {
    canonicalized.push(s.substr(0, 3));
    s = s.substr(3).trim();
  }
  if (s.startsWith('VEX.') || s.startsWith('EVEX.')) {
    canonicalized.push(s.substr(0, s.indexOf(' ')));
    s = s.substr(canonicalized[canonicalized.length - 1].length).trim();
  }
  {
    const match = s.match(reREXPrefix);
    if (match) {
      canonicalized.push(match[1]);
      s = s.substr(match[0].length).trim();
    }
  }
  while (reOpByte.test(s)) {
    canonicalized.push(s.substr(0, 2));
    s = s.substr(2).trim();
  }
  if (canonicalized[0] === 'F3' || canonicalized[0] == 'F2') {
    // REP/REPE/REPNE
    {
      const match = s.match(reREXPrefix);
      if (match) {
        canonicalized.push(match[1]);
        s = s.substr(match[0].length).trim();
      }
    }
    while (reOpByte.test(s)) {
      canonicalized.push(s.substr(0, 2));
      s = s.substr(2).trim();
    }
  }
  if (s[0] === 'c') {
    const reRegCodeOfs = /^(c(b|w|d|p|o|t))/;
    const match = s.match(reRegCodeOfs);
    if (!match) {
      throw new Error(`cb, cw, cd, cp, co, ct is expected. input: ${s}`);
    }
    canonicalized.push(match[1]);
    s = s.substr(match[0].length).trim();
  }
  if (s[0] === '+') {
    const reRegInOpcode = /^\+\s*((r(b|w|d|o))|i)/;
    const match = s.match(reRegInOpcode);
    if (!match) {
      throw new Error(`+rb, +rw, +rd, +ro, +iis expected. input: ${s}`);
    }
    canonicalized.push('+' + match[1]);
    s = s.substr(match[0].length).trim();
  }
  if (s[0] === '/') {
    // /digit (0-7) or /r
    const reModRM = /^(\/\s*(r|[0-7]))/;
    const match = s.match(reModRM);
    if (!match) {
      throw new Error(`/[0-7] or /r is expected. input: ${s}`);
    }
    canonicalized.push(match[1].replace(/ /g, ''));
    s = s.substr(match[0].length).trim();
  }
  {
    const match = s.match(reImm);
    if (match) {
      canonicalized.push(match[1]);
      s = s.substr(match[0].length).trim();
    }
  }
  if (canonicalized[0] === 'C8' /* ENTER */) {
    while (reOpByte.test(s)) {
      canonicalized.push(s.substr(0, 2));
      s = s.substr(2).trim();
    }
    {
      const match = s.match(reImm);
      if (match) {
        canonicalized.push(match[1]);
        s = s.substr(match[0].length).trim();
      }
    }
  }

  if (s.length) {
    throw new Error(`Extra input: ${s}`);
  }
  return canonicalized;
}

function TestCanonicalizeOpcode() {
  assert.deepEqual(CanonicalizeOpcode('00/r'), ['00', '/r']);
  assert.deepEqual(CanonicalizeOpcode('00 / r'), ['00', '/r']);
  assert.deepEqual(CanonicalizeOpcode('00+rb'), ['00', '+rb']);
  assert.deepEqual(CanonicalizeOpcode('00 + rb'), ['00', '+rb']);
  assert.deepEqual(CanonicalizeOpcode('00 ib'), ['00', 'ib']);
  assert.deepEqual(CanonicalizeOpcode('EB cb'), ['EB', 'cb']);
  assert.deepEqual(CanonicalizeOpcode('F2 REX.W A7'), ['F2', 'REX.W', 'A7']);
}

function Parser_OpInstr_OpEn_6432_CPUID_Desc(table: SDMText[][][]) {
  return table.map(tr => {
    const opInstrRows = MakeRows(tr[0]);
    const opRow = opInstrRows[0];
    const InstrRows = opInstrRows.splice(1);
    const opcode = opRow.map(t => GetText(t).trim()).join(' ');
    console.log(opcode);
    const instr = InstrRows.flat().map(t => GetText(t).trim()).join(' ');
    console.log(instr);
    const op_en = GetText(tr[1][0]);
    let valid_in_3264_str = GetText(tr[2][0]);
    let cpuid_str = GetText(tr[3][0]);
    const description = tr[4].map(t => GetText(t).trim()).join(' ');
    console.log({
      opcode: opcode,
      opcode_parsed: CanonicalizeOpcode(opcode),
      instr: instr,
      instr_parsed: CanonicalizeInstr(instr),
      op_en: op_en,
      valid_in_3264_str: valid_in_3264_str,
      cpuid_str: cpuid_str,
      description: description,
    });
    const validIn3264 = CanonicalizeValidIn3264(valid_in_3264_str);
    return {
      opcode: opcode,
      opcode_parsed: CanonicalizeOpcode(opcode),
      instr: instr,
      instr_parsed: CanonicalizeInstr(instr),
      op_en: op_en,
      valid_in_64bit_mode: validIn3264.valid64,
      valid_in_compatibility_mode: validIn3264.valid32,
      valid_in_legacy_mode: false,
      cpuid_feature_flag: cpuid_str,
      description: description,
    };
  });
}

const parserMap = {
  'opcode#instruction#64-bit#mode#compat/#legmode#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // FDIV
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const instrLeft = headers[1].attr.left;
        const validIn64Left = headers[2].attr.left;
        const validInCompatLegLeft = headers[4].attr.left;
        const descriptionLeft = headers[6].attr.left;
        //
        const table = MakeTable(
            tokens,
            [
              opcodeLeft,
              instrLeft,
              validIn64Left,
              validInCompatLegLeft,
              descriptionLeft,
            ],
            2);
        return table.map(tr => {
          const opcode = tr[0].flat().map(t => GetText(t).trim()).join(' ');
          const instr = tr[1].flat().map(t => GetText(t).trim()).join(' ');
          let valid_in_64_str = GetText(tr[2][0]);
          let valid_in_compat_leg_str = GetText(tr[3][0]);
          const description = tr[4].map(t => GetText(t).trim()).join(' ');
          console.log({
            opcode: opcode,
            opcode_parsed: CanonicalizeOpcode(opcode),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            description: description,
          });
          const valid_in_compat_leg =
              CanonicalizeCompatLeg(valid_in_compat_leg_str);
          return {
            opcode: opcode,
            opcode_parsed: CanonicalizeOpcode(opcode),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            valid_in_64bit_mode: CanonicalizeValidIn64(valid_in_64_str),
            valid_in_compatibility_mode: valid_in_compat_leg,
            valid_in_legacy_mode: valid_in_compat_leg,
            description: description,
          };
        });
      },
  'opcode/#instruction#op/en#64/32#bitmode#support#cpuid#feature#flag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // MOVSD
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn3264Left = headers[3].attr.left;
        const cpuidFeatureLeft = headers[6].attr.left;
        const descriptionLeft = headers[9].attr.left;
        //
        const table = MakeTable(
            tokens,
            [
              opcodeLeft,
              opEnLeft,
              validIn3264Left,
              cpuidFeatureLeft,
              descriptionLeft,
            ],
            1);
        return Parser_OpInstr_OpEn_6432_CPUID_Desc(table);
      },
  'opcode/#instruction#op/#en#64/32bit#mode#support#cpuid#featureflag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // CLWB
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn3264Left = headers[4].attr.left;
        const cpuidFeatureLeft = headers[7].attr.left;
        const descriptionLeft = headers[9].attr.left;
        //
        const table = MakeTable(
            tokens,
            [
              opcodeLeft,
              opEnLeft,
              validIn3264Left,
              cpuidFeatureLeft,
              descriptionLeft,
            ],
            1);
        return Parser_OpInstr_OpEn_6432_CPUID_Desc(table);
      },
  'opcode/#instruction#op/#en#64-bit#mode#compat/#legmode#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn64Left = headers[4].attr.left;
        const validInCompatLegacyLeft = headers[6].attr.left;
        const descriptionLeft = headers[8].attr.left;
        //
        const table = MakeTable(
            tokens,
            [
              opcodeLeft,
              opEnLeft,
              validIn64Left,
              validInCompatLegacyLeft,
              descriptionLeft,
            ],
            1);
        return table.map(tr => {
          const opInstrRows = MakeRows(tr[0]);
          const opRow = opInstrRows[0];
          const InstrRows = opInstrRows.splice(1);
          const opcode = opRow.map(t => GetText(t).trim()).join(' ');
          console.log(opcode);
          const instr = InstrRows.flat().map(t => GetText(t).trim()).join(' ');
          console.log(instr);
          const op_en = GetText(tr[1][0]);
          let valid_in_64_str;
          let compat_leg_str;
          if (GetText(tr[2][0]) === 'Valid N.E.') {
            // hack for 'MOV', 'r/m64, imm32'
            valid_in_64_str = 'Valid';
            compat_leg_str = 'N.E.';
          } else {
            valid_in_64_str = GetText(tr[2][0]);
            compat_leg_str = GetText(tr[3][0]);
          }
          const description = tr[4].map(t => GetText(t).trim()).join(' ');
          console.log({
            opcode: opcode,
            opcode_parsed: CanonicalizeOpcode(opcode),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            op_en: op_en,
            valid_in_64bit_mode: valid_in_64_str,
            valid_in_compatibility_mode: compat_leg_str,
            valid_in_legacy_mode: compat_leg_str,
            description: description,
          });
          return {
            opcode: opcode,
            opcode_parsed: CanonicalizeOpcode(opcode),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            op_en: op_en,
            valid_in_64bit_mode: CanonicalizeValidIn64(valid_in_64_str),
            valid_in_compatibility_mode: CanonicalizeCompatLeg(compat_leg_str),
            valid_in_legacy_mode: CanonicalizeCompatLeg(compat_leg_str),
            description: description,
          };
        });
      },
  'opcode#instruction#op/#en#64-bit#mode#compat/#legmode#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const instrList: SDMInstr[] = [];
        const textRows = MakeRows(tokens);
        //
        const instrLeft = headers[1].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn64Left = headers[4].attr.left;
        const validInCompatLegacyLeft = headers[6].attr.left;
        const descriptionLeft = headers[7].attr.left;
        for (let k = 0; k < textRows.length; k++) {
          console.error(textRows[k]
                            .filter(e => e !== undefined)
                            .map(e => `${GetText(e)}@${e.attr.left}`)
                            .join(','));
          let s = new SDMTextStream(textRows[k]);
          if (!s.hasNext() || IsEndOfInstrTable(s.peek())) {
            break;
          }
          let opcode = [];
          while (s.peek().attr.left < instrLeft - 1) {
            opcode.push(GetText(s.next()).trim());
          }
          const opcodeStr = opcode.join(' ');
          console.log(opcodeStr);
          const instr = [];
          while (s.peek().attr.left < opEnLeft - 50) {
            instr.push(GetText(s.next()).trim());
          }
          console.log(instr);
          const op_en = GetNonEmptyText(s);
          let valid_in_64_str;
          let compat_leg_str;
          if (GetText(s.peek()) === 'Valid N.E.') {
            // hack for 'MOV', 'r/m64, imm32'
            s.next();
            valid_in_64_str = 'Valid';
            compat_leg_str = 'N.E.';
          } else if (GetText(s.peek()) === 'Valid Valid') {
            // hack for C3 RET
            s.next();
            valid_in_64_str = 'Valid';
            compat_leg_str = 'Valid';
          } else {
            valid_in_64_str = GetNonEmptyText(s);
            compat_leg_str = s.next().text;
          }
          let description = '';
          while (true) {
            if (!s.hasNext()) {
              if (k + 1 >= textRows.length) {
                // No more rows
                break;
              }
              // Try next row
              s = new SDMTextStream(textRows[k + 1]);
              if (s.peek().attr.left < descriptionLeft) {
                // Not a description line.
                break;
              }
              // insert space between line feeds
              description += ' ';
              k++;
            }
            description += GetText(s.next());
          }
          console.log({
            opcode: opcodeStr,
            instr: instr,
            op_en: op_en,
            valid_in_64bit_mode: valid_in_64_str,
            valid_in_compatibility_mode: compat_leg_str,
            valid_in_legacy_mode: compat_leg_str,
            description: description,
          })
          instrList.push({
            opcode: opcodeStr,
            opcode_parsed: CanonicalizeOpcode(opcodeStr),
            instr: instr.join(' '),
            instr_parsed: CanonicalizeInstr(instr.join(' ')),
            op_en: op_en,
            valid_in_64bit_mode: CanonicalizeValidIn64(valid_in_64_str),
            valid_in_compatibility_mode: CanonicalizeCompatLeg(compat_leg_str),
            valid_in_legacy_mode: CanonicalizeCompatLeg(compat_leg_str),
            description: description,
          })
        }
        return instrList;
      },
};

function TestParser() {
  let parser;
  parser =
      parserMap['opcode#instruction#op/#en#64-bit#mode#compat/#legmode#description'];
  assert(parser);
  assert.deepEqual(
      parser(
          [
            {'text': 'Opcode', 'attr': {'top': 123, 'left': 72}},
            {'text': 'Instruction', 'attr': {'top': 123, 'left': 220}},
            {'text': 'Op/', 'attr': {'top': 123, 'left': 389}},
            {'text': 'En', 'attr': {'top': 137, 'left': 389}},
            {'text': '64-bit', 'attr': {'top': 123, 'left': 426}},
            {'text': 'Mode', 'attr': {'top': 137, 'left': 426}},
            {'text': 'Compat/', 'attr': {'top': 123, 'left': 498}},
            {'text': 'Leg Mode', 'attr': {'top': 137, 'left': 498}},
            {'text': 'Description', 'attr': {'top': 123, 'left': 568}}
          ],
          [
            {'text': '37', 'attr': {'top': 160, 'left': 72}},
            {'text': 'AAA', 'attr': {'top': 160, 'left': 220}},
            {'text': 'ZO', 'attr': {'top': 160, 'left': 389}},
            {'text': 'Invalid', 'attr': {'top': 160, 'left': 426}},
            {'text': 'Valid', 'attr': {'top': 160, 'left': 498}}, {
              'text': 'ASCII adjust AL after addition.',
              'attr': {'top': 160, 'left': 568}
            }
          ]),
      [{
        opcode: '37',
        opcode_parsed: [
          '37',
        ],
        instr: 'AAA',
        instr_parsed: [
          'AAA',
        ],
        op_en: 'ZO',
        valid_in_64bit_mode: false,
        valid_in_compatibility_mode: true,
        valid_in_legacy_mode: true,
        description: 'ASCII adjust AL after addition.'
      }]);
  assert.deepEqual(
      parser(
          [
            {'text': 'Opcode', 'attr': {'top': 123, 'left': 74}},
            {'text': 'Instruction', 'attr': {'top': 123, 'left': 221}},
            {'text': 'Op/', 'attr': {'top': 123, 'left': 388}},
            {'text': 'En', 'attr': {'top': 137, 'left': 388}},
            {'text': '64-Bit', 'attr': {'top': 123, 'left': 425}},
            {'text': 'Mode', 'attr': {'top': 137, 'left': 425}},
            {'text': 'Compat/', 'attr': {'top': 123, 'left': 497}},
            {'text': 'Leg Mode', 'attr': {'top': 137, 'left': 497}},
            {'text': 'Description', 'attr': {'top': 123, 'left': 567}}
          ],
          [
            {'text': '0F 05', 'attr': {'top': 160, 'left': 74}},
            {'text': 'SYSCALL', 'attr': {'top': 160, 'left': 221}},
            {'text': 'ZO', 'attr': {'top': 160, 'left': 388}},
            {'text': 'Valid', 'attr': {'top': 160, 'left': 425}},
            {'text': 'Invalid', 'attr': {'top': 160, 'left': 497}}, {
              'text': 'Fast call to privilege level 0 system',
              'attr': {'top': 160, 'left': 567}
            },
            {'text': 'procedures.', 'attr': {'top': 177, 'left': 567}}
          ]),
      [{
        opcode: '0F 05',
        opcode_parsed: [
          '0F',
          '05',
        ],
        instr: 'SYSCALL',
        instr_parsed: [
          'SYSCALL',
        ],
        op_en: 'ZO',
        valid_in_64bit_mode: true,
        valid_in_compatibility_mode: true,
        valid_in_legacy_mode: true,
        description: 'Fast call to privilege level 0 system procedures.'
      }]);
}

const HeaderTexts = {
  'Opcode': true,
  'Opcode/': true,
  'Opcode /': true,
  'Opcode*': true,
  'Opcode***': true,
  'Op/': true,
  'Op / En': true,
  '64/32': true,
  '64/32 bit': true,
  '64-Bit': true,
  '64-bit': true,
  'Compat/': true,
  'Description': true,
  'Instruction': true,
  'En': true,
  'bit Mode': true,
  'Mode': true,
  'Leg Mode': true,
  'CPUID': true,
  'Feature': true,
  'Feature Flag': true,
  'Flag': true,
  'Support': true,
};

function ParseInstrTableHeader(s: SDMTextStream):
    {pageHeader: SDMText[], tableHeader: SDMText[]} {
  // Returns empty array if header did not found.
  const pageHeader = [];
  while (s.hasNext() && !HeaderTexts[GetText(s.peek())]) {
    // Skip page header and title
    pageHeader.push(s.next());
  }
  if (!s.hasNext()) {
    return {pageHeader: [], tableHeader: []};
  }
  const header = [];
  while (HeaderTexts[GetText(s.peek())]) {
    header.push(s.next());
  }
  console.error('Last non-header element:');
  console.error(s.peek());
  let headerSortedByColumn = header.sort((lhs: SDMText, rhs: SDMText) => {
    if (lhs.attr.left == rhs.attr.left) {
      return lhs.attr.top - rhs.attr.top;
    }
    return lhs.attr.left - rhs.attr.left;
  });
  console.error('Header Elements:');
  for (const e of headerSortedByColumn) {
    console.error(e);
  }
  return {pageHeader: pageHeader, tableHeader: headerSortedByColumn};
}

function ParseInstr(pages: SDMPage[], startPage: number): SDMInstr[] {
  let instrs = [];
  let lastHeaderKey = null;
  for (let p = startPage; p < pages.length; p++) {
    let page = pages[p];
    try {
      let sorted = page.text.sort((lhs: SDMText, rhs: SDMText) => {
        if (lhs.attr.top == rhs.attr.top) {
          return lhs.attr.left - rhs.attr.left;
        }
        return lhs.attr.top - rhs.attr.top;
      });
      const s = new SDMTextStream(sorted);
      const {pageHeader, tableHeader} = ParseInstrTableHeader(s);
      if (tableHeader.length == 0) {
        console.error('No table header found.');
        break;
      }
      console.error(`############### page ${p}`);
      console.error(pageHeader);
      console.error(tableHeader);
      const headerKey =
          tableHeader.map(e => e.text.replace(/\*/g, '').replace(/ /g, ''))
              .join('#')
              .toLowerCase();
      if (lastHeaderKey &&
          (lastHeaderKey !== headerKey || pageHeader.length > 1)) {
        break;
      }
      if (!parserMap[headerKey]) {
        throw new Error(
            `Parser not implemented for tableHeader key ${headerKey}`);
      }
      let count = 0;
      while (!IsEndOfInstrTable(s.peek(count))) {
        count++;
      }
      instrs = instrs.concat(
          parserMap[headerKey](tableHeader, s.getFollowing(count)));
      lastHeaderKey = headerKey;
    } catch (e) {
      console.log(page);
      throw e;
    }
  }
  return instrs;
}

const optionDefinitions = [
  {name: 'runtest', type: Boolean},
  {name: 'help', alias: 'h', type: Boolean},
  {name: 'list', alias: 'l', type: Boolean},
  {
    name: 'file',
    alias: 'f',
    type: String,
    description:
        'Path to source SDM xml file (can be generated from pdf with `pdftohtml -xml`).'
  },
  {
    name: 'mnemonic',
    alias: 'm',
    type: String,
    multiple: true,
    description: 'Mnemonics to parse. Default is not set (parse all mnemonics).'
  },
];

const sections = [
  {header: 'sdmparser.js', content: 'Parse Intel SDM and generate JSON'},
  {header: 'Options', optionList: optionDefinitions}
];

process.exit((() => {
  const commandLineArgs = require('command-line-args');
  const commandLineUsage = require('command-line-usage');
  const options = commandLineArgs(optionDefinitions);
  if (options.help) {
    const usage = commandLineUsage(sections);
    console.log(usage);
    return 0;
  }
  if (options.runtest) {
    TestCanonicalizeOpcode();
    TestCanonicalizeInstr();
    TestExpandMnemonic();
    TestParser();
    console.log('PASS');
    return 0;
  }
  let filepath;
  if (options.file === undefined) {
    filepath = 'pdf/325383-sdm-vol-2abcd.xml'
    console.error(
        `--file option is not set. Using default path (${filepath}).`);
  } else {
    filepath = options.file;
  }
  let requestedMnemonicList: Record<string, boolean>;
  if (options.mnemonic) {
    requestedMnemonicList = {};
    for (const m of options.mnemonic) {
      requestedMnemonicList[m] = true;
    }
    console.error(
        `Parsing following mnemonic(s): ${options.mnemonic.join(', ')}`);
  }
  const data = fs.readFileSync(filepath, 'utf-8');
  const sdmPages = ParseXMLToSDMPages(data);
  const instrIndex: SDMInstrIndex[] = ExtractSDMInstrIndex(sdmPages);
  if (options.list) {
    console.log(JSON.stringify(instrIndex, null, ' '));
    return 0;
  }
  let passCount = 0;
  let failCount = 0;
  let instList = [];
  const matchedInstrMap = {};
  const failedReasons = {};
  for (const e of instrIndex) {
    let requestedInstrPage = false;
    for (const m of e.mnemonics) {
      if (requestedMnemonicList === undefined || requestedMnemonicList[m]) {
        matchedInstrMap[m] = true;
        requestedInstrPage = true;
      }
    }
    if (!requestedInstrPage)
      continue;
    try {
      const instrs = ParseInstr(sdmPages, e.physical_page);
      console.log(instrs);
      instList = instList.concat(instrs);
      passCount++;
    } catch (err) {
      console.error(err.stack);
      failedReasons[e.mnemonics.join(',')] = err.stack;
      failCount++;
    }
  }
  if (passCount + failCount == 0) {
    console.error('No instr parsed...');
    return 1;
  }
  if (requestedMnemonicList) {
    for (const m in requestedMnemonicList) {
      if (!matchedInstrMap[m]) {
        console.error(`Mnemonic ${m} is requested but not parsed.`);
        return 1;
      }
    }
  }
  fs.writeFileSync('instr_list.json', JSON.stringify(instList, null, ' '));
  if (failCount) {
    console.error('Failed reasons:');
    console.error(failedReasons);
  }
  console.error(`Succesfully parsed: ${passCount} ( ${
      (passCount / (passCount + failCount) * 100).toPrecision(3)}% )`);
  console.error(`Failed            : ${failCount} ( ${
      (failCount / (passCount + failCount) * 100).toPrecision(3)}% )`);
  return failCount === 0 ? 0 : 1;
})());
