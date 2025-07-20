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
function appendOpListElement(oplist, op: SDMInstr, index: number) {
  const oplistRow = $('<div>')
                        .addClass('opv86-oplist-container')
                        .addClass(`opv86-oplist-row-${index}`);
  oplistRow.click(() => {
    $('.opv86-description-panel').remove();
    const opDescription = $('<div>').addClass('opv86-description-panel');
    opDescription.append($('<h3>').text(op.instr))
    opDescription.append($('<p>').text(op.description))
    if (op.op_en) {
      opDescription.append($('<h4>').text('Encoding'))
      opDescription.append($('<p>').text(op.op_en))
    }
    opDescription.append(
        $('<h4>').text('Parsed info (Click to expand)').click(() => {
          $(`#opv86-oplist-row-${index}-parsed-info`).toggle();
        }));
    opDescription.append(
        $('<pre>')
            .attr('id', `opv86-oplist-row-${index}-parsed-info`)
            .text(JSON.stringify(op, null, '  '))
            .hide())
    opDescription.insertAfter(oplistRow);
    if (op.page !== undefined) {
      opDescription.append($(
          `<a target="_blank" href='./sdmparser/pdf/325383-sdm-vol-2abcd.pdf#page=${
              op.page}'>From p.${op.page} of Intel SDM</a>`));
    }
  });
  const sizeAttrTable = {
    1: 'opv86-opcode-byte',
    2: 'opv86-opcode-word',
    4: 'opv86-opcode-dword',
    6: 'opv86-opcode-p16ofs32',
    8: 'opv86-opcode-qword',
  };
  const opcodeByteElements = op.opcode_bytes.map(b => {
    const e = $('<div>');
    e.addClass(`opv86-op-${index}`);
    e.text(b.components.join(' '));
    if (sizeAttrTable[b.byte_size_min]) {
      e.addClass(sizeAttrTable[b.byte_size_min]);
    } else {
      e.addClass(sizeAttrTable[1]);
    }
    if (b.byte_type) {
      e.addClass(`opv86-opcode-byte-${b.byte_type}`);
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
}

const opTable = {
  'c7': {
    entry_type: 'op',
    following_phases: [
      'modrm',
      ['imm', 4],
    ],
    instr: 'MOV r/m32 imm32',
    description: 'Move imm32 to r/m32.',
  }
};

function parseInstr(bin: number[]): ParsedInstr {
  const parsed = [];
  let rexFound: Boolean = false;
  let table = opTable;
  let phaseList = [ParserPhase.Op];
  let instr = '?';
  let description = '?';
  for (const v of bin) {
    const phase = phaseList.shift();
    if (phase == ParserPhase.ModRM) {
      parsed.push({
        byte_value: v,
        byte_type: ByteType.ModRM,
      });
      const mod = v >> 6;
      const rm = v &7;
      if(mod == 0 && rm == 5) {
        for(let i = 0; i < 4; i++){
          phaseList.unshift(ParserPhase.Disp);
        }
      }
      continue;
    }
    if (phase == ParserPhase.Disp) {
      parsed.push({
        byte_value: v,
        byte_type: ByteType.Disp,
      });
      continue;
    }
    if (phase == ParserPhase.Imm) {
      parsed.push({
        byte_value: v,
        byte_type: ByteType.Imm,
      });
      continue;
    }
    if (phase == ParserPhase.Op) {
      if ((v & 0xF0) == 0x40) {
        rexFound = true;
        parsed.push({
          byte_value: v,
          byte_type: ByteType.REXPrefix,
        });
        phaseList.unshift(ParserPhase.Op);
        continue;
      }
      parsed.push({
        byte_value: v,
        byte_type: ByteType.Opcode,
      });
      const e = opTable[('00' + v.toString(16)).substr(-2)];
      if (e) {
        instr = e.instr;
        description = e.description;
        for (const fp of e.following_phases) {
          if (fp === 'modrm') {
            phaseList.push(ParserPhase.ModRM);
          }
          if (fp instanceof Array && fp[0] == 'imm') {
            for (let i = 0; i < fp[1]; i++) {
              phaseList.push(ParserPhase.Imm);
            }
          }
        }
      }
      continue;
    }
    parsed.push({
      byte_value: v,
      byte_type: ByteType.Unknown,
    });
  }
  return {
    bytes: parsed,
    instr: instr,
    description: description,
  };
}
function updateDecoderOutput(filter: string) {
  const decoderOutputContainerDiv = $('#decoder-output');
  filter = filter.replace(/ /g, '');
  if (!filter.match(/^[0-9a-fA-F]+$/)) {
    decoderOutputContainerDiv.hide();
    return;
  }
  decoderOutputContainerDiv.show();
  const decoderOutputBinDiv = $('#decoder-output-bin');
  decoderOutputBinDiv.empty();

  const bin = filter.match(/.{1,2}/g).map(s => parseInt(s, 16));
  const parsed = parseInstr(bin);
  const opcodeByteElements = parsed.bytes.map(e => {
    return $('<div>')
        .addClass(`opv86-opcode-byte-${e.byte_type}`)
        .addClass(`opv86-opcode-byte`)
        .text(('00' + e.byte_value.toString(16).toUpperCase()).substr(-2));
  });
  const opcodeByteElementsDescription = parsed.bytes.map(e => {
    if(e.byte_type == "rex-prefix") {
      return $('<div>').addClass(`opv86-opcode-byte`).text("REX");
    }
    if(e.byte_type == "opcode") {
      return $('<div>').addClass(`opv86-opcode-byte`).text("op");
    }
    if(e.byte_type == "unknown") {
      return $('<div>').addClass(`opv86-opcode-byte`).text("?");
    }
    return $('<div>').addClass(`opv86-opcode-byte`).text(e.byte_type);
  });

  const oplistRow = $('<div>').addClass('opv86-oplist-container-decoder');
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-opcode')
                       .append(opcodeByteElements));
  oplistRow.append(
      $('<div>').addClass('opv86-oplist-item-instr').text(parsed.instr));
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-opcode')
                       .append(opcodeByteElementsDescription));
  oplistRow.append($('<div>')
                       .addClass('opv86-oplist-item-description')
                       .text(parsed.description));
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
function updateFilter(data: SDMInstr[], filter: string) {
  updateDecoderOutput(filter);
  $('.opv86-description-panel').remove();
  filter = filter.trim().toLowerCase().replace(/\s+/g, '');
  for (const index in data) {
    const op: SDMInstr = data[index];
    if (isMatchedWithFilter(op, filter)) {
      $(`.opv86-oplist-row-${index}`).css('display', '');
      continue;
    }
    $(`.opv86-oplist-row-${index}`).css('display', 'none');
  }
  // Expand the panel if there is only one result
  // (actually, 2, since they includes the header row).
  const filteredRows = $('.opv86-oplist-container:visible');
  if (filteredRows.length == 2) {
    filteredRows[1].click();
  }
}

(() => {
  const opListContainerDiv = $('#oplist2');
  const filterValueInput =
      <HTMLInputElement>document.getElementById('filter-value');
  $.getJSON(`data/instr_list.json`, function(data: SDMInstr[]) {
    appendOpListHeaders(opListContainerDiv);
    console.log(data[0]);
    for (let i = 0; i < data.length; i++) {
      appendOpListElement(opListContainerDiv, data[i], i);
      appendMatcherToOp(data[i]);
    }
    const q = new URL(location.href).searchParams.get('q');
    if (q !== null) {
      filterValueInput.value = decodeURIComponent(q);
      updateFilter(data, q);
    }
    filterValueInput.addEventListener('keyup', () => {
      const filterValue = filterValueInput.value;
      updateFilter(data, filterValue);
      history.replaceState(null, '', '?q=' + encodeURIComponent(filterValue));
    });
  });
})();
