// A decoder for x86_64 machine code.
//
// This file must not touch jQuery nor the DOM, so that it can be loaded from
// node (see test/decoder_test.js) as well as from the browser.
//
// The opcode table is not hardcoded here: it is derived from the instruction
// list parsed out of the Intel SDM (data/instr_list.json), so that the decoder
// follows the document instead of a second, hand-written copy of it.

// The encoding of an entry. VEX and EVEX entries are kept in the same table as
// the legacy ones, under a key of their own.
const ENC_LEGACY = 'legacy';
const ENC_VEX = 'vex';
const ENC_EVEX = 'evex';

// Constraints on the ModRM byte of an entry. mod is either MOD_ANY, MOD_REG
// (the entry needs mod == 11b) or MOD_MEM (the entry needs mod != 11b), and
// reg / rm are either the required value or REG_ANY.
const MOD_ANY = -1;
const MOD_MEM = -2;
const MOD_REG = 3;
const REG_ANY = -1;

interface DecoderOpEntry {
  mnemonic: string;
  instr: string;
  description: string;
  opcode: string;
  page?: number;
  encoding: string;
  // '' (nothing specified), 'NP' (no prefix allowed), '66', 'F2' or 'F3'.
  mandatory_prefix: string;
  requires_rex_w: boolean;
  // -1 when the entry ignores VEX.W / EVEX.W (WIG), 0 or 1 otherwise.
  vex_w: number;
  // The vector length the entry needs: -1 (LIG, any), 0 (128), 1 (256) or
  // 2 (512).
  vex_l: number;
  has_modrm: boolean;
  modrm_mod: number;
  modrm_reg: number;
  modrm_rm: number;
  // A ModRM byte which is written as a literal in the SDM (e.g. the 'C8' of
  // '0F 01 C8', MONITOR). -1 when the entry has no such byte. The range covers
  // the '+i' forms of the x87 instructions (e.g. 'D8 C0+i').
  modrm_value_min: number;
  modrm_value_max: number;
  imm_size: number;
  // True when the size of the immediate follows the operand size, i.e. the SDM
  // lists both an imm16 form and an imm32 form of the same opcode.
  imm_follows_operand_size: boolean;
  // 16 or 32 when the operands of the entry are of that size only (e.g.
  // 'ADD r/m16, imm16' is 16), 0 when they say nothing about it. The 66 prefix
  // tells the two apart.
  operand_size: number;
  valid_in_64bit_mode: boolean;
}

interface DecoderTable {
  [key: string]: DecoderOpEntry[];
}

interface DecodedInstrByte {
  byte_value: number;
  byte_type: ByteType;
  // What this byte is, for the legacy prefixes: 'LOCK', 'BND', 'REP', 'FS',
  // 'opsize' and so on. Empty for the other byte types.
  name?: string;
}

interface DecodedInstr {
  // One element per byte given to the decoder. The bytes after the end of the
  // instruction (byte_index >= length) are marked as unknown.
  bytes: DecodedInstrByte[];
  // How many bytes the instruction occupies.
  length: number;
  matched: boolean;
  truncated: boolean;
  // True when the bytes are not an instruction of the SDM at all. Such an
  // encoding is shown as '(bad)' and only the bytes up to and including the
  // opcode byte are consumed, so that the decode resynchronizes on the next
  // byte in the same way as objdump does.
  bad: boolean;
  mnemonic: string;
  instr: string;
  description: string;
  op?: DecoderOpEntry;
  // Why the decode is incomplete, for the cases which are out of scope.
  note: string;
}

function toHex2(v: number): string {
  return ('0' + v.toString(16)).substr(-2);
}

function isBranchMnemonic(mnemonic: string): boolean {
  return mnemonic === 'CALL' || mnemonic === 'RET' ||
      /^J[A-Z]+$/.test(mnemonic);
}

function legacyPrefixName(
    v: number, mnemonic: string, hasModRM: boolean,
    isMandatory: boolean): string {
  // Names the legacy prefixes the way objdump shows them. Which one a byte is
  // depends on the instruction it is attached to: F2 in front of a branch is
  // the BND prefix of MPX, and 3E in front of an indirect branch is the
  // NOTRACK prefix of CET, not a segment override.
  // Required by: 'f2 e9 d1 fd ff ff' (bnd jmp), '3e ff e0' (notrack jmp),
  // 'f0 0f b1 15 ...' (lock cmpxchg) and 'f3 ab' (rep stos) of a real binary.
  if (isMandatory) {
    // The byte is a part of the opcode, not a prefix of its own.
    return toHex2(v).toUpperCase();
  }
  if (v === 0xf0)
    return 'LOCK';
  if (v === 0xf2)
    return isBranchMnemonic(mnemonic) ? 'BND' : 'REPNE';
  if (v === 0xf3)
    return 'REP';
  if (v === 0x3e) {
    return (isBranchMnemonic(mnemonic) && hasModRM) ? 'NOTRACK' : 'DS';
  }
  if (v === 0x2e)
    return 'CS';
  if (v === 0x36)
    return 'SS';
  if (v === 0x26)
    return 'ES';
  if (v === 0x64)
    return 'FS';
  if (v === 0x65)
    return 'GS';
  if (v === 0x66)
    return 'opsize';
  if (v === 0x67)
    return 'addrsize';
  return 'prefix';
}

// The prefixes which objdump writes in front of the mnemonic.
const PREFIXES_SHOWN_WITH_INSTR = ['LOCK', 'BND', 'NOTRACK', 'REP', 'REPNE'];

function isLegacyPrefixByte(v: number): boolean {
  // Group 1: LOCK / REPNE / REP, group 2: the segment overrides,
  // group 3: operand size, group 4: address size.
  return v === 0xf0 || v === 0xf2 || v === 0xf3 || v === 0x2e || v === 0x36 ||
      v === 0x3e || v === 0x26 || v === 0x64 || v === 0x65 || v === 0x66 ||
      v === 0x67;
}

function makeEmptyOpEntry(): DecoderOpEntry {
  return {
    mnemonic: '',
    instr: '',
    description: '',
    opcode: '',
    encoding: ENC_LEGACY,
    mandatory_prefix: '',
    requires_rex_w: false,
    vex_w: -1,
    vex_l: -1,
    has_modrm: false,
    modrm_mod: MOD_ANY,
    modrm_reg: REG_ANY,
    modrm_rm: REG_ANY,
    modrm_value_min: -1,
    modrm_value_max: -1,
    imm_size: 0,
    imm_follows_operand_size: false,
    operand_size: 0,
    valid_in_64bit_mode: true,
  };
}

// Tells whether an entry is a 16-bit one or a 32-bit one, by the names its
// operands and its description use, so that a 66 prefix picks the right one of
// e.g. 'ADD r/m16, imm16' and 'ADD r/m32, imm32'. The description is only
// looked at when the operands say nothing, which is what happens to the
// instructions whose operands are all implicit (e.g. CBW and CWDE).
function operandSizeOf(operands: string[], description: string): number {
  for (const text of [operands.join(' '), description]) {
    const t = text.toLowerCase();
    const is16 = /\b(r16|m16|imm16|rel16|ax|cx|dx|bx|sp|bp|si|di)\b/.test(t);
    const is32 =
        /\b(r32|m32|imm32|rel32|eax|ecx|edx|ebx|esp|ebp|esi|edi)\b/.test(t);
    const is64 = /\b(r64|m64|imm64|rax|rcx|rdx|rsp|rbp|rsi|rdi)\b/.test(t);
    if (is16 && !is32 && !is64)
      return 16;
    if (is32 && !is16 && !is64)
      return 32;
    if (is16 || is32 || is64)
      return 0;
  }
  return 0;
}

// Reads the constraints which the SDM writes on the ModRM byte of an entry,
// e.g. '/r', '/2', '/vsib', '11:rrr:bbb', '!(11):001:bbb' or '(mod=11)'.
function applyModRMComponents(components: string[], e: DecoderOpEntry): void {
  e.has_modrm = true;
  for (const c of components) {
    const digit = c.match(/^\/([0-7])$/);
    if (digit) {
      e.modrm_reg = parseInt(digit[1], 10);
      continue;
    }
    const bits = c.match(/^(!?)\(?11\)?:(rrr|[01]{3}):(bbb|[01]{3})$/);
    if (bits) {
      e.modrm_mod = bits[1] === '!' ? MOD_MEM : MOD_REG;
      if (bits[2] !== 'rrr')
        e.modrm_reg = parseInt(bits[2], 2);
      if (bits[3] !== 'bbb')
        e.modrm_rm = parseInt(bits[3], 2);
      continue;
    }
    if (c.indexOf('mod!=11') !== -1) {
      e.modrm_mod = MOD_MEM;
      continue;
    }
    if (c.indexOf('mod=11') !== -1) {
      e.modrm_mod = MOD_REG;
      continue;
    }
    // '/r' and '/vsib' put no constraint on the byte.
  }
}

// Reads a VEX / EVEX prefix description like 'VEX.128.66.0F38.W0' or
// 'EVEX.512.F3.MAP5.W1' and fills the fields it implies.
function applyVexComponent(component: string, e: DecoderOpEntry): string {
  const fields = component.split('.');
  let map = '0f';
  for (const f of fields) {
    const u = f.toUpperCase();
    if (u === '66' || u === 'F2' || u === 'F3') {
      e.mandatory_prefix = u;
    } else if (u === 'NP') {
      e.mandatory_prefix = 'NP';
    } else if (u === '0F' || u === '0F38' || u === '0F3A') {
      map = u.toLowerCase();
    } else if (u === 'MAP5' || u === 'MAP6') {
      map = u.toLowerCase();
    } else if (u === 'W0') {
      e.vex_w = 0;
    } else if (u === 'W1') {
      e.vex_w = 1;
    } else if (u === '128' || u === 'LZ' || u === 'L0') {
      e.vex_l = 0;
    } else if (u === '256' || u === 'L1') {
      e.vex_l = 1;
    } else if (u === '512') {
      e.vex_l = 2;
    }
  }
  if (e.mandatory_prefix === '')
    e.mandatory_prefix = 'NP';
  return map;
}

// The opcode column of the SDM does not always mention every byte which an
// instruction takes: SETcc is written as '0F 94' although it is followed by a
// ModRM byte, and 'A1' (MOV RAX, moffs64) does not say that an address follows
// the opcode either. Fill those in from what the operands say.
function applyOperandHints(operands: string[], e: DecoderOpEntry): void {
  for (const raw of operands) {
    const op = raw.toLowerCase();
    // An operand written as 'r/m8' or 'xmm2/m128' is addressed by a ModRM
    // byte. The implicit memory operand of the string instructions (the 'm8'
    // of 'STOS m8') is not, so only the '/m' forms count here.
    if (!e.has_modrm && op.indexOf('/m') !== -1)
      e.has_modrm = true;
    if (e.imm_size !== 0)
      continue;
    // moffs is an absolute address which follows the opcode. Only its 64-bit
    // mode form, which is 8 bytes long, is decoded here.
    if (op.indexOf('moffs') === 0)
      e.imm_size = 8;
    const rel = op.match(/^rel(8|16|32)$/);
    if (rel) {
      e.imm_size = parseInt(rel[1], 10) / 8;
      e.imm_follows_operand_size = e.imm_size !== 1;
    }
  }
}

// Builds the decoder table out of the instruction list parsed from the SDM.
// The key of an entry is 'encoding:map:opcode', e.g. 'legacy::c7',
// 'legacy:0f38:f6' or 'vex:0f3a:df', and one key holds every entry which
// shares that opcode (the mandatory prefix, REX.W and the ModRM byte tell them
// apart later, in scoreOpEntry()).
function buildDecoderTable(instrList: SDMInstr[]): DecoderTable {
  const table: DecoderTable = {};
  for (const instr of instrList) {
    const e = makeEmptyOpEntry();
    const words = instr.instr_parsed ? instr.instr_parsed : [];
    // The SDM lists the repeated string instructions under their prefix
    // (e.g. 'REP STOS m8'), but the mnemonic of that row is STOS.
    let mnemonicIndex = 0;
    if (words.length > 1 &&
        ['REP', 'REPE', 'REPZ', 'REPNE', 'REPNZ',
         'LOCK'].indexOf(words[0].toUpperCase()) !== -1) {
      mnemonicIndex = 1;
    }
    e.mnemonic = words[mnemonicIndex] ? words[mnemonicIndex].toUpperCase() : '';
    e.instr = instr.instr;
    e.description = instr.description;
    e.opcode = instr.opcode;
    e.page = instr.page;
    e.valid_in_64bit_mode = instr.valid_in_64bit_mode !== false;
    // The literal opcode bytes of the entry, in the order they appear.
    const opcodeBytes: {value: number, plus: boolean}[] = [];
    let vexMap = '';
    let immComponents: string[] = [];
    let unsupported = false;
    let hasModRMComponent = false;
    for (const b of instr.opcode_bytes) {
      const components = b.components;
      const type = b.byte_type;
      if (!type) {
        // A component which takes no byte: 'NP', 'NFx' or a precondition on a
        // register like the '(EAX = 0)' of GETSEC.
        if (components[0] === 'NP')
          e.mandatory_prefix = 'NP';
        continue;
      }
      if (type === 'rex-prefix') {
        if (components[0].toUpperCase() === 'REX.W')
          e.requires_rex_w = true;
        continue;
      }
      if (type === 'vex-prefix') {
        e.encoding = ENC_VEX;
        vexMap = applyVexComponent(components[0], e);
        continue;
      }
      if (type === 'evex-prefix') {
        e.encoding = ENC_EVEX;
        vexMap = applyVexComponent(components[0], e);
        continue;
      }
      if (type === 'modrm') {
        applyModRMComponents(components, e);
        hasModRMComponent = true;
        continue;
      }
      if (type === 'imm') {
        e.imm_size += b.byte_size_min;
        immComponents = immComponents.concat(components);
        continue;
      }
      if (type === 'opcode') {
        const value = parseInt(components[0], 16);
        if (isNaN(value)) {
          unsupported = true;
          continue;
        }
        opcodeBytes.push({
          value: value,
          plus: components.length > 1 && components[1][0] === '+',
        });
        continue;
      }
    }
    if (unsupported || opcodeBytes.length === 0)
      continue;
    let map = vexMap;
    let i = 0;
    if (e.encoding === ENC_LEGACY) {
      // A 66 / F2 / F3 in front of the opcode is a mandatory prefix, not an
      // opcode byte of its own.
      while (i < opcodeBytes.length - 1 && !opcodeBytes[i].plus) {
        const v = opcodeBytes[i].value;
        if (v !== 0x66 && v !== 0xf2 && v !== 0xf3)
          break;
        e.mandatory_prefix = toHex2(v).toUpperCase();
        i++;
      }
      map = '';
      if (i < opcodeBytes.length - 1 && opcodeBytes[i].value === 0x0f &&
          !opcodeBytes[i].plus) {
        map = '0f';
        i++;
        if (i < opcodeBytes.length - 1 && !opcodeBytes[i].plus) {
          if (opcodeBytes[i].value === 0x38) {
            map = '0f38';
            i++;
          } else if (opcodeBytes[i].value === 0x3a) {
            map = '0f3a';
            i++;
          }
        }
      }
    }
    const primary = opcodeBytes[i];
    i++;
    // A byte which is left after the opcode is a ModRM byte written as a
    // literal (e.g. the 'C8' of '0F 01 C8' or the 'C0+i' of 'D8 C0+i').
    if (i < opcodeBytes.length && !hasModRMComponent) {
      e.has_modrm = true;
      e.modrm_value_min = opcodeBytes[i].value;
      e.modrm_value_max = opcodeBytes[i].value + (opcodeBytes[i].plus ? 7 : 0);
      i++;
    }
    // Anything left means that the first byte is not an opcode but a prefix of
    // its own: the entries which look like this are the x87 ones which wait
    // first ('9B DB E2' FCLEX, '9B DD /6' FSAVE, ...). Skip them, so that the
    // 9B is decoded as the WAIT instruction it also is, followed by the x87
    // instruction itself.
    if (i < opcodeBytes.length)
      continue;
    // 'ib' of an instruction which has no imm16 form is always one byte, but
    // 'id' / 'cd' follow the operand size when the SDM lists an imm16 form of
    // the same opcode as well. Whether it does is checked below, once every
    // entry of the key is known.
    const opSizeDependent = immComponents.length === 1 &&
        (immComponents[0] === 'iw' || immComponents[0] === 'id' ||
         immComponents[0] === 'cw' || immComponents[0] === 'cd');
    e.imm_follows_operand_size = opSizeDependent;
    const operands = words.slice(mnemonicIndex + 1);
    applyOperandHints(operands, e);
    e.operand_size = operandSizeOf(operands, instr.description);
    const keyBase = `${e.encoding}:${map}:`;
    // '+rd' and friends embed the register number in the low 3 bits of the
    // opcode, so the entry covers 8 opcodes.
    const count = primary.plus ? 8 : 1;
    for (let n = 0; n < count; n++) {
      const key = keyBase + toHex2(primary.value + n);
      if (!table[key])
        table[key] = [];
      table[key].push(e);
    }
  }
  markOperandSizeDependentImm(table);
  return table;
}

// Keeps imm_follows_operand_size only on the entries whose opcode really has
// both an imm16 form and an imm32 form (e.g. '81 /0 iw' and '81 /0 id'), so
// that a fixed 16-bit immediate like the one of 'C8 iw ib' (ENTER) is not
// resized by a 66 prefix.
function markOperandSizeDependentImm(table: DecoderTable): void {
  for (const key of Object.keys(table)) {
    const entries = table[key];
    for (const e of entries) {
      if (!e.imm_follows_operand_size)
        continue;
      let hasSibling = false;
      for (const other of entries) {
        if (other === e || !other.imm_follows_operand_size)
          continue;
        if (other.modrm_reg !== e.modrm_reg)
          continue;
        if (other.requires_rex_w !== e.requires_rex_w)
          continue;
        if (other.imm_size !== e.imm_size)
          hasSibling = true;
      }
      if (!hasSibling)
        e.imm_follows_operand_size = false;
    }
  }
}

interface DecoderContext {
  mandatory_prefix: string;
  operand_size_16: boolean;
  rex_w: boolean;
  encoding: string;
  vex_w: number;
  vex_l: number;
  // The ModRM byte which follows the opcode, or -1 if there is no byte left.
  modrm: number;
}

// Gives a score to an entry which shares its opcode with the others, so that
// the one which fits the prefixes and the ModRM byte of the input wins. A
// mismatch is a penalty and not a rejection: an entry with a roughly right
// shape still gives the right length, which is better than giving up.
function scoreOpEntry(e: DecoderOpEntry, ctx: DecoderContext): number {
  if (e.encoding !== ctx.encoding)
    return -1000;
  let score = 0;
  if (e.mandatory_prefix === '') {
    score += 4;
  } else if (e.mandatory_prefix === ctx.mandatory_prefix) {
    score += 10;
  } else {
    score -= 8;
  }
  if (e.requires_rex_w) {
    score += ctx.rex_w ? 6 : -8;
  } else {
    score += ctx.rex_w ? -1 : 1;
  }
  if (e.vex_w >= 0 && ctx.vex_w >= 0) {
    score += e.vex_w === ctx.vex_w ? 4 : -8;
  }
  if (e.vex_l >= 0 && ctx.vex_l >= 0) {
    score += e.vex_l === ctx.vex_l ? 4 : -8;
  }
  score += e.valid_in_64bit_mode ? 2 : -6;
  if (e.has_modrm && ctx.modrm >= 0) {
    const mod = ctx.modrm >> 6;
    const reg = (ctx.modrm >> 3) & 7;
    const rm = ctx.modrm & 7;
    if (e.modrm_value_min >= 0) {
      score +=
          (ctx.modrm >= e.modrm_value_min && ctx.modrm <= e.modrm_value_max) ?
          8 :
          -20;
    }
    if (e.modrm_reg !== REG_ANY)
      score += e.modrm_reg === reg ? 6 : -20;
    if (e.modrm_rm !== REG_ANY)
      score += e.modrm_rm === rm ? 2 : -20;
    if (e.modrm_mod === MOD_REG)
      score += mod === 3 ? 3 : -20;
    if (e.modrm_mod === MOD_MEM)
      score += mod !== 3 ? 3 : -20;
  }
  if (e.imm_follows_operand_size) {
    score += e.imm_size === (ctx.operand_size_16 ? 2 : 4) ? 3 : 0;
  }
  if (e.operand_size === 16)
    score += ctx.operand_size_16 ? 3 : -3;
  if (e.operand_size === 32)
    score += ctx.operand_size_16 ? -3 : 2;
  return score;
}

// The best entry of the key, with the score it got: a negative score means
// that no entry really fits the bytes (e.g. an undocumented encoding of a
// group, like the /6 of the shift group) and that the entry is only the
// closest one.
function findOpEntry(table: DecoderTable, key: string, ctx: DecoderContext):
    {entry: DecoderOpEntry, score: number} {
  const entries = table[key];
  let best: DecoderOpEntry = null;
  let bestScore = -1000;
  if (entries) {
    for (const e of entries) {
      const score = scoreOpEntry(e, ctx);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
  }
  return {entry: best, score: bestScore};
}

// Whether every entry which shares this opcode is one which the SDM marks as
// invalid in 64-bit mode. An opcode which has a 64-bit form as well is not:
// 'E9 cw' (JMP rel16) is invalid in 64-bit mode, but '66 e9 dd 00' still
// decodes through its sibling 'E9 cd'.
// Required by: 'd4 0a' (AAM), whose only two forms 'D4 0A' and 'D4 ib' are
// both invalid in 64-bit mode (325383-092US, p.123). objdump prints '(bad)'.
function isInvalidIn64BitMode(
    table: DecoderTable, key: string, e: DecoderOpEntry): boolean {
  if (e.valid_in_64bit_mode)
    return false;
  for (const other of table[key]) {
    if (other.valid_in_64bit_mode)
      return false;
  }
  return true;
}

// Writes an opcode the way the SDM does, e.g. '8F', '0F 1C' or '0F 38 F6', for
// the message which says why an encoding is not an instruction.
function opcodeTextOf(map: string, opcode: number): string {
  const escape: {[key: string]: string} = {
    '': '',
    '0f': '0F ',
    '0f38': '0F 38 ',
    '0f3a': '0F 3A ',
    'map5': 'MAP5 ',
    'map6': 'MAP6 ',
  };
  const prefix = escape[map] !== undefined ? escape[map] : `${map} `;
  return prefix + toHex2(opcode).toUpperCase();
}

// Decodes the first instruction of bin. Every byte of bin is returned in
// bytes[], and the ones which are not part of the instruction (either because
// the instruction ends before them, or because the decode gave up) are marked
// as unknown.
function decodeInstr(bin: number[], table: DecoderTable): DecodedInstr {
  const types: ByteType[] = [];
  for (let i = 0; i < bin.length; i++)
    types.push(ByteType.Unknown);
  const result: DecodedInstr = {
    bytes: [],
    length: 0,
    matched: false,
    truncated: false,
    bad: false,
    mnemonic: '',
    instr: '?',
    description: '',
    note: '',
  };
  const names: string[] = [];
  for (let i = 0; i < bin.length; i++)
    names.push('');
  const finish = (length: number) => {
    for (let i = 0; i < bin.length; i++) {
      result.bytes.push({
        byte_value: bin[i],
        byte_type: i < length ? types[i] : ByteType.Unknown,
        name: i < length ? names[i] : '',
      });
    }
    result.length = length;
    return result;
  };
  // Gives up on the bytes read so far, because the SDM has no instruction
  // which they can be the beginning of. Everything up to and including the
  // opcode byte is consumed and the next byte starts a new instruction, which
  // is what objdump does as well ('66 8f 77 e8' is 'data16 (bad)' followed by
  // 'ja', not one three-byte instruction).
  const invalid = (note: string, length: number) => {
    result.bad = true;
    result.matched = false;
    result.instr = '(bad)';
    result.mnemonic = '';
    result.description = '';
    result.note = note;
    for (let n = 0; n < length; n++) {
      types[n] = ByteType.Bad;
      names[n] = '';
    }
    return finish(Math.max(length, 1));
  };
  let i = 0;
  let has66 = false;
  let hasF2 = false;
  let hasF3 = false;
  const prefixIndices: number[] = [];
  while (i < bin.length && isLegacyPrefixByte(bin[i])) {
    if (bin[i] === 0x66)
      has66 = true;
    if (bin[i] === 0xf2)
      hasF2 = true;
    if (bin[i] === 0xf3)
      hasF3 = true;
    types[i] = ByteType.Prefix;
    names[i] = legacyPrefixName(bin[i], '', false, false);
    prefixIndices.push(i);
    i++;
    if (i >= 15)
      break;  // An instruction is never longer than 15 bytes.
  }
  const ctx: DecoderContext = {
    mandatory_prefix: hasF3 ? 'F3' :
        hasF2               ? 'F2' :
        has66               ? '66' :
                              'NP',
    operand_size_16: has66,
    rex_w: false,
    encoding: ENC_LEGACY,
    vex_w: -1,
    vex_l: -1,
    modrm: -1,
  };
  // A REX prefix takes effect only when it immediately precedes the opcode or
  // the 0F escape byte: 'A REX prefix is ignored, as are its individual bits,
  // when it is not needed for an instruction or when it does not immediately
  // precede the opcode byte or the escape opcode byte (0FH)' (325383-092US,
  // 2.2.1). So keep reading the prefixes after one, and only the last REX
  // counts. objdump prints such an ignored REX as an instruction of its own
  // ('4c 36 94' is 'rex.WR' followed by 'xchg'), but a processor consumes the
  // three bytes as one instruction with the REX ignored.
  while (i < bin.length &&
         ((bin[i] & 0xf0) === 0x40 || isLegacyPrefixByte(bin[i]))) {
    if (isLegacyPrefixByte(bin[i])) {
      if (bin[i] === 0x66)
        has66 = true;
      if (bin[i] === 0xf2)
        hasF2 = true;
      if (bin[i] === 0xf3)
        hasF3 = true;
      types[i] = ByteType.Prefix;
      names[i] = legacyPrefixName(bin[i], '', false, false);
      prefixIndices.push(i);
      // The REX which was read before this prefix has no effect.
      ctx.rex_w = false;
      ctx.mandatory_prefix = hasF3 ? 'F3' : hasF2 ? 'F2' : has66 ? '66' : 'NP';
      ctx.operand_size_16 = has66;
      i++;
      continue;
    }
    types[i] = ByteType.REXPrefix;
    names[i] = 'REX';
    ctx.rex_w = (bin[i] & 0x08) !== 0;
    i++;
  }
  if (i >= bin.length) {
    result.truncated = true;
    result.note = 'no opcode byte';
    return finish(i);
  }
  let map = '';
  const first = bin[i];
  if (first === 0xc5 || first === 0xc4 || first === 0x62) {
    // VEX (C5: 2 bytes, C4: 3 bytes) and EVEX (62: 4 bytes). In 64-bit mode
    // these bytes are always a prefix: their legacy meanings (LDS, LES and
    // BOUND) are not valid there.
    const prefixLength = first === 0xc5 ? 2 : first === 0xc4 ? 3 : 4;
    if (i + prefixLength > bin.length) {
      result.truncated = true;
      result.note = 'truncated VEX/EVEX prefix';
      return finish(bin.length);
    }
    const type = first === 0x62 ? ByteType.EVEXPrefix : ByteType.VEXPrefix;
    for (let n = 0; n < prefixLength; n++)
      types[i + n] = type;
    let pp = 0;
    let mmmmm = 1;
    if (first === 0xc5) {
      pp = bin[i + 1] & 3;
      // The two-byte VEX prefix is the C4 one with X, B and W set to 0.
      ctx.vex_w = 0;
      ctx.vex_l = (bin[i + 1] >> 2) & 1;
      ctx.encoding = ENC_VEX;
    } else if (first === 0xc4) {
      mmmmm = bin[i + 1] & 0x1f;
      pp = bin[i + 2] & 3;
      ctx.vex_w = (bin[i + 2] >> 7) & 1;
      ctx.vex_l = (bin[i + 2] >> 2) & 1;
      ctx.encoding = ENC_VEX;
    } else {
      mmmmm = bin[i + 1] & 0x07;
      pp = bin[i + 2] & 3;
      ctx.vex_w = (bin[i + 2] >> 7) & 1;
      ctx.vex_l = (bin[i + 3] >> 5) & 3;
      // With the b bit set on a register form, EVEX.L'L is the rounding mode
      // and the vector length is 512 bits.
      const isRegForm = i + 5 < bin.length && (bin[i + 5] >> 6) === 3;
      if ((bin[i + 3] & 0x10) !== 0 && isRegForm)
        ctx.vex_l = 2;
      if (ctx.vex_l === 3)
        ctx.vex_l = -1;
      ctx.encoding = ENC_EVEX;
    }
    ctx.mandatory_prefix = ['NP', '66', 'F3', 'F2'][pp];
    ctx.operand_size_16 = false;
    map = {1: '0f', 2: '0f38', 3: '0f3a', 5: 'map5', 6: 'map6'}[mmmmm];
    i += prefixLength;
    if (map === undefined) {
      return invalid(`no instruction of the SDM uses VEX/EVEX map ${mmmmm}`, i);
    }
  } else {
    if (first === 0x0f) {
      types[i] = ByteType.Opcode;
      i++;
      map = '0f';
      if (i < bin.length && (bin[i] === 0x38 || bin[i] === 0x3a)) {
        map = bin[i] === 0x38 ? '0f38' : '0f3a';
        types[i] = ByteType.Opcode;
        i++;
      }
    }
  }
  if (i >= bin.length) {
    result.truncated = true;
    result.note = 'no opcode byte';
    return finish(i);
  }
  const opcode = bin[i];
  types[i] = ByteType.Opcode;
  i++;
  ctx.modrm = i < bin.length ? bin[i] : -1;
  const key = `${ctx.encoding}:${map}:${toHex2(opcode)}`;
  const found = findOpEntry(table, key, ctx);
  const e = found.entry;
  const opcodeText = opcodeTextOf(map, opcode);
  if (!e) {
    return invalid(`${opcodeText} is not an opcode of the SDM`, i);
  }
  // Checked before the score below, because an opcode which exists only
  // outside 64-bit mode also loses points for that and would otherwise be
  // reported with the vaguer message.
  if (isInvalidIn64BitMode(table, key, e)) {
    return invalid(`${opcodeText} (${e.instr}) is not valid in 64-bit mode`, i);
  }
  if (found.score < 0) {
    // Every entry of this opcode breaks a constraint of its own (the reg field
    // of the ModRM byte, the mandatory prefix, ...), so these bytes are not an
    // instruction of the SDM. Such an encoding may still do something on a
    // real processor -- 'c1 77 b6' is the undocumented '/6' of the shift group
    // and objdump prints 'shll' for it -- but Table A-6 of 325383-092US
    // (p.2419) leaves that column of the group empty, and this decoder follows
    // the document.
    const digit =
        (e.has_modrm && ctx.modrm >= 0) ? ` /${(ctx.modrm >> 3) & 7}` : '';
    return invalid(
        `no instruction of the SDM matches ${opcodeText}${digit}`, i);
  }
  result.matched = true;
  result.op = e;
  result.mnemonic = e.mnemonic;
  result.instr = e.instr;
  result.description = e.description;
  // Now that the instruction is known, the legacy prefixes can be named, and
  // the ones which objdump writes in front of the mnemonic are put in front of
  // the instruction as well (e.g. 'BND JMP rel32' for 'f2 e9 d1 fd ff ff').
  const shownPrefixes: string[] = [];
  for (const p of prefixIndices) {
    const isMandatory = e.mandatory_prefix === toHex2(bin[p]).toUpperCase();
    const name = legacyPrefixName(bin[p], e.mnemonic, e.has_modrm, isMandatory);
    names[p] = name;
    if (PREFIXES_SHOWN_WITH_INSTR.indexOf(name) !== -1 &&
        e.mnemonic.indexOf(name) === -1) {
      shownPrefixes.push(name);
    }
  }
  if (shownPrefixes.length) {
    result.instr = `${shownPrefixes.join(' ')} ${result.instr}`;
  }
  if (e.has_modrm) {
    if (i >= bin.length) {
      result.truncated = true;
      result.note = 'truncated ModRM byte';
      return finish(bin.length);
    }
    const modrm = bin[i];
    types[i] = ByteType.ModRM;
    i++;
    const mod = modrm >> 6;
    const rm = modrm & 7;
    let dispSize = 0;
    if (mod === 1)
      dispSize = 1;
    if (mod === 2)
      dispSize = 4;
    if (mod !== 3 && rm === 4) {
      // The SIB byte, which brings a disp32 of its own when it has no base
      // (mod == 00 and base == 101).
      if (i >= bin.length) {
        result.truncated = true;
        result.note = 'truncated SIB byte';
        return finish(bin.length);
      }
      const sib = bin[i];
      types[i] = ByteType.SIB;
      i++;
      if (mod === 0 && (sib & 7) === 5)
        dispSize = 4;
    } else if (mod === 0 && rm === 5) {
      // RIP-relative addressing in 64-bit mode.
      dispSize = 4;
    }
    for (let n = 0; n < dispSize; n++) {
      if (i >= bin.length) {
        result.truncated = true;
        result.note = 'truncated displacement';
        return finish(bin.length);
      }
      types[i] = ByteType.Disp;
      i++;
    }
  }
  let immSize = e.imm_size;
  if (e.imm_follows_operand_size)
    immSize = ctx.operand_size_16 ? 2 : 4;
  for (let n = 0; n < immSize; n++) {
    if (i >= bin.length) {
      result.truncated = true;
      result.note = 'truncated immediate';
      return finish(bin.length);
    }
    types[i] = ByteType.Imm;
    i++;
  }
  return finish(i);
}

// One instruction of a stream of bytes, with the offset it starts at.
interface DecodedInstrAtOffset {
  offset: number;
  decoded: DecodedInstr;
}

// How many instructions decodeAll() returns at most, so that a long input does
// not fill the page with rows.
const MAX_DECODED_INSTRS = 64;

// Decodes bin as a stream of instructions, the way a disassembler does. An
// encoding which is not an instruction of the SDM takes the bytes up to its
// opcode byte and the next one starts right after it, so that the rest of the
// stream is still decoded at the right boundaries.
function decodeAll(bin: number[], table: DecoderTable): DecodedInstrAtOffset[] {
  const result: DecodedInstrAtOffset[] = [];
  let offset = 0;
  while (offset < bin.length && result.length < MAX_DECODED_INSTRS) {
    const decoded = decodeInstr(bin.slice(offset), table);
    result.push({offset: offset, decoded: decoded});
    // A decode which consumed nothing would loop forever.
    offset += Math.max(decoded.length, 1);
  }
  return result;
}
