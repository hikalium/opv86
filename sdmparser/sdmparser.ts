const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;
const parser = require('fast-xml-parser');
const he = require('he');

// The name of a leaf function in the brackets is a part of the mnemonic.
// Required by: GETSEC[CAPABILITIES] and the other GETSEC leaves in
// 325383-092US (June 2026).
const reMnemonic = /^[A-Z]\w+(\[\w+\])?$/;

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

function ExpandBracketedMnemonic(title: string): string[] {
  // A group of the alternatives can be written in the brackets. Expand them
  // into all the combinations. A bracket without a comma in it is a part of
  // the mnemonic itself (e.g. 'GETSEC[CAPABILITIES]'), so it is kept.
  // Required by: VF[,N]MADD[132,213,231]PH, VF[,N]MADD[132,213,231]SH,
  // VF[,N]MSUB[132,213,231]PH, VF[,N]MSUB[132,213,231]SH,
  // VPDPB[SU,UU,SS]D[,S] and VPDPW[SU,US,UU]D[,S] in 325383-092US (June 2026).
  const match = title.match(/^([^\[]*)\[([^\]]*,[^\]]*)\](.*)$/);
  if (!match) {
    return [title];
  }
  return match[2]
      .split(',')
      .map(alt => ExpandBracketedMnemonic(`${match[1]}${alt}${match[3]}`))
      .flat();
}

function ExpandMnemonic(title: string): string[] {
  return ExpandBracketedMnemonic(title.trim())
      .map(t => ExpandSlashSeparatedMnemonic(t))
      .flat();
}

function ExpandSlashSeparatedMnemonic(title: string): string[] {
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
  // The groups of the alternatives written in the brackets.
  assert.deepEqual(ExpandMnemonic('VF[,N]MADD[132,213,231]SH'), [
    'VFMADD132SH', 'VFMADD213SH', 'VFMADD231SH', 'VFNMADD132SH',
    'VFNMADD213SH', 'VFNMADD231SH'
  ]);
  assert.deepEqual(ExpandMnemonic('VPDPW[SU,US,UU]D[,S]'), [
    'VPDPWSUD', 'VPDPWSUDS', 'VPDPWUSD', 'VPDPWUSDS', 'VPDPWUUD', 'VPDPWUUDS'
  ]);
  // A bracket without a comma is a part of the mnemonic.
  assert.deepEqual(
      ExpandMnemonic('GETSEC[CAPABILITIES]'), ['GETSEC[CAPABILITIES]']);
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
  // A section title which contains an em dash is not always an instruction
  // (e.g. 'Event 0—Divide Error Exception (#DE)' and 'Function 00H—...' of
  // volume 3), so require the name to look like a mnemonic.
  const reMnemonicOfIndex = /^[A-Z][A-Za-z0-9_\[\]]*$/;
  const instrIndex = [];
  let lastPage = 0;
  for (const e of index) {
    if (!e.mnemonics.some(m => reMnemonicOfIndex.test(m))) {
      continue;
    }
    if (lastPage > e.physical_page)
      break;
    lastPage = e.physical_page;
    instrIndex.push(e);
  }
  return instrIndex;
}

function FlattenAnchorsInMixedText(data: string): string {
  // pdftohtml wraps hyperlinks (e.g. footnote markers) with <a> tags, and the
  // boundary of them can be in the middle of a <text> element, like
  // `<a>, r</a>8` or `ADC r/m<a>8</a>`. Since the XML parser used here does not
  // preserve the order of the text around a child element, remove the <a> tags
  // in such elements to keep the text in the original order.
  // <text> elements which contain nothing but an anchor are left as is,
  // because the index of the instructions is extracted from their href.
  const reTextElement = /(<text[^>]*>)([\s\S]*?)(<\/text>)/g;
  const reAnchorElement = /<a(?:\s[^>]*)?>[\s\S]*?<\/a>/g;
  const reAnchorTag = /<\/?a(?:\s[^>]*)?>/g;
  return data.replace(reTextElement, (whole, open, inner, close) => {
    if (inner.indexOf('<a') === -1) {
      return whole;
    }
    if (inner.replace(reAnchorElement, '').replace(/<[^>]*>/g, '').trim() ===
        '') {
      return whole;
    }
    return open + inner.replace(reAnchorTag, '') + close;
  });
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
  data = FlattenAnchorsInMixedText(data);
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
      // height is kept to detect superscript footnote markers.
      t.attr.height = parseInt(t.attr.height);
      delete t.attr.width;
      delete t.attr.font;
    }
  }
  return <SDMPage[]>sdm.pdf2xml.page;
}

function CanonicalizeValidIn64(str: string): boolean {
  // The text extraction can put extra spaces in the value (e.g. 'N. E.').
  str = str.split('*').join('').replace(/\s/g, '');
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
  if (str === 'V/N.E.') {
    // CMOVcc
    return true;
  }
  throw new Error(`${str} is not valid for ValidIn64`);
}
function CanonicalizeCompatLeg(str: string): boolean {
  if (str === 'Valid') {
    return true;
  }
  if (str === 'Valid*') {
    // CMPXCHG
    return true;
  }
  if (str === 'Invalid') {
    return false;
  }
  if (str === 'N.E.') {
    return false;
  }
  if (str === 'NA') {
    return false;
  }
  if (str === 'N/A') {
    // CMOVcc
    return false;
  }
  throw new Error(`${str} is not valid for CompatLeg`);
}
function CanonicalizeValidIn3264(str: string):
    {valid32: boolean, valid64: boolean} {
  // The CPUID feature flag in the next column can be merged into this value by
  // the text extraction (e.g. 'V/V (AVX512VL'), so use the first word only.
  str = str.trim().split(/\s+/)[0];
  if (str === 'V/V' || str === 'VV' || str === 'V') {
    return {valid32: true, valid64: true};
  }
  if (str === 'Valid') {
    // The value of the 64-Bit Mode column is used in this column.
    // Required by: RDMSR and WRMSR in 325383-092US (June 2026).
    return {valid32: true, valid64: true};
  }
  if (str.startsWith('V/N.') || str === 'V/I') {
    // Valid in 64 bit mode only. The trailing part of 'V/N.E.' can be lost by
    // the text extraction.
    return {valid32: false, valid64: true};
  }
  if (str === 'N.E./V') {
    // Not encodable in 64 bit mode.
    return {valid32: true, valid64: false};
  }
  throw new Error(`${str} is not valid for 64/32 bit Mode Support`);
}
function GetText(t: SDMText): string {
  if (t.i)
    return ' ' + t.i + ' ';
  if (t.text)
    return t.text;
  if (t.a && t.a.text !== undefined)
    return t.a.text.toString();
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
    if (count === undefined) {
      // splice() removes nothing if the count is undefined, so handle the
      // case of taking all the remaining tokens separately.
      return this.s.slice(this.nextIndex);
    }
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
  if (!tokens.length) {
    return textRows;
  }
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
  return textRows;
}
function RemoveFootnoteMarkers(tokens: SDMText[]): SDMText[] {
  // Footnote markers in the instruction tables are printed as superscript
  // numbers, and they appear as separate tokens which are raised and smaller
  // than the text of the row (e.g. 'ADD r/m8' + '1' + ', imm8').
  // Remove them since they are not a part of the instruction.
  if (!tokens.length) {
    return tokens;
  }
  const markers = new Set();
  for (const row of MakeRows(tokens)) {
    const baseTop = Math.max(...row.map(t => t.attr.top));
    const baseHeight = Math.max(...row.map(t => t.attr.height));
    for (const t of row) {
      if (!/^\d{1,2}$/.test(GetText(t).trim()))
        continue;
      if (!(t.attr.top < baseTop && t.attr.height < baseHeight))
        continue;
      markers.add(t);
    }
  }
  return tokens.filter(t => !markers.has(t));
}
function MakeCols(tokens: SDMText[], colLeftList: number[]): SDMText[][] {
  // Convert list of tokens into list of columns
  // colLeftList: 'left' values for each columns. Should be monotonically
  // increasing.
  // A column can have no token at all, so make the list of the columns first
  // to avoid leaving a hole in it.
  const textCols = colLeftList.map(() => []);
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
    if (colIndex < 0) {
      // The token is on the left of the first column. Ignore it as before.
      continue;
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
  console.error(JSON.stringify(textCols, null, ' '));
  const keyCol = textCols[keyColIndex];
  // A value in the key column can be wrapped into multiple tokens, and they
  // should not be treated as the keys of the different rows. The rows of these
  // tables are at least 20px apart, so merge the tokens closer than that.
  // Required by: VMASKMOVPS in 325383-092US (June 2026), whose 'RVM' is
  // splitted into 'RV' (top=175) and 'M' (top=191).
  const keyTops = [];
  for (const t of keyCol) {
    if (keyTops.length && t.attr.top - keyTops[keyTops.length - 1] < 20) {
      continue;
    }
    keyTops.push(t.attr.top);
  }
  const table = [];
  for (let keyTokenIndex = 0; keyTokenIndex < keyTops.length; keyTokenIndex++) {
    const keyTokenTop = keyTops[keyTokenIndex];
    const nextKeyTokenTop = (keyTops[keyTokenIndex + 1] !== undefined) ?
        keyTops[keyTokenIndex + 1] :
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
  // A section header is like 'ENCODEKEY256—Encode 256-Bit Key With Key
  // Locker', so an uppercase letter is required after the em dash. A
  // description can contain an em dash as well.
  // Required by: ENCODEKEY256 in 325383-092US (June 2026), whose description
  // ends with 'store it in XMM0—3.'.
  // A table which follows the instruction table can have its own caption.
  // Required by: ENCLU[EVERIFYREPORT2] in 325384-092US (June 2026), whose page
  // has a table captioned 'EVERIFYREPORT2 Instruction Layout'.
  if (s.endsWith('Instruction Layout')) {
    return true;
  }
  return s === 'Instruction Operand Encoding' || s === 'NOTES:' ||
      s === 'NOTE:' || s === 'NOTE' || /—[A-Z]/.test(s) ||
      s.match(/^\d-\d+/) !== null;
}

function CanonicalizeInstr(s: string): string[] {
  const canonicalized = [];
  let sep = s.split('*').join('').trim().split(' ');
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
    'm(16|32|64)int',
    'm2byte',
    '(m|ptr)16:(16|32|64)',
    '(A|C|D|B)(L|H|X)',
    '(R|E)(A|C|D|B)X',
    'Sreg',
    '(ES|CS|SS|DS|FS|GS)',
    'xmm[0-7]',
    'ymm([0-9]|1[0-5])',
    'zmm(1|2)',
    'xmm1 {k1}{z}',
    '(x|y|z)mm1{k1}{z}',
    'm64 {k1}',
    'xmm[0-7]/m(64|128)',
    'ymm([0-9]|1[0-5])/m256',
    'xmm3/m128/m64bcst',
    'ymm3/m256/m64bcst',
    'zmm3/m512/m64bcst',
    'zmm3/m512',
    'DR0–DR7',
    'CR0–CR7|CR8',
    'moffs(8|16|32|64)',
    'imm(8|16|32|64)',
    'rel(8|16|32|64)',
    'ST\\((0|i)\\)',
    'ST',
    '1',
    // SIMD registers, optionally followed by the memory / broadcast forms and
    // the decorators like {k1}{z}, {er} and {sae}.
    // e.g. 'xmm3/m128/m32bcst', 'zmm3/m512/m64bcst {er}', 'zmm2+3'
    '(x|y|z)mm\\d*(\\+3)?(/m\\d+)?(/m\\d+bcst)?(\\s*\\{k\\d\\})?(\\s*\\{z\\})?' +
        '(\\s*\\{(er|sae)\\})?',
    // opmask registers. e.g. 'k1', 'k2 {k1}', 'k2/m16'
    'k\\d(/m\\d+)?(\\s*\\{k\\d\\s*\\})?(\\s*\\{z\\})?',
    // MMX registers. e.g. 'mm', 'mm2/m64'
    'mm\\d*(/m\\d+)?',
    // VSIB addressing. e.g. 'vm32x'
    'vm(32|64)(x|y|z)(\\s*\\{k\\d\\})?',
    'bnd\\d*(/m(32|64|128))?',
    'mib',
    'mem',
    'sibmem',
    // AMX tile registers
    'tmm\\d*',
    'reg(/m(8|16|32|64))?',
    'r32/r64',
    'm32&32',
    'r\\d+[ab]?(/m\\d+)?(\\s*\\{(er|sae)\\})?',
    'r/m(8|16|32|64)\\s*\\{(er|sae)\\}',
    'r16/r32/r64',
    'm\\d+(\\s*\\{k\\d\\})?',
    'm(14|94)/(28|108)byte',
    'm512byte',
    'm80bcd',
    'm16&16',
    // implicit operands. e.g. '<XMM0>'
    '<[\\w-]+>',
    // A register followed by the implicit operands without a separator.
    // Required by: ENCODEKEY256 in 325383-092US (June 2026), which is written
    // as 'ENCODEKEY256 r32, r32 <XMM0-6>'.
    'r(8|16|32|64)\\s*<[\\w-]+>',
    // A pair of the opmask registers.
    // Required by: VP2INTERSECTD/VP2INTERSECTQ in 325383-092US (June 2026),
    // which are written as 'VP2INTERSECTD k1+1, xmm2, xmm3/m128/m32bcst'.
    'k\\d\\+1',
    // Typos in the SDM.
    // Required by: VMOVDQU32 ('xmm2/mm128') and VPAND ('ymm3/.m256') in
    // 325383-092US (June 2026).
    'xmm2/mm128',
    'ymm3/\\.m256',
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
  // '.w' in lowercase is used for ADCX/ADOX.
  const reREXPrefix = /^(REX(\.R|\.W|\.w)?)(\s*\+\s*)?/;
  // Lowercase is accepted only if the byte contains a digit, so that it is not
  // confused with the code offsets (cb, cw, ...) and the immediates (ib, ...).
  const reOpByte = /^([0-9A-F]{2}|[0-9][a-f]|[a-f][0-9])(\s|$|\/|\+)/;
  // /ib for VEX, immN for the tables which spell the immediate size out
  const reImm = /^((i(b|w|d|o))|\/ib|imm(8|16|32|64))/;
  const reRemovePunctuator = /\**/g;
  s = s.trim().replace(reRemovePunctuator, '');
  // A comma is put after an opcode byte by mistake.
  // Required by: PAVGB ('66 0F E0, /r') in 325383-092US (June 2026).
  // The conditions in the parentheses contain commas as well (e.g.
  // '(mod!=11, /5, memory only)' of RSTORSSP), so leave them as they are.
  {
    const parenIndex = s.indexOf('(');
    const head = (parenIndex === -1) ? s : s.substr(0, parenIndex);
    const tail = (parenIndex === -1) ? '' : s.substr(parenIndex);
    s = head.replace(/([0-9A-F]{2}),(\s|$)/g, '$1$2') + tail;
  }
  if (s.startsWith('NP')) {
    canonicalized.push(s.substr(0, 2));
    s = s.substr(2).trim();
  }
  if (s.startsWith('NFx')) {
    canonicalized.push(s.substr(0, 3));
    s = s.substr(3).trim();
  }
  if (s.startsWith('VEX.') || s.startsWith('EVEX.')) {
    // The prefix can be splitted into multiple tokens (e.g. 'VEX.256.66.0F'
    // and '.WIG'), so accept the spaces in front of each component.
    // ':' is used as a separator as well, like 'VEX.128.F2.MAP7:W0.F8'.
    // A component can be splitted into two tokens as well, like
    // 'VEX.128.66.0F' + '38.WIG'.
    // Required by: VPMOVZXBW in 325383-092US (June 2026).
    const reVEXPrefix = /^(E?VEX(\s*[.:]\s*\w+|\s+\w+\.\w+)+)/;
    const match = s.match(reVEXPrefix);
    canonicalized.push(match[1].replace(/\s/g, ''));
    s = s.substr(match[0].length).trim();
  }
  {
    const match = s.match(reREXPrefix);
    if (match) {
      canonicalized.push(match[1]);
      s = s.substr(match[0].length).trim();
    }
  }
  for (;;) {
    console.error(`s = ${s}`);
    if (reOpByte.test(s)) {
      canonicalized.push(s.substr(0, 2).toUpperCase());
      s = s.substr(2).trim();
      continue;
    }
    {
      // The REX prefix can be placed after a mandatory prefix byte,
      // like '66 REX.w 0F 38 F6 /r' of ADCX.
      const match = s.match(reREXPrefix);
      if (match) {
        canonicalized.push(match[1]);
        s = s.substr(match[0].length).trim();
        continue;
      }
    }
    if (s.startsWith('0F3A') || s.startsWith('0F38')) {
      // hack for GF2P8AFFINEINVQB and GF2P8MULB
      console.error('HACK!!!!!!!!!!!!!!');
      canonicalized.push(s.substr(0, 2));
      s = s.substr(2).trim();
      canonicalized.push(s.substr(0, 2));
      s = s.substr(2).trim();
      continue;
    }
    break;
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
  if (s === '/') {
    // The 'r' of '/r' is missing in the text extracted from the PDF, though it
    // is rendered in the page.
    // Required by: VMOVD ('VEX.128.66.0F.W0 6E /') in 325383-092US (June 2026).
    s = '/r';
  }
  while (s[0] === '/' && !reImm.test(s)) {
    // /digit (0-7), /r, or /vsib. Both of them can appear in one opcode,
    // like 'EVEX.512.66.0F38.W0 C6 /1 /vsib'.
    // '/is4' is the register specifier in imm8[7:4] of the VEX encoded
    // instructions with 4 operands.
    // Required by: VBLENDVPD and the other VEX instructions in 325383-092US
    // (June 2026), which are written as 'VEX.128.66.0F3A.W0 4B /r /is4'.
    const reModRM = /^(\/\s*(r|vsib|is4|[0-7]))/;
    const match = s.match(reModRM);
    if (!match) {
      throw new Error(`/[0-7], /r, /vsib or /is4 is expected. input: ${s}`);
    }
    canonicalized.push(match[1].replace(/ /g, ''));
    s = s.substr(match[0].length).trim();
  }
  {
    // ModRM byte written as a bit pattern, e.g. '11:rrr:bbb' for the register
    // form and '!(11):rrr:bbb' for the memory form.
    const reModRMPattern = /^((!\(11\)|11):(rrr|[0-7]{3}):(bbb|[0-7]{3}))/;
    const match = s.match(reModRMPattern);
    if (match) {
      canonicalized.push(match[1]);
      s = s.substr(match[0].length).trim();
    }
  }
  {
    // A condition on the ModRM byte written in the parentheses.
    // Required by: ENDBR64/ENDBR32 ('F3 0F 1E /1 (mod=11)') and RSTORSSP
    // ('F3 0F 01 /5 (mod!=11, /5, memory only)') in 325383-092US (June 2026).
    const reModRMCondition = /^(\(mod\s*!?=\s*11[^)]*\))/;
    const match = s.match(reModRMCondition);
    if (match) {
      canonicalized.push(match[1]);
      s = s.substr(match[0].length).trim();
    }
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

  {
    // The opcode column of an SGX leaf function holds the value of the
    // register which selects the leaf, without parentheses.
    // Required by: ENCLS[EADD] ('EAX = 01H') and the other SGX leaves in
    // 325384-092US (June 2026).
    const reLeafSelector = /^((E?[A-D]X)\s*=\s*[0-9A-F]+H)$/;
    const match = s.match(reLeafSelector);
    if (match) {
      canonicalized.push(match[1].replace(/\s+/g, ' '));
      s = '';
    }
  }
  {
    // A precondition of the register written in the parentheses.
    // Required by: GETSEC[CAPABILITIES] ('NP 0F 37 (EAX = 0)') and the other
    // GETSEC leaves in 325383-092US (June 2026).
    const rePrecondition = /^(\((E?[A-D]X)\s*=\s*\w+\))/;
    const match = s.match(rePrecondition);
    if (match) {
      canonicalized.push(match[1].replace(/\s+/g, ' '));
      s = s.substr(match[0].length).trim();
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

function GetTextWithoutPadding(t: SDMText): string {
  // Same as GetText, but without the spaces which are added around an italic
  // text to separate it from the neighbours.
  if (t.i) {
    return t.i.toString();
  }
  return GetText(t);
}

function JoinTokensInRow(tokens: SDMText[]): string {
  // Concatenate the tokens of a row with a space, except where a word is
  // splitted into multiple tokens: after a '/' which begins a ModRM notation,
  // and before a '.' which continues a VEX/EVEX prefix.
  // Required by: PINSRW ('NP 0F C4 /' + an italic 'r' + 'ib') and VPADDUSB
  // ('VEX.256.66.0F' + '.WIG') in 325383-092US (June 2026).
  let joined = '';
  for (const t of tokens) {
    const text = GetTextWithoutPadding(t).trim();
    if (!text.length) {
      continue;
    }
    const isContinuation = joined.endsWith('/') || text.startsWith('.');
    joined += (!joined.length || isContinuation) ? text : ` ${text}`;
  }
  return joined;
}

function JoinWrappedText(parts: string[]): string {
  // A word can be wrapped after '_', and no space should be inserted there.
  // Required by: VCVTNEEPH2PS in 325383-092US (June 2026), whose CPUID Feature
  // Flag 'AVX_NE_CONVERT' is splitted into 'AVX_NE_' and 'CONVERT'.
  let joined = '';
  for (const p of parts) {
    if (!p.length) {
      continue;
    }
    if (!joined.length) {
      joined = p;
      continue;
    }
    if (joined.endsWith('_')) {
      joined += p;
      continue;
    }
    if (joined.endsWith('-')) {
      // A word hyphenated at the end of a line, e.g. the CPUID feature flag
      // 'EVERIFYREPORT2' written as 'EVERI-' + 'FYRE-' + 'PORT2'.
      joined = joined.substr(0, joined.length - 1) + p;
      continue;
    }
    joined += ` ${p}`;
  }
  return joined;
}

function SplitValidIn3264AndCpuid(validIn3264: string, cpuid: string):
    {validIn3264: string, cpuid: string} {
  // The 64/32 bit Mode Support column and the first line of the CPUID Feature
  // Flag column can be extracted as one token. The value of the mode column
  // never contains a space, so the rest belongs to the CPUID column.
  // Required by: VPMADD52LUQ in 325383-092US (June 2026), whose cell is
  // 'V/V (AVX512_IFMA'.
  const match = validIn3264.trim().match(/^(\S+)\s+(\S.*)$/);
  if (!match) {
    return {validIn3264: validIn3264, cpuid: cpuid};
  }
  return {
    validIn3264: match[1],
    cpuid: JoinWrappedText([match[2].trim(), cpuid])
  };
}

function SplitOpEnAndValidIn64(opEn: string, validIn64: string):
    {opEn: string, validIn64: string} {
  // The Op/En column and the 64-Bit Mode column can be extracted as one token,
  // and the mode column is left empty in that case.
  // Required by: PSHUFW ('RMI Valid'), IMUL ('RMI Valid'), SHLD and SHRD
  // ('MRC Valid') in 325383-092US (June 2026).
  const reOpEnWithValidIn64 = /^(\w+)\s+(Valid|Invalid|N\.E\.)$/;
  const match = opEn.trim().match(reOpEnWithValidIn64);
  if (!match) {
    return {opEn: opEn, validIn64: validIn64};
  }
  return {opEn: match[1], validIn64: match[2]};
}

function SplitOpEnAndValidIn3264(opEn: string, validIn3264: string):
    {opEn: string, validIn3264: string} {
  // The Op/En column and the 64/32 bit Mode Support column can be extracted as
  // one token, and the mode column is left empty in that case.
  // Required by: ADDSUBPD, BLENDPD, VPMADD52LUQ and the other SIMD
  // instructions in 325383-092US (June 2026), whose Op/En column has values
  // like 'RVM V/V'.
  const reOpEnWithValidIn3264 = /^(\w+)\s+(V\/V|V\/N\.E\.|V\/I|N\.E\.\/V)$/;
  const match = opEn.trim().match(reOpEnWithValidIn3264);
  if (!match) {
    return {opEn: opEn, validIn3264: validIn3264};
  }
  return {opEn: match[1], validIn3264: match[2]};
}

function MoveMnemonicFromOpcode(opcode: string, instr: string):
    {opcode: string, instr: string} {
  // The instruction can be extracted as a part of the opcode when the both are
  // rendered in the same line. The mnemonic is required to be 3 characters or
  // longer here, so that the opcode bytes like 'D8' are not moved by mistake.
  // Required by: LAHF ('9F LAHF'), CRC32 ('F2 0F 38 F0 /r CRC32 r32, r/m8') and
  // GETSEC[SMCTRL] ('NP 0F 37 (EAX = 7) GETSEC[SMCTRL]') in 325383-092US
  // (June 2026).
  const reOpcodeWithInstr =
      /^(.*\S)\s+([A-Z][A-Z0-9]{2,}(\[\w+\])?(\s+\S.*)?)$/;
  const match = opcode.match(reOpcodeWithInstr);
  if (!match) {
    return {opcode: opcode, instr: instr};
  }
  return {opcode: match[1], instr: `${match[2]} ${instr}`.trim()};
}

function Parser_OpInstr_OpEn_6432_CPUID_Desc(table: SDMText[][][]) {
  // A row without the opcode is not an instruction. It appears when the table
  // is continued to the next page.
  // Required by: PSHUFW, VPRORVD and VRCP14SD in 325383-092US (June 2026).
  return table.filter(tr => tr[0] && tr[0].length).map(tr => {
    const opInstrRows = MakeRows(tr[0]);
    const opRow = opInstrRows[0];
    const InstrRows = opInstrRows.splice(1);
    // The opcode can be wrapped into the next row, and in that case the ModRM
    // bit pattern is placed in the second row.
    // Required by: VBCSTNEBF162PS ('VEX.128.F3.0F38.W0 B1' +
    // '!(11):rrr:bbb') and ROUNDPS ('66 0F 3A 08' + '/r ib') in 325383-092US
    // (June 2026).
    while (InstrRows.length &&
           /^(!\(11\)|11):|^\//.test(
               InstrRows[0].map(t => GetText(t).trim()).join(' '))) {
      opRow.push(...InstrRows.shift());
    }
    let opcode = JoinTokensInRow(opRow);
    console.log(opcode);
    let instr = InstrRows.flat().map(t => GetText(t).trim()).join(' ');
    console.log(instr);
    // The immediate specifier of the opcode can be wrapped into the row of the
    // instruction and merged with the mnemonic.
    // Required by: VPERMILPS in 325383-092US (June 2026), whose last row has
    // 'EVEX.512.66.0F3A.W0 04 /r' and 'ibVPERMILPS zmm1 {k1}{z},'.
    const reImmWithMnemonic = /^(ib|iw|id|io)([A-Z][A-Z0-9]{2,})/;
    const immWithMnemonic = instr.match(reImmWithMnemonic);
    if (immWithMnemonic) {
      instr = instr.substr(immWithMnemonic[1].length);
      opcode = `${opcode} ${immWithMnemonic[1]}`;
    }
    // The mnemonic can be hyphenated at the end of the opcode row, since the
    // opcode and the instruction are in the same column.
    // Required by: AESDECWIDE256KL, AESENCWIDE256KL, AESDECWIDE128KL and
    // AESENCWIDE128KL in 325383-092US (June 2026), whose opcode row ends with
    // 'AES-' and the instruction row starts with 'DECWIDE256KL'.
    const reHyphenatedMnemonic = /\s([A-Z][A-Z0-9]*)-$/;
    const hyphenated = opcode.match(reHyphenatedMnemonic);
    if (hyphenated) {
      opcode = opcode.substr(0, opcode.length - hyphenated[0].length).trim();
      instr = hyphenated[1] + instr;
    }
    // The SDM prints '/r' of the opcode at the end of the last row of the
    // instruction by mistake, since the both are in the same column. Move it
    // back to the opcode, where it belongs; the instruction column would have
    // an operand named 'imm8/r' otherwise.
    // Required by: VREDUCESD in 325383-092US (June 2026), which is written as
    // 'EVEX.LLIG.66.0F3A.W1 57' + 'VREDUCESD xmm1 {k1}{z}, xmm2,
    // xmm3/m64{sae}, imm8/r'.
    if (instr.endsWith('/r')) {
      instr = instr.substr(0, instr.length - '/r'.length).trim();
      opcode = `${opcode} /r`;
    }
    // A value in the Op/En column can be wrapped into multiple tokens.
    // Required by: VMASKMOVPS in 325383-092US (June 2026), whose 'RVM' is
    // splitted into 'RV' and 'M'.
    const cellFirstText = (c: SDMText[]) => (c && c.length) ? GetText(c[0]) : '';
    const opEnAndValidIn3264 = SplitOpEnAndValidIn3264(
        tr[1].map(t => GetText(t).trim()).join(''), cellFirstText(tr[2]));
    const op_en = opEnAndValidIn3264.opEn;
    let valid_in_3264_str = opEnAndValidIn3264.validIn3264;
    // The CPUID Feature Flag cell usually wraps over two or three lines
    // (e.g. '(AVX512VL AND' + 'AVX512BW) OR' + 'AVX10.1'), so join all of the
    // tokens in the cell instead of taking the first line only.
    // Required by: ANDPD, PADDB, MOVDQA, KNOTW and most of the AVX-512
    // instructions in 325383-092US (June 2026).
    let cpuid_str =
        JoinWrappedText((tr[3] || []).map(t => GetText(t).trim()));
    let description = CanonicalizeDescription(tr[4] || []);
    // The CPUID Feature Flag cell and the first line of the description can be
    // extracted as one token when the flag is short.
    // Required by: UMWAIT in 325383-092US (June 2026), whose cell is
    // 'WAITPKG A hint that allows the processor to stop instruction'.
    // The flag has no lowercase letter, and the description is a sentence
    // which starts with a capitalized word or an article.
    const reCpuidWithDescription =
        /^([^a-z]*[A-Z0-9_)])\s+((?:A|An|The)\s+[a-z].*|[A-Z][a-z].*)$/;
    const cpuidWithDescription = cpuid_str.match(reCpuidWithDescription);
    if (cpuidWithDescription) {
      cpuid_str = cpuidWithDescription[1];
      description =
          JoinDescriptionLines([cpuidWithDescription[2].trim(), description]);
    }
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
    const validIn3264AndCpuid =
        SplitValidIn3264AndCpuid(valid_in_3264_str, cpuid_str);
    valid_in_3264_str = validIn3264AndCpuid.validIn3264;
    cpuid_str = validIn3264AndCpuid.cpuid;
    const validIn3264 = CanonicalizeValidIn3264(valid_in_3264_str);
    const opcode_parsed = CanonicalizeOpcode(opcode);
    return {
      opcode: opcode,
      opcode_parsed: opcode_parsed,
      opcode_bytes: makeOpBytes(opcode_parsed),
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

function makeOpBytes(op_parsed: string[]): SDMInstrOpByte[] {
  const opcode_bytes = [];
  const reOpByte = /^[0-9A-F]{2}$/;
  const reModRM =
      /^(\/([0-7]|r|vsib)|(!\(11\)|11):(rrr|[0-7]{3}):(bbb|[0-7]{3}))$/;
  for (let i = 0; i < op_parsed.length;) {
    if (op_parsed[i] === 'NP' || op_parsed[i] === 'NFx') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_size_min: 0,
        byte_size_max: 0,
      });
      continue;
    }
    if (op_parsed[i].startsWith('VEX')) {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'vex-prefix',
        byte_size_min: 2,
        byte_size_max: 3,
      });
      continue;
    }
    if (op_parsed[i].startsWith('EVEX')) {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'evex-prefix',
        byte_size_min: 4,
        byte_size_max: 4,
      });
      continue;
    }
    if (op_parsed[i].startsWith('REX')) {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'rex-prefix',
        byte_size_min: 1,
        byte_size_max: 1,
      });
      continue;
    }
    if (reOpByte.test(op_parsed[i])) {
      const c = {
        components: [op_parsed[i++]],
        byte_type: 'opcode',
        byte_size_min: 1,
        byte_size_max: 1,
      };
      opcode_bytes.push(c);
      continue;
    }
    if (op_parsed[i].startsWith('+')) {
      assert(opcode_bytes.length > 0);
      opcode_bytes[opcode_bytes.length - 1].components.push(op_parsed[i++]);
      continue;
    }
    if (/^\(?E?[A-D]X\s*=/.test(op_parsed[i])) {
      // A precondition of a register (see CanonicalizeOpcode). It occupies no
      // byte of the instruction, so make it a pseudo byte of its own instead
      // of appending it to the preceding opcode byte, which is shown in one
      // box in the UI and is too narrow for it.
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_size_min: 0,
        byte_size_max: 0,
      });
      continue;
    }
    if (op_parsed[i].startsWith('(mod')) {
      // A condition on the preceding ModRM byte. See CanonicalizeOpcode.
      assert(opcode_bytes.length > 0);
      opcode_bytes[opcode_bytes.length - 1].components.push(op_parsed[i++]);
      continue;
    }
    if (op_parsed[i] == '/is4') {
      // The register specifier in imm8[7:4]. See CanonicalizeOpcode.
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 1,
        byte_size_max: 1,
      });
      continue;
    }
    if (reModRM.test(op_parsed[i])) {
      const c = {
        components: [op_parsed[i++]],
        byte_type: 'modrm',
        byte_size_min: 1,
        byte_size_max: 1,
      };
      opcode_bytes.push(c);
      continue;
    }
    if (op_parsed[i] == 'ib' || op_parsed[i] == 'cb' ||
        op_parsed[i] == '/ib' || op_parsed[i] == 'imm8') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 1,
        byte_size_max: 1,
      });
      continue;
    }
    if (op_parsed[i] == 'iw' || op_parsed[i] == 'cw' ||
        op_parsed[i] == 'imm16') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 2,
        byte_size_max: 2,
      });
      continue;
    }
    if (op_parsed[i] == 'id' || op_parsed[i] == 'cd' ||
        op_parsed[i] == 'imm32') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 4,
        byte_size_max: 4,
      });
      continue;
    }
    if (op_parsed[i] == 'cp') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 6,
        byte_size_max: 6,
      });
      continue;
    }
    if (op_parsed[i] == 'io' || op_parsed[i] == 'imm64') {
      opcode_bytes.push({
        components: [op_parsed[i++]],
        byte_type: 'imm',
        byte_size_min: 8,
        byte_size_max: 8,
      });
      continue;
    }
    throw new Error(`Unexpected component: ${op_parsed[i]}`);
  }
  return opcode_bytes;
}

function TestMakeOpBytes() {
  assert.deepEqual(makeOpBytes(['00']), [{
                     components: ['00'],
                     byte_type: 'opcode',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
  assert.deepEqual(makeOpBytes(['ib']), [{
                     components: ['ib'],
                     byte_type: 'imm',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
  assert.deepEqual(makeOpBytes(['iw']), [{
                     components: ['iw'],
                     byte_type: 'imm',
                     byte_size_min: 2,
                     byte_size_max: 2,
                   }]);
  assert.deepEqual(makeOpBytes(['id']), [{
                     components: ['id'],
                     byte_type: 'imm',
                     byte_size_min: 4,
                     byte_size_max: 4,
                   }]);
  assert.deepEqual(makeOpBytes(['io']), [{
                     components: ['io'],
                     byte_type: 'imm',
                     byte_size_min: 8,
                     byte_size_max: 8,
                   }]);
  assert.deepEqual(makeOpBytes(['00', '+rd']), [{
                     components: ['00', '+rd'],
                     byte_type: 'opcode',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
}

function JoinDescriptionLines(lines: string[]): string {
  // Join the lines of a description, connecting the words which are hyphenated
  // at the end of a line (e.g. 'mem-' + 'ory' -> 'memory'). A hyphen in the
  // middle of a line is a part of the text and is kept as it is.
  // Required by: VFPCLASSPS in 325383-092US (June 2026), whose description
  // contains '+Infinity, -Infinity'; joining the whole text at once used to
  // turn it into '+Infinity,-Infinity'.
  let joined = '';
  for (const line of lines) {
    if (!line.length) {
      continue;
    }
    if (!joined.length) {
      joined = line;
      continue;
    }
    if (joined.endsWith('-')) {
      // The hyphen is removed only when it hyphenates one word into two lines.
      // A hyphen which follows or precedes a non-letter is a part of the text,
      // like the minus sign of '-0' and the hyphen of '64-byte'.
      const isWordHyphenation = /[a-z]-$/.test(joined) && /^[a-z]/.test(line);
      joined = isWordHyphenation ? joined.substr(0, joined.length - 1) + line :
                                   joined + line;
      continue;
    }
    joined += ` ${line}`;
  }
  return joined;
}
function CanonicalizeDescription(descText: SDMText[]): string {
  const lines = MakeRows(descText).map(
      r => r.map(t => GetText(t).trim()).filter(t => t.length).join(' ').trim());
  return JoinDescriptionLines(lines);
}
function TestCanonicalizeDescription() {
  assert.deepEqual(
      // Check parsing splitted description in the sameline
      // https://github.com/hikalium/opv86/issues/2
      CanonicalizeDescription([
        {'text': 'Near', 'attr': {'top': 160, 'left': 567}},
        {
          'text': 'return to calling procedure.',
          'attr': {'top': 160, 'left': 598}
        },
      ]),
      'Near return to calling procedure.');
  assert.deepEqual(
      // Check parsing splitted description in the sameline
      // https://github.com/hikalium/opv86/issues/2
      CanonicalizeDescription([
        {'text': ' Near ', 'attr': {'top': 160, 'left': 567}},
        {
          'text': ' return to calling procedure. ',
          'attr': {'top': 160, 'left': 598}
        },
      ]),
      'Near return to calling procedure.');
  assert.deepEqual(
      CanonicalizeDescription([
        {
          'text': 'Hint to hardware to move the cache line containing m8 to a',
          'attr': {'top': 184, 'left': 478}
        },
        {
          'text':
              'more distant level of the cache without writing back to mem-',
          'attr': {'top': 200, 'left': 478}
        },
        {'text': 'ory.', 'attr': {'top': 217, 'left': 478}},
      ]),
      'Hint to hardware to move the cache line containing m8 to a' +
          ' more distant level of the cache without writing back to memory.');
  assert.deepEqual(
      // A hyphen in the middle of a line is not a hyphenation of a word.
      // VFPCLASSPS in 325383-092US (June 2026).
      CanonicalizeDescription([
        {
          'text': 'Tests the input for the following categories: NaN, +0, -0,',
          'attr': {'top': 175, 'left': 519}
        },
        {
          'text': '+Infinity, -Infinity, denormal, finite negative.',
          'attr': {'top': 191, 'left': 519}
        },
      ]),
      'Tests the input for the following categories: NaN, +0, -0,' +
          ' +Infinity, -Infinity, denormal, finite negative.');
  assert.deepEqual(
      // MOVDIR64B in 325383-092US (June 2026): a hyphen after a digit is a
      // part of the text.
      JoinDescriptionLines(['with guaranteed 64-', 'byte write atomicity']),
      'with guaranteed 64-byte write atomicity');
  assert.deepEqual(
      // VFPCLASSPS in 325383-092US (June 2026): the line break inside '-0'.
      JoinDescriptionLines(['categories: NaN, +0, -', '0, +Infinity']),
      'categories: NaN, +0, -0, +Infinity');
  assert.deepEqual(
      // CLDEMOTE in 325383-092US (June 2026): a word hyphenated at the end of
      // a line is joined into one word.
      JoinDescriptionLines(['without writing back to mem-', 'ory.']),
      'without writing back to memory.');
}

const parserMap = {
  'opcode#instruction#mode#64-bit#compat/#legmode#description': (
      headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
    // FCOMI hack
    return parserMap['opcode#instruction#64-bit#mode#compat/#legmode#description'](
        headers, tokens);
  },
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
          const description = CanonicalizeDescription(tr[4]);
          console.log({
            opcode: opcode,
            opcode_parsed: CanonicalizeOpcode(opcode),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            description: description,
          });
          const valid_in_compat_leg =
              CanonicalizeCompatLeg(valid_in_compat_leg_str);
          const opcode_parsed = CanonicalizeOpcode(opcode);
          return {
            opcode: opcode,
            opcode_parsed: opcode_parsed,
            opcode_bytes: makeOpBytes(opcode_parsed),
            instr: instr,
            instr_parsed: CanonicalizeInstr(instr),
            valid_in_64bit_mode: CanonicalizeValidIn64(valid_in_64_str),
            valid_in_compatibility_mode: valid_in_compat_leg,
            valid_in_legacy_mode: valid_in_compat_leg,
            description: description,
          };
        });
      },
  'opcode/#instruction#op/#en#64/32#bitmode#support#cpuidfeature#flag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // MOVSD
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
  'opcode/#instruction#op/#en#64/32bit#mode#support#cpuid#feature#flag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // LFENCE
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn3264Left = headers[4].attr.left;
        const cpuidFeatureLeft = headers[7].attr.left;
        const descriptionLeft = headers[10].attr.left;
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
  'opcode/#instruction#op/#en#64/32bit#mode#support#cpuidfeature#flag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // PADDB. Same layout as CLWB, but 'CPUID Feature' and 'Flag' are
        // splitted in a different way.
        return parserMap
            ['opcode/#instruction#op/#en#64/32bit#mode#support#cpuid#featureflag#description'](
                headers, tokens);
      },
  'opcode/#instruction#op/en#64/32bit#mode#support#cpuid#featureflag#description':
      (headers: SDMText[], tokens: SDMText[]): SDMInstr[] => {
        // MOVSD (SSE2)
        console.error(headers.filter(e => e !== undefined)
                          .map(e => `${GetText(e)}@${e.attr.left}`)
                          .join(', '));
        const opcodeLeft = headers[0].attr.left;
        const opEnLeft = headers[2].attr.left;
        const validIn3264Left = headers[3].attr.left;
        const cpuidFeatureLeft = headers[6].attr.left;
        const descriptionLeft = headers[8].attr.left;
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
          // The header says that the opcode and the instruction are in the
          // same column, but they can be laid out in two columns and end up in
          // the same row here.
          // Required by: CRC32 in 325383-092US (June 2026).
          const opcodeAndInstr = MoveMnemonicFromOpcode(
              opRow.map(t => GetText(t).trim()).join(' '),
              InstrRows.flat().map(t => GetText(t).trim()).join(' '));
          const opcode = opcodeAndInstr.opcode;
          console.log(opcode);
          const instr = opcodeAndInstr.instr;
          console.log(instr);
          const cellFirstText = (c: SDMText[]) =>
              (c && c.length) ? GetText(c[0]) : '';
          const opEnAndValidIn64 = SplitOpEnAndValidIn64(
              cellFirstText(tr[1]), cellFirstText(tr[2]));
          const op_en = opEnAndValidIn64.opEn;
          let valid_in_64_str;
          let compat_leg_str;
          if (opEnAndValidIn64.validIn64 === 'Valid N.E.') {
            // hack for 'MOV', 'r/m64, imm32'
            valid_in_64_str = 'Valid';
            compat_leg_str = 'N.E.';
          } else {
            valid_in_64_str = opEnAndValidIn64.validIn64;
            compat_leg_str = cellFirstText(tr[3]);
          }
          const description = CanonicalizeDescription(tr[4] || []);
          const opcode_parsed = CanonicalizeOpcode(opcode);
          console.log({
            opcode: opcode,
            opcode_parsed: opcode_parsed,
            opcode_bytes: makeOpBytes(opcode_parsed),
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
            opcode_parsed: opcode_parsed,
            opcode_bytes: makeOpBytes(opcode_parsed),
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
            const e = s.peek();
            const es = GetText(e);
            if (opcode.length != 0 && reMnemonic.test(es)) {
              break;
            }
            s.next();
            opcode.push(es.trim());
          }
          let opcodeStr = opcode.join(' ');
          console.log(opcodeStr);
          let instr = [];
          while (s.peek().attr.left < opEnLeft - 50) {
            instr.push(GetText(s.next()).trim());
          }
          {
            // The opcode and the instruction can be extracted as one token.
            // Required by: LAHF ('9F LAHF') in 325383-092US (June 2026).
            const opcodeAndInstr =
                MoveMnemonicFromOpcode(opcodeStr, instr.join(' '));
            opcodeStr = opcodeAndInstr.opcode;
            instr = opcodeAndInstr.instr.length ? [opcodeAndInstr.instr] : [];
          }

          console.log(instr);
          let op_en = GetNonEmptyText(s);
          let valid_in_64_str;
          let compat_leg_str;
          const opEnAndValidIn64 = SplitOpEnAndValidIn64(op_en, '');
          if (opEnAndValidIn64.validIn64 !== '') {
            op_en = opEnAndValidIn64.opEn;
            valid_in_64_str = opEnAndValidIn64.validIn64;
            compat_leg_str = s.next().text;
          } else {
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
          }
          const descriptionComponents = [];
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
              k++;
            }
            descriptionComponents.push(s.next());
          }
          const description = CanonicalizeDescription(descriptionComponents);
          console.log({
            opcode: opcodeStr,
            instr: instr,
            op_en: op_en,
            valid_in_64bit_mode: valid_in_64_str,
            valid_in_compatibility_mode: compat_leg_str,
            valid_in_legacy_mode: compat_leg_str,
            description: description,
          })
          const opcode_parsed = CanonicalizeOpcode(opcodeStr);
          instrList.push({
            opcode: opcodeStr,
            opcode_parsed: opcode_parsed,
            opcode_bytes: makeOpBytes(opcode_parsed),
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

interface InstrTableColumn {
  title: string;
  left: number;
}

function MakeHeaderColumns(headers: SDMText[]): InstrTableColumn[] {
  // Concatenate the header texts stacked in the same column (e.g.
  // 'CPUID Feature' and 'Flag') to get the title of each column.
  // headers should be sorted by (left, top).
  const columns: InstrTableColumn[] = [];
  for (const h of headers) {
    const text = GetText(h).replace(/\*/g, '').trim();
    const last = columns.length ? columns[columns.length - 1] : undefined;
    if (last && h.attr.left - last.left <= 10) {
      last.title += text;
      continue;
    }
    columns.push({title: text, left: h.attr.left});
  }
  for (const c of columns) {
    c.title = c.title.replace(/\s/g, '').toLowerCase();
  }
  // '/' of 'Opcode/Instruction' can be far enough from 'Opcode' to be treated
  // as another column. Merge it into the column on its left.
  // Required by: RDMSR in 325383-092US (June 2026).
  for (let i = columns.length - 1; i > 0; i--) {
    if (columns[i].title !== '/') {
      continue;
    }
    columns[i - 1].title += columns[i].title;
    columns.splice(i, 1);
  }
  return columns;
}

function ParseInstrTableCells(
    table: SDMText[][][], role: {[name: string]: number}): SDMInstr[] {
  // Build the instructions from the table, using role[] to find the column of
  // each role. A role which is not in role[] is not in the table.
  // See the comment in Parser_OpInstr_OpEn_6432_CPUID_Desc.
  return table.filter(tr => tr[role['opcode']] && tr[role['opcode']].length)
      .map(tr => {
    const cell = (name: string) =>
        (role[name] === undefined) ? [] : (tr[role[name]] || []);
    const cellText = (name: string) =>
        cell(name).map(t => GetText(t).trim()).join(' ').trim();
    const cellFirstText = (name: string) =>
        cell(name).length ? GetText(cell(name)[0]) : '';
    let opcode: string;
    let instr: string;
    if (role['instr'] !== undefined) {
      // The instruction can be in the opcode cell even if the table has a
      // separate column for it.
      // Required by: GETSEC[SMCTRL] in 325383-092US (June 2026), whose row is
      // 'NP 0F 37 (EAX = 7) GETSEC[SMCTRL]' in the opcode column.
      const opcodeAndInstr =
          MoveMnemonicFromOpcode(cellText('opcode'), cellText('instr'));
      opcode = opcodeAndInstr.opcode;
      instr = opcodeAndInstr.instr;
    } else if (!cell('opcode').length) {
      opcode = '';
      instr = '';
    } else {
      // The opcode and the instruction are stacked in the same column.
      const rows = MakeRows(cell('opcode'));
      opcode = rows[0].map(t => GetText(t).trim()).join(' ');
      instr = rows.splice(1).flat().map(t => GetText(t).trim()).join(' ');
    }
    let description = CanonicalizeDescription(cell('description'));
    // The instruction and the beginning of the description can be extracted as
    // one token when the instruction column is narrow.
    // Required by: the GETSEC leaves in 325383-092US (June 2026), whose
    // instruction cell is like
    // 'GETSEC[CAPABILITIES] Report the SMX capabilities.'.
    const reInstrWithDescription = /^(GETSEC\[\w+\])\s+(\S.*)$/;
    const instrWithDescription = instr.match(reInstrWithDescription);
    if (instrWithDescription) {
      instr = instrWithDescription[1];
      description = `${instrWithDescription[2]} ${description}`.trim();
    }
    const opcode_parsed = CanonicalizeOpcode(opcode);
    const e: SDMInstr = {
      opcode: opcode,
      opcode_parsed: opcode_parsed,
      opcode_bytes: makeOpBytes(opcode_parsed),
      instr: instr,
      instr_parsed: CanonicalizeInstr(instr),
      description: description,
    };
    if (role['op_en'] !== undefined) {
      e.op_en = cellText('op_en');
    }
    if (role['cpuid'] !== undefined) {
      e.cpuid_feature_flag = cellText('cpuid');
    }
    if (role['valid3264'] !== undefined) {
      const opEnAndValidIn3264 = SplitOpEnAndValidIn3264(
          cellText('op_en'), cellFirstText('valid3264'));
      if (role['op_en'] !== undefined) {
        e.op_en = opEnAndValidIn3264.opEn;
      }
      const validIn3264 =
          CanonicalizeValidIn3264(opEnAndValidIn3264.validIn3264);
      e.valid_in_64bit_mode = validIn3264.valid64;
      e.valid_in_compatibility_mode = validIn3264.valid32;
      e.valid_in_legacy_mode = false;
    } else if (role['valid64'] !== undefined) {
      e.valid_in_64bit_mode = CanonicalizeValidIn64(cellFirstText('valid64'));
      const compatLeg = CanonicalizeCompatLeg(cellFirstText('compatleg'));
      e.valid_in_compatibility_mode = compatLeg;
      e.valid_in_legacy_mode = compatLeg;
    }
    console.log(e);
    return e;
  });
}

function ParseInstrTableByColumns(
    headers: SDMText[], tokens: SDMText[]): SDMInstr[] {
  // Parse an instruction table by looking at the title of each column, instead
  // of having a dedicated parser for every variation of the header layout.
  const columns = MakeHeaderColumns(headers);
  console.error(columns);
  const findColumn = (re: RegExp) => columns.find(c => re.test(c.title));
  const found: {[name: string]: InstrTableColumn} = {
    opcode: findColumn(/^opcode/),
    instr: findColumn(/^instruction$/),
    // 'Op/En' can be merged with the column on its right, either the mode
    // column (volume 2) or the description column (the VMX reference of
    // volume 3).
    op_en: findColumn(/^op(\/?en)?$|^op\/?en(64\/32|description)/),
    valid3264: findColumn(/^64\/32/),
    valid64: findColumn(/^64-?bit(mode)?$/),
    compatleg: findColumn(/^compat/),
    cpuid: findColumn(/^cpuid/),
    description: findColumn(/^description$/),
  };
  if (!found.valid3264 && found.op_en &&
      /^op\/?en64\/32/.test(found.op_en.title)) {
    // 'Op / En' and '64/32 bit' can be in the same token. In that case, the
    // rest of the title of the mode column ('Mode Support') is in the next
    // column, which is the column we are looking for.
    const next = columns[columns.indexOf(found.op_en) + 1];
    if (next && /^(bit)?mode/.test(next.title)) {
      found.valid3264 = next;
    }
  }
  if (!found.description && found.op_en &&
      /^op\/?endescription$/.test(found.op_en.title)) {
    // 'Op/En' and 'Description' are extracted as one token, so the header
    // gives no position for the description column. Take it from the body: it
    // is the leftmost token which is clearly on the right of the Op/En column.
    // Required by: INVEPT and the other VMX instructions in 325384-092US
    // (June 2026), whose table has the Opcode/Instruction, Op/En and
    // Description columns only.
    const lefts =
        tokens.map(t => t.attr.left).filter(l => l > found.op_en.left + 20);
    if (lefts.length) {
      found.description = {title: 'description', left: Math.min(...lefts)};
    }
  }
  if (!found.compatleg) {
    // '64-Bit Mode' and 'Compat/' can be in the same token as well.
    // Required by: FSTP in 325383-092US (June 2026), whose header is
    // 'Opcode#Instruction#64-Bit Mode Compat/#Leg Mode#Description'.
    const i = columns.findIndex(c => /^64-?bit.*compat/.test(c.title));
    if (i >= 0 && columns[i + 1] && /^leg/.test(columns[i + 1].title)) {
      found.valid64 = columns[i];
      found.compatleg = columns[i + 1];
    }
  }
  for (const role of Object.keys(found)) {
    if (!found[role]) {
      delete found[role];
    }
  }
  if (!found.compatleg && found.valid64) {
    // 'Compat/Leg Mode' is required to interpret the '64-Bit Mode' column.
    delete found.valid64;
  }
  if (!found.opcode || !found.description) {
    // Some tables have neither of the mode columns, and in that case the modes
    // are left unknown.
    // Required by: the GETSEC leaves in 325383-092US (June 2026), whose table
    // has the Opcode, Instruction and Description columns only.
    throw new Error(`Parser not implemented for the columns: ${
        columns.map(c => c.title).join('#')}`);
  }
  if (!found.instr && !/instruction/.test(found.opcode.title)) {
    throw new Error(`Opcode and Instruction should be in the same column: ${
        found.opcode.title}`);
  }
  // Sort the columns by their position to make the list for MakeTable, and
  // remember which column each role is in.
  const used = Object.keys(found).map(role => ({role: role, col: found[role]}));
  used.sort((lhs, rhs) => lhs.col.left - rhs.col.left);
  const role = {};
  used.forEach((e, i) => role[e.role] = i);
  // Use the column which has exactly one value for each row as the key.
  // A column which has no token cannot be the key of the rows.
  // Required by: GETSEC[SMCTRL] in 325383-092US (June 2026), whose Instruction
  // column is empty because the instruction is in the opcode cell.
  const lefts = used.map(e => e.col.left);
  const cols = MakeCols(tokens, lefts);
  let keyColIndex = undefined;
  for (const name of ['op_en', 'valid3264', 'valid64', 'instr', 'opcode']) {
    if (keyColIndex !== undefined || role[name] === undefined) {
      continue;
    }
    if (!cols[role[name]].length) {
      continue;
    }
    keyColIndex = role[name];
  }
  const table = MakeTable(tokens, lefts, keyColIndex);
  if (role['instr'] === undefined && role['op_en'] !== undefined &&
      role['valid3264'] !== undefined && role['cpuid'] !== undefined &&
      role['description'] !== undefined && Object.keys(role).length === 5) {
    // Keep using the existing parser for the most common layout.
    return Parser_OpInstr_OpEn_6432_CPUID_Desc(table);
  }
  return ParseInstrTableCells(table, role);
}

function TestParser() {
  let parser;
  parser =
      parserMap['opcode#instruction#op/#en#64-bit#mode#compat/#legmode#description'];
  assert(parser);
  assert.deepEqual(
      // Check parsing splitted description in the sameline
      // https://github.com/hikalium/opv86/issues/2
      parser(
          [
            {'text': 'Opcode*', 'attr': {'top': 123, 'left': 76}},
            {'text': 'Instruction', 'attr': {'top': 123, 'left': 222}},
            {'text': 'Op/', 'attr': {'top': 123, 'left': 388}},
            {'text': 'En', 'attr': {'top': 137, 'left': 388}},
            {'text': '64-Bit', 'attr': {'top': 123, 'left': 425}},
            {'text': 'Mode', 'attr': {'top': 137, 'left': 425}},
            {'text': 'Compat/', 'attr': {'top': 123, 'left': 497}},
            {'text': 'Leg Mode', 'attr': {'top': 137, 'left': 497}},
            {'text': 'Description', 'attr': {'top': 123, 'left': 567}}
          ],
          [
            {'text': 'C3', 'attr': {'top': 160, 'left': 76}},
            {'text': 'RET', 'attr': {'top': 160, 'left': 222}},
            {'text': 'ZO', 'attr': {'top': 160, 'left': 388}},
            {'text': 'Valid Valid', 'attr': {'top': 160, 'left': 425}},
            {'text': 'Near', 'attr': {'top': 160, 'left': 567}},
            {
              'text': 'return to calling procedure.',
              'attr': {'top': 160, 'left': 598}
            },
          ]),
      [{
        opcode: 'C3',
        opcode_parsed: [
          'C3',
        ],
        opcode_bytes: [
          {
            components: ['C3'],
            byte_type: 'opcode',
            byte_size_min: 1,
            byte_size_max: 1,
          },
        ],
        instr: 'RET',
        instr_parsed: [
          'RET',
        ],
        op_en: 'ZO',
        valid_in_64bit_mode: true,
        valid_in_compatibility_mode: true,
        valid_in_legacy_mode: true,
        description: 'Near return to calling procedure.'
      }]);
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
        opcode_bytes: [{
          components: ['37'],
          byte_type: 'opcode',
          byte_size_min: 1,
          byte_size_max: 1,
        }],
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
        opcode_bytes: [
          {
            components: ['0F'],
            byte_type: 'opcode',
            byte_size_min: 1,
            byte_size_max: 1,
          },
          {
            components: ['05'],
            byte_type: 'opcode',
            byte_size_min: 1,
            byte_size_max: 1,
          },
        ],
        instr: 'SYSCALL',
        instr_parsed: [
          'SYSCALL',
        ],
        op_en: 'ZO',
        valid_in_64bit_mode: true,
        valid_in_compatibility_mode: false,
        valid_in_legacy_mode: false,
        description: 'Fast call to privilege level 0 system procedures.'
      }]);
}

function TestCanonicalizeOpcodeOfRecentSDM() {
  // Every case here is an opcode as it is written in 325383-092US (June 2026).
  // ENCODEKEY128: the ModRM byte written as a bit pattern.
  assert.deepEqual(
      CanonicalizeOpcode('F3 0F 38 FA 11:rrr:bbb'),
      ['F3', '0F', '38', 'FA', '11:rrr:bbb']);
  // AESDECWIDE256KL: the memory form of the bit pattern.
  assert.deepEqual(
      CanonicalizeOpcode('F3 0F 38 D8 !(11):011:bbb'),
      ['F3', '0F', '38', 'D8', '!(11):011:bbb']);
  // VGATHERPF0DPS: two ModRM components in one opcode.
  assert.deepEqual(
      CanonicalizeOpcode('EVEX.512.66.0F38.W0 C6 /1 /vsib'),
      ['EVEX.512.66.0F38.W0', 'C6', '/1', '/vsib']);
  // VBLENDVPD: the register specifier in imm8[7:4].
  assert.deepEqual(
      CanonicalizeOpcode('VEX.128.66.0F3A.W0 4B /r /is4'),
      ['VEX.128.66.0F3A.W0', '4B', '/r', '/is4']);
  // ENDBR64 and RSTORSSP: a condition on the ModRM byte.
  assert.deepEqual(
      CanonicalizeOpcode('F3 0F 1E /1 (mod=11)'),
      ['F3', '0F', '1E', '/1', '(mod=11)']);
  assert.deepEqual(
      CanonicalizeOpcode('F3 0F 01 /5 (mod!=11, /5, memory only)'),
      ['F3', '0F', '01', '/5', '(mod!=11, /5, memory only)']);
  // GETSEC[CAPABILITIES]: a precondition of a register.
  assert.deepEqual(
      CanonicalizeOpcode('NP 0F 37 (EAX = 0)'), ['NP', '0F', '37', '(EAX = 0)']);
  // ADCX: the REX prefix after a mandatory prefix, with a lowercase '.w'.
  assert.deepEqual(
      CanonicalizeOpcode('66 REX.w 0F 38 F6 /r'),
      ['66', 'REX.w', '0F', '38', 'F6', '/r']);
  // PMOVSXBW: the opcode bytes in lowercase.
  assert.deepEqual(
      CanonicalizeOpcode('66 0f 38 20 /r'), ['66', '0F', '38', '20', '/r']);
  // PCMPISTRI: the immediate spelled out as 'imm8'.
  assert.deepEqual(
      CanonicalizeOpcode('66 0F 3A 63 /r imm8'),
      ['66', '0F', '3A', '63', '/r', 'imm8']);
  // PAVGB: a comma put after an opcode byte by mistake.
  assert.deepEqual(
      CanonicalizeOpcode('66 0F E0, /r'), ['66', '0F', 'E0', '/r']);
  // VPADDSB: the VEX prefix splitted into two tokens.
  assert.deepEqual(
      CanonicalizeOpcode('VEX.256.66.0F .WIG EC /r'),
      ['VEX.256.66.0F.WIG', 'EC', '/r']);
  // VPMOVZXBW: a component of the VEX prefix splitted into two tokens.
  assert.deepEqual(
      CanonicalizeOpcode('VEX.128.66.0F 38.WIG 30 /r'),
      ['VEX.128.66.0F38.WIG', '30', '/r']);
  // URDMSR: ':' used as a separator of the VEX prefix.
  assert.deepEqual(
      CanonicalizeOpcode('VEX.128.F2.MAP7:W0.F8 11:000:bbb'),
      ['VEX.128.F2.MAP7:W0.F8', '11:000:bbb']);
  // VMOVD: the 'r' of '/r' missing in the text layer of the PDF.
  assert.deepEqual(
      CanonicalizeOpcode('VEX.128.66.0F.W0 6E /'),
      ['VEX.128.66.0F.W0', '6E', '/r']);
}

function TestCanonicalizeInstrOfRecentSDM() {
  // Every case here is an instruction as it is written in 325383-092US.
  // VANDPD: a SIMD operand with a writemask, a memory form and a broadcast.
  assert.deepEqual(
      CanonicalizeInstr('VANDPD zmm1 {k1}{z}, zmm2, zmm3/m512/m64bcst'),
      ['VANDPD', 'zmm1 {k1}{z}', 'zmm2', 'zmm3/m512/m64bcst']);
  // VP2INTERSECTD: a pair of the opmask registers.
  assert.deepEqual(
      CanonicalizeInstr('VP2INTERSECTD k1+1, xmm2, xmm3/m128/m32bcst'),
      ['VP2INTERSECTD', 'k1+1', 'xmm2', 'xmm3/m128/m32bcst']);
  // ENCODEKEY256: the implicit operands without a separator.
  assert.deepEqual(
      CanonicalizeInstr('ENCODEKEY256 r32, r32 <XMM0-6>'),
      ['ENCODEKEY256', 'r32', 'r32 <XMM0-6>']);
  // GETSEC: the leaf function name in the brackets.
  assert.deepEqual(
      CanonicalizeInstr('GETSEC[CAPABILITIES]'), ['GETSEC[CAPABILITIES]']);
  // VGATHERPF0DPS: a vsib operand with a writemask.
  assert.deepEqual(
      CanonicalizeInstr('VGATHERPF0DPS vm32z {k1}'),
      ['VGATHERPF0DPS', 'vm32z {k1}']);
  // TILELOADD: the AMX operands.
  assert.deepEqual(
      CanonicalizeInstr('TILELOADD tmm1, sibmem'), ['TILELOADD', 'tmm1', 'sibmem']);
  // ADD: the space left where a footnote marker was removed.
  assert.deepEqual(
      CanonicalizeInstr('ADD r/m8 , imm8'), ['ADD', 'r/m8', 'imm8']);
}

function TestCanonicalizeModes() {
  // The values of the mode columns in 325383-092US.
  assert.deepEqual(
      CanonicalizeValidIn3264('V/V'), {valid32: true, valid64: true});
  // CMOVcc etc.: valid in 64 bit mode only.
  assert.deepEqual(
      CanonicalizeValidIn3264('V/N.E.'), {valid32: false, valid64: true});
  assert.deepEqual(
      CanonicalizeValidIn3264('V/I'), {valid32: false, valid64: true});
  assert.deepEqual(
      CanonicalizeValidIn3264('N.E./V'), {valid32: true, valid64: false});
  // The '/' can be lost by the text extraction.
  assert.deepEqual(
      CanonicalizeValidIn3264('VV'), {valid32: true, valid64: true});
  // VPMADD52LUQ: the CPUID feature flag merged into this column.
  assert.deepEqual(
      CanonicalizeValidIn3264('V/V (AVX512_IFMA'),
      {valid32: true, valid64: true});
  // RDMSR: the value of the 64-Bit Mode column used in this column.
  assert.deepEqual(
      CanonicalizeValidIn3264('Valid'), {valid32: true, valid64: true});
  // ARPL: extra spaces in the value.
  assert.equal(CanonicalizeValidIn64('N. E.'), false);
  assert.equal(CanonicalizeValidIn64('Valid'), true);
  assert.equal(CanonicalizeValidIn64('Invalid'), false);
  // SYSCALL: 'Invalid' means that it is NOT valid in the compatibility mode.
  assert.equal(CanonicalizeCompatLeg('Invalid'), false);
  assert.equal(CanonicalizeCompatLeg('Valid'), true);
  // CMOVcc
  assert.equal(CanonicalizeCompatLeg('N/A'), false);
}

function TestMakeOpBytesOfRecentSDM() {
  // ENCODEKEY128: the ModRM byte written as a bit pattern.
  assert.deepEqual(makeOpBytes(['11:rrr:bbb']), [{
                     components: ['11:rrr:bbb'],
                     byte_type: 'modrm',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
  // VBLENDVPD: '/is4' is an immediate byte.
  assert.deepEqual(makeOpBytes(['/is4']), [{
                     components: ['/is4'],
                     byte_type: 'imm',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
  // ENDBR64: the condition is attached to the ModRM byte.
  assert.deepEqual(makeOpBytes(['/1', '(mod=11)']), [{
                     components: ['/1', '(mod=11)'],
                     byte_type: 'modrm',
                     byte_size_min: 1,
                     byte_size_max: 1,
                   }]);
  // GETSEC[CAPABILITIES]: the precondition is a pseudo byte of its own, so
  // that it is not squeezed into the box of the opcode byte in the UI.
  assert.deepEqual(makeOpBytes(['37', '(EAX = 0)']), [
    {
      components: ['37'],
      byte_type: 'opcode',
      byte_size_min: 1,
      byte_size_max: 1,
    },
    {
      components: ['(EAX = 0)'],
      byte_size_min: 0,
      byte_size_max: 0,
    },
  ]);
}

function TestJoinWrappedText() {
  // ANDPD: the CPUID Feature Flag cell wrapped into three lines.
  assert.equal(
      JoinWrappedText(['(AVX512VL AND', 'AVX512DQ) OR', 'AVX10.1']),
      '(AVX512VL AND AVX512DQ) OR AVX10.1');
  // VCVTNEEPH2PS: a word wrapped after '_'.
  assert.equal(JoinWrappedText(['AVX_NE_', 'CONVERT']), 'AVX_NE_CONVERT');
  assert.equal(JoinWrappedText(['AVX512F', '', 'OR AVX10.1']), 'AVX512F OR AVX10.1');
  // ENCLU[EVERIFYREPORT2]: a flag hyphenated into three lines.
  assert.equal(
      JoinWrappedText(['EVERI-', 'FYRE-', 'PORT2']), 'EVERIFYREPORT2');
}

function TestSplitMergedCells() {
  // VPMADD52LUQ: the mode column merged with the first line of the CPUID one.
  assert.deepEqual(
      SplitValidIn3264AndCpuid('V/V (AVX512_IFMA', 'AND AVX512VL) OR AVX10.1'),
      {validIn3264: 'V/V', cpuid: '(AVX512_IFMA AND AVX512VL) OR AVX10.1'});
  assert.deepEqual(
      SplitValidIn3264AndCpuid('V/V', 'AVX512F OR AVX10.1'),
      {validIn3264: 'V/V', cpuid: 'AVX512F OR AVX10.1'});
  // PSHUFW and IMUL: the Op/En column merged with the 64-Bit Mode one.
  assert.deepEqual(
      SplitOpEnAndValidIn64('RMI Valid', ''), {opEn: 'RMI', validIn64: 'Valid'});
  assert.deepEqual(
      SplitOpEnAndValidIn64('ZO', 'Valid'), {opEn: 'ZO', validIn64: 'Valid'});
  // ADDSUBPD: the Op/En column merged with the 64/32 bit Mode Support one.
  assert.deepEqual(
      SplitOpEnAndValidIn3264('RVM V/V', ''),
      {opEn: 'RVM', validIn3264: 'V/V'});
  assert.deepEqual(
      SplitOpEnAndValidIn3264('A', 'V/V'), {opEn: 'A', validIn3264: 'V/V'});
  // LAHF and CRC32: the instruction extracted as a part of the opcode.
  assert.deepEqual(
      MoveMnemonicFromOpcode('9F LAHF', ''), {opcode: '9F', instr: 'LAHF'});
  assert.deepEqual(
      MoveMnemonicFromOpcode('F2 0F 38 F0 /r CRC32 r32, r/m8', ''),
      {opcode: 'F2 0F 38 F0 /r', instr: 'CRC32 r32, r/m8'});
  // GETSEC[SMCTRL]: the opcode and the instruction in one cell.
  assert.deepEqual(
      MoveMnemonicFromOpcode('NP 0F 37 (EAX = 7) GETSEC[SMCTRL]', ''),
      {opcode: 'NP 0F 37 (EAX = 7)', instr: 'GETSEC[SMCTRL]'});
  // An opcode byte like 'D8' should not be taken as a mnemonic.
  assert.deepEqual(
      MoveMnemonicFromOpcode('F3 0F 38 D8 !(11):011:bbb', 'AESDECWIDE256KL m512'),
      {opcode: 'F3 0F 38 D8 !(11):011:bbb', instr: 'AESDECWIDE256KL m512'});
}

function TestIsEndOfInstrTable() {
  // The section header of the next instruction ends the table.
  assert.equal(
      IsEndOfInstrTable(
          {text: 'ENCODEKEY256—Encode 256-Bit Key With Key Locker',
           attr: {top: 98, left: 69}}),
      true);
  assert.equal(
      IsEndOfInstrTable(
          {text: 'Instruction Operand Encoding', attr: {top: 264, left: 350}}),
      true);
  // ENCODEKEY256: an em dash inside a description does not end the table.
  assert.equal(
      IsEndOfInstrTable(
          {text: 'handle and store it in XMM0—3.', attr: {top: 191, left: 527}}),
      false);
}

function TestRemoveFootnoteMarkers() {
  // The row of 'ADD r/m8, imm8' in 325383-092US, where the footnote marker is
  // a superscript '1' between 'ADD r/m8' and ', imm8'.
  const row = [
    {text: '1', attr: {top: 247, left: 278, height: 14}},
    {text: '80 /0 ib', attr: {top: 250, left: 74, height: 17}},
    {text: 'ADD r/m8', attr: {top: 250, left: 221, height: 17}},
    {text: ', imm8', attr: {top: 250, left: 284, height: 17}},
    {text: 'MI', attr: {top: 250, left: 389, height: 17}},
  ];
  assert.deepEqual(
      RemoveFootnoteMarkers(row).map(t => GetText(t)),
      ['80 /0 ib', 'ADD r/m8', ', imm8', 'MI']);
  // A '1' of the same size as the row is an operand, not a marker.
  const shiftRow = [
    {text: 'D0 /4', attr: {top: 250, left: 74, height: 17}},
    {text: 'SAL r/m8, 1', attr: {top: 250, left: 221, height: 17}},
  ];
  assert.deepEqual(RemoveFootnoteMarkers(shiftRow).length, 2);
}

function TestJoinTokensInRow() {
  // The opcode row of 'PINSRW mm, r32/m16, imm8' in 325383-092US, where '/r'
  // is rendered as '/' and an italic 'r'.
  const row = [
    {text: 'NP 0F C4 /', attr: {top: 175, left: 74, height: 17}},
    {i: 'r', attr: {top: 175, left: 135, height: 17}},
    {text: 'ib', attr: {top: 175, left: 139, height: 17}},
  ];
  assert.equal(JoinTokensInRow(row), 'NP 0F C4 /r ib');
  // The opcode row of 'VPADDUSB ymm1, ymm2, ymm3/m256' in 325383-092US, where
  // '.WIG' is rendered in a smaller font as a separate token.
  const vexRow = [
    {text: 'VEX.256.66.0F', attr: {top: 436, left: 74, height: 17}},
    {text: '.WIG', attr: {top: 438, left: 160, height: 15}},
    {text: 'DC /r', attr: {top: 436, left: 182, height: 17}},
  ];
  assert.equal(JoinTokensInRow(vexRow), 'VEX.256.66.0F.WIG DC /r');
}

function TestFlattenAnchorsInMixedText() {
  // A hyperlink of a footnote marker splits the text of an instruction.
  assert.equal(
      FlattenAnchorsInMixedText(
          '<text top="424" left="284"><a href="#132">, r</a>8</text>'),
      '<text top="424" left="284">, r8</text>');
  assert.equal(
      FlattenAnchorsInMixedText(
          '<text top="424" left="221">ADC r/m<a href="#127">8</a></text>'),
      '<text top="424" left="221">ADC r/m8</text>');
  // An element which has nothing but an anchor is kept, since the index of the
  // instructions is extracted from its href.
  assert.equal(
      FlattenAnchorsInMixedText(
          '<text top="421" left="278"><a href="#132">1</a></text>'),
      '<text top="421" left="278"><a href="#132">1</a></text>');
}

function TestGetTextOfAnchor() {
  // A token which has nothing but an anchor (a footnote marker).
  assert.equal(GetText({a: {text: '1', attr: {href: '#132'}}, attr: {}}), '1');
  assert.equal(GetText({text: 'ADD r/m8', attr: {}}), 'ADD r/m8');
  assert.equal(GetText({i: 'r', attr: {}}), ' r ');
}

function TestDedupInstrList() {
  // One page can be referenced from multiple entries of the index.
  const e = (page, opcode, instr) => <SDMInstr>{
    opcode: opcode,
    opcode_parsed: [],
    opcode_bytes: [],
    instr: instr,
    instr_parsed: [],
    description: '',
    page: page,
  };
  const list = [
    e(206, 'VEX.LZ.0F38.W0 F3 /2', 'BLSMSK r32, r/m32'),
    e(206, 'VEX.LZ.0F38.W0 F3 /2', 'BLSMSK r32, r/m32'),
    e(206, 'VEX.LZ.0F38.W1 F3 /2', 'BLSMSK r64, r/m64'),
  ];
  assert.deepEqual(DedupInstrList(list).map(x => x.instr), [
    'BLSMSK r32, r/m32',
    'BLSMSK r64, r/m64',
  ]);
}

function TestParserOfRecentSDM() {
  // The row of VREDUCESD in 325383-092US (June 2026). It covers the CPUID
  // Feature Flag cell wrapped into two lines, the instruction wrapped into
  // three rows, and '/r' printed at the end of the instruction by mistake.
  const table = [[
    [
      {text: 'EVEX.LLIG.66.0F3A.W1 57', attr: {top: 175, left: 78}},
      {text: 'VREDUCESD xmm1 {k1}{z},', attr: {top: 191, left: 78}},
      {text: 'xmm2, xmm3/m64{sae},', attr: {top: 208, left: 78}},
      {text: 'imm8/r', attr: {top: 225, left: 78}},
    ],
    [{text: 'A', attr: {top: 175, left: 269}}],
    [{text: 'V/V', attr: {top: 175, left: 315}}],
    [
      {text: 'AVX512DQ', attr: {top: 175, left: 392}},
      {text: 'OR AVX10.1', attr: {top: 191, left: 392}},
    ],
    [
      {
        text: 'Perform a reduction transformation on a scalar double',
        attr: {top: 175, left: 498}
      },
      {
        text: 'precision floating-point value in xmm3/m64 by',
        attr: {top: 191, left: 498}
      },
    ],
  ]];
  assert.deepEqual(Parser_OpInstr_OpEn_6432_CPUID_Desc(table), [{
                     opcode: 'EVEX.LLIG.66.0F3A.W1 57 /r',
                     opcode_parsed: ['EVEX.LLIG.66.0F3A.W1', '57', '/r'],
                     opcode_bytes: [
                       {
                         components: ['EVEX.LLIG.66.0F3A.W1'],
                         byte_type: 'evex-prefix',
                         byte_size_min: 4,
                         byte_size_max: 4,
                       },
                       {
                         components: ['57'],
                         byte_type: 'opcode',
                         byte_size_min: 1,
                         byte_size_max: 1,
                       },
                       {
                         components: ['/r'],
                         byte_type: 'modrm',
                         byte_size_min: 1,
                         byte_size_max: 1,
                       },
                     ],
                     instr: 'VREDUCESD xmm1 {k1}{z}, xmm2, xmm3/m64{sae}, imm8',
                     instr_parsed: [
                       'VREDUCESD', 'xmm1 {k1}{z}', 'xmm2', 'xmm3/m64{sae}',
                       'imm8'
                     ],
                     op_en: 'A',
                     valid_in_64bit_mode: true,
                     valid_in_compatibility_mode: true,
                     valid_in_legacy_mode: false,
                     cpuid_feature_flag: 'AVX512DQ OR AVX10.1',
                     description:
                         'Perform a reduction transformation on a scalar double' +
                         ' precision floating-point value in xmm3/m64 by',
                   }]);
}

const HeaderTexts = {
  'Opcode': true,
  'Opcode/': true,
  'Opcode /': true,
  'Opcode*': true,
  'Opcode*/': true,
  'Opcode***': true,
  'Opcode/Instruction': true,
  'Op': true,
  'Op/': true,
  'Op /': true,
  'Op/En': true,
  'Op/ En': true,
  // 'Op/En' and 'Description' are one token in the VMX instruction reference.
  'Op/En Description': true,
  'Op / En': true,
  // 'Op/En' is splitted into two lines in the KORTEST/KTEST pages.
  'Op/E': true,
  'n': true,
  '64/32': true,
  '64/32 bit': true,
  '64/32 Bit': true,
  '64/32bit': true,
  '64/32-': true,
  '64/32-bit': true,
  'bit': true,
  'Bit Mode': true,
  '64-Bit': true,
  '64-bit': true,
  'Compat/': true,
  'Description': true,
  'Instruction': true,
  'En': true,
  'bit Mode': true,
  'Mode': true,
  'Leg Mode': true,
  'CPUID Feature': true,
  'CPUID Feature Flag': true,
  // 'CPUID Feature Flag' hyphenated at the end of the line.
  // Required by: PREFETCHW in 325383-092US (June 2026).
  'CPUID Fea-': true,
  'ture Flag': true,
  // 'Opcode' and '/' of 'Opcode/Instruction' extracted as separate tokens.
  // Required by: RDMSR in 325383-092US (June 2026).
  '/': true,
  'CPUID': true,
  // 'Op / En' and '64/32 bit' are sometimes merged into one token.
  'Op / En 64/32 bit': true,
  'Op/En 64/32 bit': true,
  'Op/ En 64/32 bit': true,
  'Op/ En 64/32-bit': true,
  'Op/ En 64/32-': true,
  '64-Bit Mode Compat/': true,
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
      // Fall back to the generic parser if the header layout is not known.
      const parseInstrTable = parserMap[headerKey] || ParseInstrTableByColumns;
      // Remove the footnote markers before looking for the end of the table,
      // so that a marker which belongs to the next section header is not left
      // in the last row of the table.
      // Required by: UMWAIT in 325383-092US (June 2026), whose page has a
      // marker right before 'Instruction Operand Encoding'.
      const following = RemoveFootnoteMarkers(s.getFollowing());
      let count = 0;
      while (count < following.length && !IsEndOfInstrTable(following[count])) {
        count++;
      }
      console.error(`Using parser ${headerKey}`);
      const tokens = following.slice(0, count);
      console.error(
          JSON.stringify(tableHeader, null, ''),
          JSON.stringify(tokens, null, ''));
      instrs = instrs.concat(parseInstrTable(tableHeader, tokens).map(e => {
        e.page = p;
        return e;
      }));
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
    multiple: true,
    description:
        'Paths to the source SDM xml files (can be generated from pdf with `pdftohtml -xml`). All of them are parsed into one list.'
  },
  {
    name: 'mnemonic',
    alias: 'm',
    type: String,
    multiple: true,
    description: 'Mnemonics to parse. Default is not set (parse all mnemonics).'
  },
  {
    name: 'gen-op-table-only',
    type: Boolean,
    description: 'Generate op_table.json from generated instr_list.json'
  },
];

const sections = [
  {header: 'sdmparser.js', content: 'Parse Intel SDM and generate JSON'},
  {header: 'Options', optionList: optionDefinitions}
];

function runTest() {
  TestCanonicalizeDescription();
  TestMakeOpBytes();
  TestMakeOpBytesOfRecentSDM();
  TestCanonicalizeOpcode();
  TestCanonicalizeOpcodeOfRecentSDM();
  TestCanonicalizeInstr();
  TestCanonicalizeInstrOfRecentSDM();
  TestCanonicalizeModes();
  TestJoinWrappedText();
  TestSplitMergedCells();
  TestIsEndOfInstrTable();
  TestRemoveFootnoteMarkers();
  TestJoinTokensInRow();
  TestFlattenAnchorsInMixedText();
  TestGetTextOfAnchor();
  TestDedupInstrList();
  TestExpandMnemonic();
  TestParser();
  TestParserOfRecentSDM();
  console.log('PASS');
}

function DedupInstrList(instList: SDMInstr[]): SDMInstr[] {
  // One page can be referenced from multiple entries of the index (e.g. an
  // instruction is listed both in the table of contents of the volume and the
  // one of the chapter), and the page is parsed once for each of them.
  // Remove the entries parsed from the same row of the same page.
  const found = {};
  return instList.filter((e) => {
    const key = `${e.document}#${e.page}#${e.opcode}#${e.instr}`;
    if (found[key]) {
      return false;
    }
    found[key] = true;
    return true;
  });
}

function ParseSDMDocument(
    sdmPages, instrIndex, requestedMnemonicList, documentName: string,
    result: {
      instList: SDMInstr[],
      passCount: number,
      failCount: number,
      matchedInstrMap: {},
      failedReasons: {}
    }) {
  // Parses one volume of the SDM and appends the instructions to result.
  let passCount = 0;
  let failCount = 0;
  let instList = [];
  const matchedInstrMap = result.matchedInstrMap;
  const failedReasons = result.failedReasons;
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
      const instrs = ParseInstr(sdmPages, e.physical_page).map(instr => {
        instr.document = documentName;
        return instr;
      });
      console.log(instrs);
      instList = instList.concat(instrs);
      passCount++;
    } catch (err) {
      console.error(err.stack);
      failedReasons[e.mnemonics.join(',')] = err.stack;
      failCount++;
    }
  }
  console.error(`${documentName}: parsed ${passCount}, failed ${failCount}`);
  result.instList = result.instList.concat(instList);
  result.passCount += passCount;
  result.failCount += failCount;
}

function parseSDM(filepaths: string[], requestedMnemonicList) {
  const result = {
    instList: <SDMInstr[]>[],
    passCount: 0,
    failCount: 0,
    matchedInstrMap: {},
    failedReasons: {},
  };
  for (const filepath of filepaths) {
    // The document name is the basename without the extension, which is also
    // the name of the PDF the UI links to.
    const documentName = path.basename(filepath).replace(/\.[^.]*$/, '');
    console.error(`Parsing ${filepath} as ${documentName}...`);
    const sdmPages = ParseXMLToSDMPages(fs.readFileSync(filepath, 'utf-8'));
    const instrIndex: SDMInstrIndex[] = ExtractSDMInstrIndex(sdmPages);
    ParseSDMDocument(
        sdmPages, instrIndex, requestedMnemonicList, documentName, result);
  }
  const {passCount, failCount, matchedInstrMap, failedReasons} = result;
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
  const instList = DedupInstrList(result.instList);
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
}

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
    runTest();
    return 0;
  }
  if (options['gen-op-table-only']) {
    const instr_list = JSON.parse(fs.readFileSync('instr_list.json', 'utf-8'));
    const instrs = instr_list.map(e => e.opcode_bytes)
                       .map(e => {
                         return e.map(b => {
                           if (b.byte_type == 'opcode') {
                             return b.components[0];
                           }
                           if (b.byte_type == 'imm') {
                             return 'IMM' + (b.byte_size_min * 8);
                           }
                           return b.byte_type;
                         });
                       })
                       .sort();
    const opmap = {};
    for (const s of instrs) {
      if (opmap[s[0]] === undefined) {
        opmap[s[0]] = [];
      }
      opmap[s[0]].push(s);
    }
    console.log(opmap);
    return 0;
  }
  let filepaths: string[];
  if (options.file === undefined) {
    // Volume 2 has the instruction set reference, and volume 3 has the VMX,
    // SEAM and SGX instructions which are not in volume 2.
    filepaths = [
      'pdf/325383-sdm-vol-2abcd.xml',
      'pdf/325384-sdm-vol-3abcd.xml',
    ];
    console.error(
        `--file option is not set. Using default paths (${filepaths.join(', ')}).`);
  } else {
    filepaths = options.file;
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
  if (options.list) {
    const index = [];
    for (const filepath of filepaths) {
      const sdmPages = ParseXMLToSDMPages(fs.readFileSync(filepath, 'utf-8'));
      for (const e of ExtractSDMInstrIndex(sdmPages)) {
        index.push(e);
      }
    }
    console.log(JSON.stringify(index, null, ' '));
    return 0;
  }
  return parseSDM(filepaths, requestedMnemonicList);
})());
