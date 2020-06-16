const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;

(() => {
  const filepath = 'pdf/325383-sdm-vol-2abcd.xml'
  const filename = path.basename(filepath);
  const data = fs.readFileSync(filepath, 'utf-8');
  console.log(data);
})();
