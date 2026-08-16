
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

enum ByteType {
  Unknown = 'unknown',
  Prefix = 'prefix',
  Opcode = 'opcode',
  REXPrefix = 'rex-prefix',
  VEXPrefix = 'vex-prefix',
  EVEXPrefix = 'evex-prefix',
  ModRM = 'modrm',
  SIB = 'sib',
  Imm = 'imm',
  Disp = 'disp',
  // A byte which no instruction of the SDM can start with, shown as '(bad)'
  // in the same way as objdump does.
  Bad = 'bad',
}
