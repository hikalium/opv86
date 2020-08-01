interface SDMInstr {
  opcode: string;
  opcode_parsed: string[];
  instr: string;
  instr_parsed: string[];
  op_en?: string;
  valid_in_64bit_mode?: boolean;
  valid_in_compatibility_mode?: boolean;
  valid_in_legacy_mode?: boolean;
  cpuid_feature_flag?: string;
  description: string;
}

