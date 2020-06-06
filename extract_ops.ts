const fs = require('fs');

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

function ExtractOpIndex() {
  const data = fs.readFileSync(filename, 'utf-8');
  const data_refs = data.split('<a href="');
  let lastPage = 0;
  const opPageList = [];
  for(const refs of data_refs) {
    if(!refs.startsWith(filename + "#")) continue;
    const v = refs.split('">');
    const pnum = parseInt(v[0].split("#")[1]);
    if(pnum < lastPage) {
      // extract normal index only. do not include figure, appendix, etc...
      break;
    }
    lastPage = pnum;
    const w = v[1].split('\n');
    //if(w[0].indexOf(" Instructions (") == -1) continue;
    const title = w[0].split('&#160;').join(' ');
    if(title.indexOf('—') == -1) continue;
    const opfamily = title.split('—')[0];
    const opmnemonic = opfamily.split('/').map((e) => e.trim());
    opPageList.push({page: pnum, ops: opmnemonic});
  }
  return opPageList;
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

const opIndexList = ExtractOpIndex();
console.log(opIndexList);
/*
ParseOpsInPage(133);  // ADD
ParseOpsInPage(699);  // MOV
*/
