function appendOpListHeaders(oplist) {
  oplist.empty();
  const oplistRow = $('<div>').addClass('opv86-oplist-container');
  oplistRow.append($('<div>').addClass('opv86-oplist-header').text('Opcode'));
  oplistRow.append($('<div>').addClass('opv86-oplist-header').text('Instr'));
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-header-description')
                       .text('Description'));
  oplist.append(oplistRow);
}
// The opcode area is a grid of 60px columns with a 4px gap between them.
// See .opv86-oplist-item-opcode in opv86.css.
const OPCODE_COLUMN_WIDTH_PX = 60;
const OPCODE_COLUMN_GAP_PX = 4;
// Source Code Pro is a monospace font whose advance width is 0.6em.
const OPCODE_CHAR_WIDTH_PER_FONT_SIZE = 0.6;
function fontSizeToFitOpcodeBox(
    text: string, columnSpan: number, baseSizePx: number): number {
  // A text which is wider than its box is wrapped and overflows below the row.
  // Shrink the font of such a text so that it fits, in the same way as the VEX
  // prefix does with .opv86-opcode-byte-vex-prefix. The box is never widened,
  // because its width shows how many bytes the component occupies.
  const boxWidthPx = columnSpan * OPCODE_COLUMN_WIDTH_PX +
      (columnSpan - 1) * OPCODE_COLUMN_GAP_PX;
  const fitSizePx = Math.floor(
      boxWidthPx / (text.length * OPCODE_CHAR_WIDTH_PER_FONT_SIZE));
  if (fitSizePx >= baseSizePx) {
    return baseSizePx;
  }
  // Keep it readable even if the text is very long.
  return Math.max(fitSizePx, 6);
}
function appendOpListElement(
    oplist, op: SDMInstr, index: number): HTMLElement {
  const oplistRow = $('<div>')
                        .addClass('opv86-oplist-container')
                        .addClass(`opv86-oplist-row-${index}`);
  oplistRow.click(() => {
    $('.opv86-description-panel').remove();
    const opDescription = $('<div>').addClass('opv86-description-panel');
    opDescription.append($('<h3>').text(op.instr))
    opDescription.append($('<p>').text(op.description))
    if (op.page !== undefined && op.document !== undefined) {
      // Each instruction knows which volume of the SDM it came from, since
      // the VMX, SEAM and SGX instructions are only in volume 3.
      const volume = op.document.indexOf('-vol-') === -1 ?
          '' :
          ` Vol.${op.document.split('-vol-')[1].charAt(0)}`;
      opDescription.append($('<p>').append($(
          `<a target="_blank" href='./sdmparser/pdf/${op.document}.pdf#page=${
              op.page}'>Source: p.${op.page} of Intel SDM${
              volume} (click to open PDF)</a>`)));
    }
    opDescription.append($('<h4>').text('Parsed info'));
    opDescription.append($('<pre>').text(JSON.stringify(op, null, '  ')));
    opDescription.insertAfter(oplistRow);
  });
  const sizeAttrTable = {
    // A component which occupies no byte (e.g. 'NP' and the precondition of a
    // register like '(EAX = 0)' of GETSEC) is shown in a wider box of its own,
    // so that it is not wrapped into the next line.
    0: 'opv86-opcode-pseudo-byte',
    1: 'opv86-opcode-byte',
    2: 'opv86-opcode-word',
    4: 'opv86-opcode-dword',
    6: 'opv86-opcode-p16ofs32',
    8: 'opv86-opcode-qword',
  };
  // How many columns of the grid each class above spans.
  const columnSpanTable = {
    0: 2,
    1: 1,
    2: 2,
    4: 4,
    6: 6,
    8: 8,
  };
  const opcodeByteElements = op.opcode_bytes.map(b => {
    const e = $('<div>');
    e.addClass(`opv86-op-${index}`);
    const text = b.components.join(' ');
    e.text(text);
    if (sizeAttrTable[b.byte_size_min]) {
      e.addClass(sizeAttrTable[b.byte_size_min]);
    } else {
      e.addClass(sizeAttrTable[1]);
    }
    if (b.byte_type) {
      e.addClass(`opv86-opcode-byte-${b.byte_type}`);
    }
    // .opv86-opcode-byte-vex-prefix already uses a smaller font.
    const baseSizePx = (b.byte_type === 'vex-prefix') ? 10 : 16;
    const columnSpan = columnSpanTable[b.byte_size_min] ?
        columnSpanTable[b.byte_size_min] :
        columnSpanTable[1];
    const sizePx = fontSizeToFitOpcodeBox(text, columnSpan, baseSizePx);
    if (sizePx !== baseSizePx) {
      e.css('font-size', `${sizePx}px`);
    }
    return e;
  });
  oplistRow.append($('<div>')
                       .addClass(`opv86-op-${index}`)
                       .addClass('opv86-oplist-item-opcode')
                       .append(opcodeByteElements));
  oplistRow.append($('<div>')
                       .addClass(`opv86-op-${index}`)
                       .addClass('opv86-oplist-item-instr')
                       .text(op.instr_parsed.join(' ')));
  oplistRow.append($('<div>')
                       .addClass(`opv86-op-${index}`)
                       .addClass('opv86-oplist-item-description')
                       .text(op.description));
  oplist.append(oplistRow);
  // Return the raw element so that the filter can show/hide it without
  // looking it up in the document again.
  return oplistRow[0];
}

// The table which the decoder works on. It is built once, from the same
// instruction list as the one shown below the box.
let decoderTable: DecoderTable = null;

// The short name shown under each byte of the decoder output.
const byteTypeNameTable = {
  'prefix': 'prefix',
  'rex-prefix': 'REX',
  'vex-prefix': 'VEX',
  'evex-prefix': 'EVEX',
  'opcode': 'op',
  'modrm': 'modrm',
  'sib': 'sib',
  'disp': 'disp',
  'imm': 'imm',
  'unknown': '?',
};

function updateDecoderOutput(filter: string) {
  const decoderOutputContainerDiv = $('#decoder-output');
  filter = filter.replace(/ /g, '');
  if (!filter.match(/^[0-9a-fA-F]+$/) || decoderTable === null) {
    decoderOutputContainerDiv.hide();
    return;
  }
  decoderOutputContainerDiv.show();
  const decoderOutputBinDiv = $('#decoder-output-bin');
  decoderOutputBinDiv.empty();

  const bin = filter.match(/.{1,2}/g).map(s => parseInt(s, 16));
  const decoded = decodeInstr(bin, decoderTable);
  const opcodeByteElements = decoded.bytes.map(e => {
    return $('<div>')
        .addClass(`opv86-opcode-byte-${e.byte_type}`)
        .addClass(`opv86-opcode-byte`)
        .text(('00' + e.byte_value.toString(16).toUpperCase()).substr(-2));
  });
  const opcodeByteElementsDescription = decoded.bytes.map(e => {
    // A legacy prefix knows its own name (LOCK, BND, FS, ...); the other bytes
    // are named after their type.
    const name = e.name ? e.name :
        (byteTypeNameTable[e.byte_type] ? byteTypeNameTable[e.byte_type] :
                                          e.byte_type);
    return $('<div>').addClass(`opv86-opcode-byte`).text(name);
  });

  // Say what happened when the decode did not reach the end of the
  // instruction, instead of showing a wrong result as if it was a right one.
  let instrText = decoded.instr;
  if (!decoded.matched) {
    instrText = `? (${decoded.note})`;
  } else if (decoded.truncated) {
    instrText = `${decoded.instr} (incomplete: ${decoded.note})`;
  } else if (decoded.note !== '') {
    instrText = `${decoded.instr} (${decoded.note})`;
  }
  let descriptionText = decoded.description;
  if (decoded.matched && !decoded.truncated) {
    descriptionText = `${decoded.length} byte(s): ${decoded.description}`;
  }

  const oplistRow = $('<div>').addClass('opv86-oplist-container-decoder');
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-opcode')
                       .append(opcodeByteElements));
  oplistRow.append(
      $('<div>').addClass('opv86-oplist-item-instr').text(instrText));
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-opcode')
                       .append(opcodeByteElementsDescription));
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-description')
                       .text(descriptionText));
  decoderOutputBinDiv.append(oplistRow);
}
function escapeRegExp(string) {
  // from
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
  return string.replace(
      /[.*+?^${}()|[\]\\]/g, '\\$&');  // $& means the whole matched string
}
function isMatchedWithFilter(op: SDMInstr, filter: string) {
  if (filter.length == 0) return true;
  if (op.matcher_opcode.indexOf(filter) != -1) return true;
  if (op.matcher_instr.indexOf(filter) != -1) return true;
  return false;
}
function appendMatcherToOp(op: SDMInstr) {
  op.matcher_opcode = op.opcode.replace(/ /g, '').toLowerCase();
  op.matcher_instr = op.instr.replace(/ /g, '').toLowerCase();
}
function updateFilter(data: SDMInstr[], rows: HTMLElement[], filter: string) {
  updateDecoderOutput(filter);
  $('.opv86-description-panel').remove();
  filter = filter.trim().toLowerCase().replace(/\s+/g, '');
  let matchedCount = 0;
  let lastMatchedRow: HTMLElement = null;
  for (let i = 0; i < data.length; i++) {
    const matched = isMatchedWithFilter(data[i], filter);
    // Touch the cached element directly: doing $('.opv86-oplist-row-i') here
    // scans the whole document once per instruction, which is O(N^2) in total.
    // Writing the same value again would invalidate the style of the row for
    // nothing, and most of the rows keep their state between the keystrokes.
    const display = matched ? '' : 'none';
    if (rows[i].style.display !== display) {
      rows[i].style.display = display;
    }
    if (matched) {
      matchedCount++;
      lastMatchedRow = rows[i];
    }
  }
  // Expand the panel if there is only one result.
  if (matchedCount == 1) {
    lastMatchedRow.click();
  }
}
function compareOps(a: SDMInstr, b: SDMInstr) {
  // Sort by mnemonic, then by opcode to keep the same mnemonic in a stable
  // and sensible order.
  const mnemonicA = (a.instr_parsed[0] || '').toUpperCase();
  const mnemonicB = (b.instr_parsed[0] || '').toUpperCase();
  if (mnemonicA !== mnemonicB) return mnemonicA < mnemonicB ? -1 : 1;
  if (a.opcode !== b.opcode) return a.opcode < b.opcode ? -1 : 1;
  return 0;
}

(() => {
  const opListContainerDiv = $('#oplist2');
  const filterValueInput =
      <HTMLInputElement>document.getElementById('filter-value');
  $.getJSON(`data/instr_list.json`, function(data: SDMInstr[]) {
    // The decoder works on the same list as the one shown below, so build its
    // table before the list is sorted or filtered.
    decoderTable = buildDecoderTable(data);
    // The data file is in the SDM page order, so sort it here.
    data.sort(compareOps);
    appendOpListHeaders(opListContainerDiv);
    console.log(data[0]);
    // Build the rows in a fragment and put them into the document at once,
    // instead of inserting 4000+ rows into the live list one by one.
    const rows: HTMLElement[] = [];
    const oplistFragment = $(document.createDocumentFragment());
    for (let i = 0; i < data.length; i++) {
      rows.push(appendOpListElement(oplistFragment, data[i], i));
      appendMatcherToOp(data[i]);
    }
    opListContainerDiv.append(oplistFragment);
    const q = new URL(location.href).searchParams.get('q');
    if (q !== null) {
      filterValueInput.value = decodeURIComponent(q);
      updateFilter(data, rows, q);
    }
    filterValueInput.addEventListener('keyup', () => {
      const filterValue = filterValueInput.value;
      updateFilter(data, rows, filterValue);
      history.replaceState(null, '', '?q=' + encodeURIComponent(filterValue));
    });
  });
})();
