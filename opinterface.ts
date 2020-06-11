
interface Op {
  opcode: string;
  instr: string;
  op_en: string;
  valid_in_64: string;
  compat_legacy: string;
  description: string;
  page: number;
}

interface Result {
  source_file: string;
  date_parsed: string;
  document_id: string;
  document_version: string;
  ops: Op[];
}
