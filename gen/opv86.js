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
function fontSizeToFitOpcodeBox(text, columnSpan, baseSizePx) {
    // A text which is wider than its box is wrapped and overflows below the row.
    // Shrink the font of such a text so that it fits, in the same way as the VEX
    // prefix does with .opv86-opcode-byte-vex-prefix. The box is never widened,
    // because its width shows how many bytes the component occupies.
    const boxWidthPx = columnSpan * OPCODE_COLUMN_WIDTH_PX +
        (columnSpan - 1) * OPCODE_COLUMN_GAP_PX;
    const fitSizePx = Math.floor(boxWidthPx / (text.length * OPCODE_CHAR_WIDTH_PER_FONT_SIZE));
    if (fitSizePx >= baseSizePx) {
        return baseSizePx;
    }
    // Keep it readable even if the text is very long.
    return Math.max(fitSizePx, 6);
}
function appendOpListElement(oplist, op, index) {
    const oplistRow = $('<div>')
        .addClass('opv86-oplist-container')
        .addClass(`opv86-oplist-row-${index}`);
    oplistRow.click(() => {
        $('.opv86-description-panel').remove();
        const opDescription = $('<div>').addClass('opv86-description-panel');
        opDescription.append($('<h3>').text(op.instr));
        opDescription.append($('<p>').text(op.description));
        if (op.page !== undefined) {
            opDescription.append($('<p>').append($(`<a target="_blank" href='./sdmparser/pdf/325383-sdm-vol-2abcd.pdf#page=${op.page}'>Source: p.${op.page} of Intel SDM (click to open PDF)</a>`)));
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
        }
        else {
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
function parseInstr(bin) {
    const parsed = [];
    let rexFound = false;
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
            const rm = v & 7;
            if (mod == 0 && rm == 5) {
                for (let i = 0; i < 4; i++) {
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
function updateDecoderOutput(filter) {
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
        if (e.byte_type == "rex-prefix") {
            return $('<div>').addClass(`opv86-opcode-byte`).text("REX");
        }
        if (e.byte_type == "opcode") {
            return $('<div>').addClass(`opv86-opcode-byte`).text("op");
        }
        if (e.byte_type == "unknown") {
            return $('<div>').addClass(`opv86-opcode-byte`).text("?");
        }
        return $('<div>').addClass(`opv86-opcode-byte`).text(e.byte_type);
    });
    const oplistRow = $('<div>').addClass('opv86-oplist-container-decoder');
    oplistRow.append($('<div>')
        .addClass('opv86-oplist-item-opcode')
        .append(opcodeByteElements));
    oplistRow.append($('<div>').addClass('opv86-oplist-item-instr').text(parsed.instr));
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
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
function isMatchedWithFilter(op, filter) {
    if (filter.length == 0)
        return true;
    if (op.matcher_opcode.indexOf(filter) != -1)
        return true;
    if (op.matcher_instr.indexOf(filter) != -1)
        return true;
    return false;
}
function appendMatcherToOp(op) {
    op.matcher_opcode = op.opcode.replace(/ /g, '').toLowerCase();
    op.matcher_instr = op.instr.replace(/ /g, '').toLowerCase();
}
function updateFilter(data, rows, filter) {
    updateDecoderOutput(filter);
    $('.opv86-description-panel').remove();
    filter = filter.trim().toLowerCase().replace(/\s+/g, '');
    let matchedCount = 0;
    let lastMatchedRow = null;
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
function compareOps(a, b) {
    // Sort by mnemonic, then by opcode to keep the same mnemonic in a stable
    // and sensible order.
    const mnemonicA = (a.instr_parsed[0] || '').toUpperCase();
    const mnemonicB = (b.instr_parsed[0] || '').toUpperCase();
    if (mnemonicA !== mnemonicB)
        return mnemonicA < mnemonicB ? -1 : 1;
    if (a.opcode !== b.opcode)
        return a.opcode < b.opcode ? -1 : 1;
    return 0;
}
(() => {
    const opListContainerDiv = $('#oplist2');
    const filterValueInput = document.getElementById('filter-value');
    $.getJSON(`data/instr_list.json`, function (data) {
        // The data file is in the SDM page order, so sort it here.
        data.sort(compareOps);
        appendOpListHeaders(opListContainerDiv);
        console.log(data[0]);
        // Build the rows in a fragment and put them into the document at once,
        // instead of inserting 4000+ rows into the live list one by one.
        const rows = [];
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
var ParserPhase;
(function (ParserPhase) {
    ParserPhase[ParserPhase["Op"] = 0] = "Op";
    ParserPhase[ParserPhase["ModRM"] = 1] = "ModRM";
    ParserPhase[ParserPhase["Disp"] = 2] = "Disp";
    ParserPhase[ParserPhase["Imm"] = 3] = "Imm";
})(ParserPhase || (ParserPhase = {}));
var ByteType;
(function (ByteType) {
    ByteType["Unknown"] = "unknown";
    ByteType["Opcode"] = "opcode";
    ByteType["REXPrefix"] = "rex-prefix";
    ByteType["ModRM"] = "modrm";
    ByteType["Imm"] = "imm";
    ByteType["Disp"] = "disp";
})(ByteType || (ByteType = {}));
var SDMInstrOpByteType;
(function (SDMInstrOpByteType) {
    SDMInstrOpByteType["Opcode"] = "opcode";
    SDMInstrOpByteType["Imm"] = "imm";
})(SDMInstrOpByteType || (SDMInstrOpByteType = {}));
