enum SDMInstrOpByteType {
  Opcode = "opcode",
  Imm = "imm",
}

interface SDMInstrOpByte {
  components: string[];
  byte_type?: string;
  byte_size_min: number;
  byte_size_max: number;
}

interface SDMInstr {
  opcode: string;
  opcode_parsed: string[];
  opcode_bytes: SDMInstrOpByte[];
  instr: string;
  instr_parsed: string[];
  op_en?: string;
  valid_in_64bit_mode?: boolean;
  valid_in_compatibility_mode?: boolean;
  valid_in_legacy_mode?: boolean;
  cpuid_feature_flag?: string;
  description: string;
  // The name of the SDM volume this instruction was parsed from, which is the
  // basename of the PDF (and of the XML) without the extension. The UI uses it
  // to link to the page of the right volume.
  document?: string;
  page?: number;
  matcher_opcode?: string;  // will be added on load
  matcher_instr?: string;   // will be added on load
}
