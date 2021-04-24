
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

enum ParserPhase {
  Op,
  ModRM,
  Disp,
  Imm,
}
enum ByteType {
  Unknown = 'unknown',
  Opcode = 'opcode',
  REXPrefix = 'rex-prefix',
  ModRM = 'modrm',
  Imm = 'imm',
  Disp = 'disp',
}
interface ParsedInstrByte {
  byte_value: number;
  byte_type: ByteType;
}
interface ParsedInstr {
  bytes: ParsedInstrByte[];
  instr: string;
  description: string;
}
