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

function ExtractSDMDataAttr(filepath: string, firstPage: SDMPage): SDMDataAttr {
  console.log(firstPage);
  const result = {
    source_file : path.basename(filepath),
    date_parsed : new Date().toISOString(),
    document_id : null,
    document_version : null
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
  const suffixList = [ '8', '16', '32', '64', 'B', 'W', 'D', 'Q' ];
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
      [ 'MOVDQU', 'VMOVDQU8', 'VMOVDQU16', 'VMOVDQU32', 'VMOVDQU64' ]);
  assert.deepEqual(ExpandMnemonic('MOVDQA,VMOVDQA32/64'),
                   [ 'MOVDQA', 'VMOVDQA32', 'VMOVDQA64' ]);
  assert.deepEqual(ExpandMnemonic('MOVS/MOVSB/MOVSW/MOVSD/MOVSQ'),
                   [ 'MOVS', 'MOVSB', 'MOVSW', 'MOVSD', 'MOVSQ' ]);
  assert.deepEqual(
      ExpandMnemonic('VPBROADCASTB/W/D/Q'),
      [ 'VPBROADCASTB', 'VPBROADCASTW', 'VPBROADCASTD', 'VPBROADCASTQ' ]);
  assert.deepEqual(ExpandMnemonic(' XTEST '), [ 'XTEST' ]);
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
              mnemonics : ExpandMnemonic(title),
              physical_page : parseInt(e.attr.href.split('#')[1]),
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
    attributeNamePrefix : '',
    attrNodeName : 'attr', // default is 'false'
    textNodeName : 'text',
    ignoreAttributes : false,
    ignoreNameSpace : false,
    allowBooleanAttributes : false,
    parseNodeValue : false,
    parseAttributeValue : false,
    trimValues : true,
    cdataTagName : '__cdata', // default is 'false'
    cdataPositionChar : '\\c',
    parseTrueNumberOnly : true,
    arrayMode : false, //"strict"
    attrValueProcessor : (val, attrName) =>
        he.decode(val, {isAttributeValue : true}),        // default is a=>a
    tagValueProcessor : (val, tagName) => he.decode(val), // default is a=>a
    stopNodes : [ 'parse-me-as-string' ]
  };
  if (!parser.validate(data)) {
    console.error(
        'Not a valid xml. Please generate with `pdftohtml -xml 325383-sdm-vol-2abcd.pdf`')
    process.exit();
  }
  const sdm = parser.parse(data, options);
  assert.ok(sdm.pdf2xml.page);
  sdm.pdf2xml.page.unshift(null); // align page 1 to index 1
  for (let p of sdm.pdf2xml.page) {
    if (!p || !p.text)
      continue;
    for (let t of p.text) {
      if (!t.attr.top || !t.attr.left)
        continue;
      t.attr.top = parseInt(t.attr.top);
      t.attr.left = parseInt(t.attr.left);
      t.attr.width = undefined;
      t.attr.height = undefined;
      t.attr.font = undefined;
    }
  }
  return <SDMPage[]>sdm.pdf2xml.page;
}

interface SDMInstr {
  opcode: string[];
  instr: string[];
  op_en?: string;
  valid_in_64bit_mode?: boolean;
  valid_in_compatibility_mode?: boolean;
  valid_in_legacy_mode?: boolean;
  description: string;
}

function CanonicalizeValidIn64(str: string): boolean {
  if (str === 'Invalid') {
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
function GetText(t: SDMText): string {
  if (t.i)
    return ' ' + t.i + ' ';
  if (t.text)
    return t.text;
  return '';
}

const parserMap = {
  'opcode#instruction#op/#en#64-bit#mode#compat/#leg mode#description' : (
      headers: SDMText[], tokens: SDMText[]) : SDMInstr[] => {
    console.log(JSON.stringify(headers));
    console.log(JSON.stringify(tokens));
    const opLeft = headers[0].attr.left;
    const instrLeft = headers[1].attr.left;
    const opEnLeft = headers[2].attr.left;
    const validIn64Left = headers[4].attr.left;
    const validInCompatLegacyLeft = headers[6].attr.left;
    const descriptionLeft = headers[7].attr.left;
    const instrList: SDMInstr[] = [];
    let k = 0;
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
      textRows[k] = textRows[k].sort(
          (lhs: SDMText,
           rhs: SDMText) => { return lhs.attr.left - rhs.attr.left; });
    }
    try {
      for (const k in textRows) {
        console.log(textRows[k].map(t => GetText(t)));
      }
      while (k < tokens.length) {
        if (k >= tokens.length)
          throw new Error('Out of range!');
        if (tokens[k].attr.left != opLeft) {
          if (instrLeft <= tokens[k].attr.left &&
              tokens[k].attr.left < opEnLeft &&
              (tokens[k].text === '*' || tokens[k].text === '***,' ||
               tokens[k].text === '***')) {
            // Ignore. e.g. ADC r/m8*, imm8
            k++;
            continue;
          }
          throw new Error(`Not op!`);
        }
        const opcode = [];
        while (k < tokens.length && tokens[k].attr.left < instrLeft) {
          opcode.push(GetText(tokens[k++]).trim());
        }
        if (k >= tokens.length)
          throw new Error(`Out of range! read opcode: ${opcode}`);
        const instr = [];
        while (k < tokens.length && tokens[k].attr.left < opEnLeft) {
          instr.push(GetText(tokens[k++]).trim());
        }
        if (k >= tokens.length)
          throw new Error('Out of range!');
        const op_en = tokens[k++].text;
        if (k >= tokens.length)
          throw new Error('Out of range!');
        const valid_in_64_str = tokens[k++].text;
        if (k >= tokens.length)
          throw new Error('Out of range!');
        const compat_leg_str = tokens[k++].text;
        if (k >= tokens.length)
          throw new Error('Out of range!');
        let description = '';
        while (k < tokens.length && tokens[k].attr.left >= descriptionLeft) {
          if (tokens[k - 1].attr.top != tokens[k].attr.top) {
            // insert space between line feeds
            description += ' ';
          }
          description += GetText(tokens[k++]);
        }
        instrList.push({
          opcode : opcode,
          instr : instr,
          op_en : op_en,
          valid_in_64bit_mode : CanonicalizeValidIn64(valid_in_64_str),
          valid_in_compatibility_mode : CanonicalizeCompatLeg(compat_leg_str),
          valid_in_legacy_mode : CanonicalizeCompatLeg(compat_leg_str),
          description : description,
        })
      }
    } catch (err) {
      console.error(instrList);
      if (k < tokens.length) {
        err.message =
            err.message + `: Last token: ${JSON.stringify(tokens[k])}`;
      }
      throw err;
    }
    return instrList;
  },
};

function TestParser() {
  let parser;
  parser =
      parserMap['opcode#instruction#op/#en#64-bit#mode#compat/#leg mode#description'];
  assert(parser);
  assert.deepEqual(
      parser(
          [
            {'text' : 'Opcode', 'attr' : {'top' : 123, 'left' : 72}},
            {'text' : 'Instruction', 'attr' : {'top' : 123, 'left' : 220}},
            {'text' : 'Op/', 'attr' : {'top' : 123, 'left' : 389}},
            {'text' : 'En', 'attr' : {'top' : 137, 'left' : 389}},
            {'text' : '64-bit', 'attr' : {'top' : 123, 'left' : 426}},
            {'text' : 'Mode', 'attr' : {'top' : 137, 'left' : 426}},
            {'text' : 'Compat/', 'attr' : {'top' : 123, 'left' : 498}},
            {'text' : 'Leg Mode', 'attr' : {'top' : 137, 'left' : 498}},
            {'text' : 'Description', 'attr' : {'top' : 123, 'left' : 568}}
          ],
          [
            {'text' : '37', 'attr' : {'top' : 160, 'left' : 72}},
            {'text' : 'AAA', 'attr' : {'top' : 160, 'left' : 220}},
            {'text' : 'ZO', 'attr' : {'top' : 160, 'left' : 389}},
            {'text' : 'Invalid', 'attr' : {'top' : 160, 'left' : 426}},
            {'text' : 'Valid', 'attr' : {'top' : 160, 'left' : 498}}, {
              'text' : 'ASCII adjust AL after addition.',
              'attr' : {'top' : 160, 'left' : 568}
            }
          ]),
      [ {
        opcode : [ '37' ],
        instr : [ 'AAA' ],
        op_en : 'ZO',
        valid_in_64bit_mode : false,
        valid_in_compatibility_mode : true,
        valid_in_legacy_mode : true,
        description : 'ASCII adjust AL after addition.'
      } ]);
  assert.deepEqual(
      parser(
          [
            {'text' : 'Opcode', 'attr' : {'top' : 123, 'left' : 74}},
            {'text' : 'Instruction', 'attr' : {'top' : 123, 'left' : 221}},
            {'text' : 'Op/', 'attr' : {'top' : 123, 'left' : 388}},
            {'text' : 'En', 'attr' : {'top' : 137, 'left' : 388}},
            {'text' : '64-Bit', 'attr' : {'top' : 123, 'left' : 425}},
            {'text' : 'Mode', 'attr' : {'top' : 137, 'left' : 425}},
            {'text' : 'Compat/', 'attr' : {'top' : 123, 'left' : 497}},
            {'text' : 'Leg Mode', 'attr' : {'top' : 137, 'left' : 497}},
            {'text' : 'Description', 'attr' : {'top' : 123, 'left' : 567}}
          ],
          [
            {'text' : '0F 05', 'attr' : {'top' : 160, 'left' : 74}},
            {'text' : 'SYSCALL', 'attr' : {'top' : 160, 'left' : 221}},
            {'text' : 'ZO', 'attr' : {'top' : 160, 'left' : 388}},
            {'text' : 'Valid', 'attr' : {'top' : 160, 'left' : 425}},
            {'text' : 'Invalid', 'attr' : {'top' : 160, 'left' : 497}}, {
              'text' : 'Fast call to privilege level 0 system',
              'attr' : {'top' : 160, 'left' : 567}
            },
            {'text' : 'procedures.', 'attr' : {'top' : 177, 'left' : 567}}
          ]),
      [ {
        opcode : [ '0F 05' ],
        instr : [ 'SYSCALL' ],
        op_en : 'ZO',
        valid_in_64bit_mode : true,
        valid_in_compatibility_mode : true,
        valid_in_legacy_mode : true,
        description : 'Fast call to privilege level 0 system procedures.'
      } ]);
}

function ParseInstr(pages: SDMPage[], startPage: number): SDMInstr[] {
  let page = pages[startPage];
  let sorted = page.text.sort((lhs: SDMText, rhs: SDMText) => {
    if (lhs.attr.top == rhs.attr.top) {
      return lhs.attr.left - rhs.attr.left;
    }
    return lhs.attr.top - rhs.attr.top;
  });
  let k = 0;
  assert(sorted[k].text.startsWith('INSTRUCTION SET REFERENCE'));
  k++;
  const instrTitle = sorted[k].text;
  console.log(`page ${startPage}: ${instrTitle}`);
  k++;
  const opLeft = sorted[k].attr.left;
  const headersNotSorted = [ sorted[k] ];
  k++;
  while (k < sorted.length && sorted[k].attr.left != opLeft) {
    headersNotSorted.push(sorted[k]);
    k++;
  }
  const tokens = [];
  while (k < sorted.length) {
    if (sorted[k].text === 'Instruction Operand Encoding')
      break;
    if (sorted[k].text === 'NOTES:')
      break;
    const currentTop = sorted[k].attr.top;
    while (k < sorted.length && sorted[k].attr.top == currentTop) {
      tokens.push(sorted[k]);
      k++;
    }
  }
  const headers = headersNotSorted.sort((lhs: SDMText, rhs: SDMText) => {
    if (lhs.attr.left == rhs.attr.left) {
      return lhs.attr.top - rhs.attr.top;
    }
    return lhs.attr.left - rhs.attr.left;
  });
  const headerKey = headers.map(e => e.text).join('#').toLowerCase();
  if (!parserMap[headerKey]) {
    throw new Error(`Parser not implemented for header key ${headerKey}`);
  }
  return parserMap[headerKey](headers, tokens);
}

const optionDefinitions = [
  {name : 'runtest', type : Boolean},
  {name : 'help', alias : 'h', type : Boolean},
  {name : 'list', alias : 'l', type : Boolean},
  {
    name : 'file',
    alias : 'f',
    type : String,
    description :
        "Path to source SDM xml file (can be generated from pdf with `pdftohtml -xml`)."
  },
  {
    name : 'mnemonic',
    alias : 'm',
    type : String,
    multiple : true,
    description :
        "Mnemonics to parse. Default is not set (parse all mnemonics)."
  },
];

const sections = [
  {header : 'sdmparser.js', content : 'Parse Intel SDM and generate JSON'},
  {header : 'Options', optionList : optionDefinitions}
];

(() => {
  const commandLineArgs = require('command-line-args');
  const commandLineUsage = require('command-line-usage');
  const options = commandLineArgs(optionDefinitions);
  if (options.help) {
    const usage = commandLineUsage(sections);
    console.log(usage);
    return;
  }
  if (options.runtest) {
    TestExpandMnemonic();
    TestParser();
    console.log("PASS");
    return;
  }
  let filepath;
  if (options.file === undefined) {
    filepath = 'pdf/325383-sdm-vol-2abcd.xml'
    console.error(
        `--file option is not set. Using default path (${filepath}).`);
  } else {
    filepath = options.file;
  }
  let allowedMnemonicList: Record<string, boolean>;
  if (options.mnemonic) {
    allowedMnemonicList = {};
    for (const m of options.mnemonic) {
      allowedMnemonicList[m] = true;
    }
    console.error(
        `Parsing following mnemonic(s): ${options.mnemonic.join(", ")}`);
  }
  const data = fs.readFileSync(filepath, 'utf-8');
  const sdmPages = ParseXMLToSDMPages(data);
  const instrIndex: SDMInstrIndex[] = ExtractSDMInstrIndex(sdmPages);
  if (options.list) {
    console.log(JSON.stringify(instrIndex, null, " "));
    return;
  }
  for (const e of instrIndex) {
    let allowedInstrPage = false;
    for (const m of e.mnemonics) {
      if (allowedMnemonicList === undefined || allowedMnemonicList[m]) {
        allowedInstrPage = true;
        break;
      }
    }
    if (!allowedInstrPage)
      continue;
    try {
      const instrs = ParseInstr(sdmPages, e.physical_page);
      console.log(instrs);
    } catch (err) {
      console.log(err.message);
    }
  }
})();
