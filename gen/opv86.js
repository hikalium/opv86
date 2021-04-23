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
function appendOpListElement(oplist, op, index) {
    const oplistRow = $('<div>')
        .addClass('opv86-oplist-container')
        .addClass(`opv86-oplist-row-${index}`);
    oplistRow.click(() => {
        $('.opv86-description-panel').remove();
        const opDescription = $('<div>').addClass('opv86-description-panel');
        opDescription.append($('<h3>').text(op.instr));
        opDescription.append($('<p>').text(op.description));
        if (op.op_en) {
            opDescription.append($('<h4>').text('Encoding'));
            opDescription.append($('<p>').text(op.op_en));
        }
        opDescription.append($('<h4>').text('Parsed info (Click to expand)').click(() => {
            $(`#opv86-oplist-row-${index}-parsed-info`).toggle();
        }));
        opDescription.append($('<pre>')
            .attr('id', `opv86-oplist-row-${index}-parsed-info`)
            .text(JSON.stringify(op, null, '  '))
            .hide());
        opDescription.insertAfter(oplistRow);
        if (op.page !== undefined) {
            opDescription.append($(`<a target="_blank" href='https://software.intel.com/content/dam/develop/public/us/en/documents/325383-sdm-vol-2abcd.pdf#page=${op.page}'>From p.${op.page} of Intel SDM</a>`));
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
        }
        else {
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
function isMatchedWithFilter(op, filter) {
    if (filter.length == 0)
        return true;
    if (op.opcode.replace(/ /g, '').toLowerCase().indexOf(filter) != -1)
        return true;
    if (op.instr.replace(/ /g, '').toLowerCase().indexOf(filter) != -1)
        return true;
    return false;
}
function updateFilter(data, filter) {
    $('.opv86-description-panel').remove();
    filter = filter.trim().toLowerCase().replace(/\s+/g, '');
    for (const index in data) {
        const op = data[index];
        if (!isMatchedWithFilter(op, filter)) {
            $(`.opv86-oplist-row-${index}`).css('display', 'none');
            continue;
        }
        $(`.opv86-oplist-row-${index}`).css('display', '');
    }
}
(() => {
    const opListContainerDiv = $('#oplist2');
    const filterValueInput = document.getElementById('filter-value');
    $.getJSON(`data/instr_list.json`, function (data) {
        appendOpListHeaders(opListContainerDiv);
        console.log(data[0]);
        for (let i = 0; i < data.length; i++) {
            appendOpListElement(opListContainerDiv, data[i], i);
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
var SDMInstrOpByteType;
(function (SDMInstrOpByteType) {
    SDMInstrOpByteType["Opcode"] = "opcode";
    SDMInstrOpByteType["Imm"] = "imm";
})(SDMInstrOpByteType || (SDMInstrOpByteType = {}));
