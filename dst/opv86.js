function isMatchedWithFilter(op, filter) {
    if (filter.length == 0)
        return true;
    if (op.opcode.replace(/ /g, "").toLowerCase().indexOf(filter) != -1)
        return true;
    if (op.instr.replace(/ /g, "").toLowerCase().indexOf(filter) != -1)
        return true;
    return false;
}
function updateTable(data, filter) {
    var oplist = $("#oplist");
    oplist.empty();
    filter = filter.trim().toLowerCase();
    oplist.append($("<div>").addClass("opv86-oplist-header").text("Opcode"));
    oplist.append($("<div>").addClass("opv86-oplist-header").text("Instr"));
    oplist.append($("<div>").addClass("opv86-oplist-header").text("Encoding"));
    oplist.append($("<div>").addClass("opv86-oplist-header").text("Page in SDM(phys)"));
    oplist.append($("<div>").addClass("opv86-oplist-header").text("Description"));
    for (var _i = 0, _a = data.ops; _i < _a.length; _i++) {
        var op = _a[_i];
        if (!isMatchedWithFilter(op, filter))
            continue;
        oplist.append($("<div>").addClass("opv86-oplist-item-opcode").text(op.opcode));
        oplist.append($("<div>").addClass("opv86-oplist-item-instr").text(op.instr));
        oplist.append($("<div>").addClass("opv86-oplist-item-encoding").text(op.op_en));
        oplist.append($("<div>").addClass("opv86-oplist-item-page").append($("<a target=\"_blank\" href='https://software.intel.com/content/dam/develop/public/us/en/documents/325383-sdm-vol-2abcd.pdf#page=" + op.page + "'>p." + op.page + "</a>")));
        oplist.append($("<div>").addClass("opv86-oplist-item-description").text(op.description));
    }
}
$.getJSON("data/ops.json", function (data) {
    $("#data-info").text("Parsed at: " + data.date_parsed + ", based on: " + data.source_file + " (" + data.document_id + "), " + data.document_version);
    /*
    var table = new Tabulator("#example-table", {
      data:data.ops,
      columns:[
          {title:"Opcode", field:"opcode"},
          {title:"Instr", field:"instr"},
          {title:"SDM page", field:"page"},
          {title:"Description", field:"description"},
          {title:"Encoding", field:"op_en"},
      ]
    });
    */
    document.getElementById("filter-value").addEventListener("keyup", function () {
        updateTable(data, document.getElementById("filter-value").value);
    });
    updateTable(data, "");
});
