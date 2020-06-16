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
;

interface SDMData {
  attributes: SDMDataAttr;
}
;

function ExtractSDMDataAttr(filepath: string, firstPage: any): SDMDataAttr {
  console.log(firstPage);
  const result = {
    source_file: path.basename(filepath),
    date_parsed: new Date().toISOString(),
    document_id: null,
    document_version: null
  };
  for (let i = 0; i < firstPage.text.length; i++) {
    const s = firstPage.text[i]['#text'];
    if (!s || !s.startsWith('Order Number:')) continue;
    result.document_id = s.split(":")[1].trim();
    result.document_version = firstPage.text[i+1]['#text'].trim();
  }
  return result;
}

(() => {
  const filepath = 'pdf/325383-sdm-vol-2abcd.xml'
  const data = fs.readFileSync(filepath, 'utf-8');
  const options = {
    attributeNamePrefix: '@_',
    attrNodeName: 'attr',  // default is 'false'
    textNodeName: '#text',
    ignoreAttributes: false,
    ignoreNameSpace: false,
    allowBooleanAttributes: false,
    parseNodeValue: true,
    parseAttributeValue: false,
    trimValues: true,
    cdataTagName: '__cdata',  // default is 'false'
    cdataPositionChar: '\\c',
    parseTrueNumberOnly: false,
    arrayMode: false,  //"strict"
    attrValueProcessor: (val, attrName) =>
        he.decode(val, {isAttributeValue: true}),         // default is a=>a
    tagValueProcessor: (val, tagName) => he.decode(val),  // default is a=>a
    stopNodes: ['parse-me-as-string']
  };
  if (!parser.validate(data)) {
    console.error(
        'Not a valid xml. Please generate with `pdftohtml -xml 325383-sdm-vol-2abcd.pdf`')
    return;
  }
  var sdm = parser.parse(data, options);
  assert.ok(sdm.pdf2xml.page);
  console.log(ExtractSDMDataAttr(filepath, sdm.pdf2xml.page[0]));
})();
