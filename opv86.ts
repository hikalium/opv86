
function isMatchedWithFilter(op, filter) {
  if(filter.length == 0) return true;
  if(op.opcode.replace(/ /g, "").toLowerCase().indexOf(filter) != -1) return true;
  if(op.instr.replace(/ /g, "").toLowerCase().indexOf(filter) != -1) return true;
  return false;
}

function updateTable(data, filter){
  const oplist = $("#oplist");
  oplist.empty();
  filter = filter.trim().toLowerCase();
  oplist.append($("<div>").addClass("opv86-oplist-header").text("Opcode"));
  oplist.append($("<div>").addClass("opv86-oplist-header").text("Instr"));
  oplist.append($("<div>").addClass("opv86-oplist-header").text("Encoding"));
  oplist.append($("<div>").addClass("opv86-oplist-header").text("Page in SDM(phys)"));
  oplist.append($("<div>").addClass("opv86-oplist-header").text("Description"));
  for(const op of data.ops) {
    if(!isMatchedWithFilter(op, filter)) continue;
    const opcodeByteElements = [];
    const opcodeBytes = op.opcode
      .replace(/REX\.W \+/g, "REX.W")
      .replace(/REX \+/g, "REX")
      .replace(/ \+ /g, "+")
      .replace(/\+ /g, "+")
      .replace(/ \+/g, "+")
      .trim()
      .split(" ");
    for(const opByte of opcodeBytes) {
      const e = $("<div>").text(opByte);
      if(opByte.indexOf("REX") != -1) {
        e.addClass("opv86-opcode-byte-prefix");
      } else if(opByte.indexOf("/") != -1) {
        e.addClass("opv86-opcode-byte-modrm");
      } else if(opByte.indexOf("ib") != -1 || opByte.indexOf("cb") != -1) {
        e.addClass("opv86-opcode-byte-imm8");
      } else if(opByte.indexOf("iw") != -1 || opByte.indexOf("cw") != -1) {
        e.addClass("opv86-opcode-byte-imm16");
      } else if(opByte.indexOf("id") != -1 || opByte.indexOf("cd") != -1) {
        e.addClass("opv86-opcode-byte-imm32");
      } else if(opByte.indexOf("io") != -1) {
        e.addClass("opv86-opcode-byte-imm64");
      } else{
        e.addClass("opv86-opcode-byte-normal");
      }
      opcodeByteElements.push(e);
    }
    oplist.append($("<div>").addClass("opv86-oplist-item-opcode").append(opcodeByteElements));
    oplist.append($("<div>").addClass("opv86-oplist-item-instr").text(op.instr));
    oplist.append($("<div>").addClass("opv86-oplist-item-encoding").text(op.op_en));
    oplist.append($("<div>").addClass("opv86-oplist-item-page").append($(`<a target="_blank" href='https://software.intel.com/content/dam/develop/public/us/en/documents/325383-sdm-vol-2abcd.pdf#page=${op.page}'>p.${op.page}</a>`)));
    oplist.append($("<div>").addClass("opv86-oplist-item-description").text(op.description));
  }
}

$.getJSON(`data/ops.json` , function(data) {
  $("#data-info").text(`Parsed at: ${data.date_parsed}, based on: ${data.source_file} (${data.document_id}), ${data.document_version}`);
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
  document.getElementById("filter-value").addEventListener("keyup", () => {
    updateTable(data, (<HTMLInputElement>document.getElementById("filter-value")).value);
  });
  updateTable(data, "");
});
