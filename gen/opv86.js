class OpV86 {
    isMatchedWithFilter(op, filter) {
        if (filter.length == 0)
            return true;
        if (op.opcode.replace(/ /g, '').toLowerCase().indexOf(filter) != -1)
            return true;
        if (op.instr.replace(/ /g, '').toLowerCase().indexOf(filter) != -1)
            return true;
        return false;
    }
    updateFilter(filter) {
        filter = filter.trim().toLowerCase();
        for (const index in this.data.ops) {
            const op = this.data.ops[index];
            if (!this.isMatchedWithFilter(op, filter)) {
                $(`.opv86-op-${index}`).css("display", "none");
                continue;
            }
            $(`.opv86-op-${index}`).css("display", "");
        }
    }
    updateTable(data) {
        this.data = data;
        const oplist = $('#oplist');
        oplist.empty();
        oplist.append($('<div>').addClass('opv86-oplist-header').text('Opcode'));
        oplist.append($('<div>').addClass('opv86-oplist-header').text('Instr'));
        oplist.append($('<div>').addClass('opv86-oplist-header').text('Encoding'));
        oplist.append($('<div>').addClass('opv86-oplist-header').text('Page in SDM(phys)'));
        oplist.append($('<div>').addClass('opv86-oplist-header').text('Description'));
        const opRowList = [];
        for (const index in data.ops) {
            const op = data.ops[index];
            const opcodeByteElements = [];
            const opcodeBytes = op.opcode.replace(/REX\.W \+/g, 'REX.W')
                .replace(/REX \+/g, 'REX')
                .replace(/ \+ /g, '+')
                .replace(/\+ /g, '+')
                .replace(/ \+/g, '+')
                .trim()
                .split(' ');
            for (const opByte of opcodeBytes) {
                const e = $('<div>').text(opByte).addClass(`opv86-op-${index}`);
                if (opByte.indexOf('REX') != -1) {
                    e.addClass('opv86-opcode-byte opv86-opcode-prefix');
                }
                else if (opByte.startsWith('NP')) {
                    e.addClass('opv86-opcode-byte opv86-opcode-prefix');
                }
                else if (opByte.indexOf('/') != -1) {
                    e.addClass('opv86-opcode-byte opv86-opcode-modrm');
                }
                else if (opByte.indexOf('ib') != -1 || opByte.indexOf('cb') != -1) {
                    e.addClass('opv86-opcode-byte opv86-opcode-imm');
                }
                else if (opByte.indexOf('iw') != -1 || opByte.indexOf('cw') != -1) {
                    e.addClass('opv86-opcode-word opv86-opcode-imm');
                }
                else if (opByte.indexOf('id') != -1 || opByte.indexOf('cd') != -1) {
                    e.addClass('opv86-opcode-dword opv86-opcode-imm');
                }
                else if (opByte.indexOf('io') != -1) {
                    e.addClass('opv86-opcode-qword opv86-opcode-imm');
                }
                else {
                    e.addClass('opv86-opcode-byte opv86-opcode-op');
                }
                opcodeByteElements.push(e);
            }
            oplist.append($('<div>')
                .addClass(`opv86-op-${index}`)
                .addClass('opv86-oplist-item-opcode')
                .append(opcodeByteElements));
            oplist.append($('<div>')
                .addClass(`opv86-op-${index}`)
                .addClass('opv86-oplist-item-instr').text(op.instr));
            oplist.append($('<div>')
                .addClass(`opv86-op-${index}`)
                .addClass('opv86-oplist-item-encoding').text(op.op_en));
            oplist.append($('<div>')
                .addClass(`opv86-op-${index}`)
                .addClass('opv86-oplist-item-page')
                .append($(`<a target="_blank" href='https://software.intel.com/content/dam/develop/public/us/en/documents/325383-sdm-vol-2abcd.pdf#page=${op.page}'>p.${op.page}</a>`)));
            oplist.append($('<div>')
                .addClass(`opv86-op-${index}`)
                .addClass('opv86-oplist-item-description')
                .text(op.description));
        }
    }
}
$.getJSON(`data/ops.json`, function (data) {
    const opv86 = new OpV86();
    $('#data-info')
        .text(`Parsed at: ${data.date_parsed}, based on: ${data.source_file} (${data.document_id}), ${data.document_version}`);
    document.getElementById('filter-value').addEventListener('keyup', () => {
        opv86.updateFilter(document.getElementById('filter-value').value);
    });
    opv86.updateTable(data);
});
