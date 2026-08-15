// Tests for the decoder in src/decoder.ts.
//
// It runs on the compiled gen/decoder.js, which has no reference to jQuery nor
// to the DOM, and on the same data/instr_list.json as the page. Run it with
// `make decodertest` (or `make test`) from the root of the repository.
'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// The lowest length pass rate on the fixture which is still considered a pass.
// The rate measured when the fixture was written is 99.46%, and the threshold
// is set a little below it so that a real regression fails the test.
const LENGTH_PASS_RATE_THRESHOLD = 0.98;
// The same for the mnemonic, which is a looser check: objdump and the SDM do
// not always use the same name for an instruction. The measured rate is
// 98.98%.
const MNEMONIC_MATCH_RATE_THRESHOLD = 0.96;

// gen/decoder.js is a plain script (tsc --outFile without modules), so it is
// loaded by evaluating it and taking the declarations it leaves behind.
function loadDecoder() {
  const file = path.join(rootDir, 'gen', 'decoder.js');
  if (!fs.existsSync(file)) {
    console.error(`${file} not found. Run 'make gen/decoder.js' first.`);
    process.exit(1);
  }
  const code = fs.readFileSync(file, 'utf8');
  return new Function(
      `${code}\nreturn {buildDecoderTable, decodeInstr, ByteType};`)();
}

const decoder = loadDecoder();
const instrList =
    JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'instr_list.json')));
const table = decoder.buildDecoderTable(instrList);

function decode(hex) {
  const bin = hex.replace(/ /g, '').match(/.{2}/g).map(s => parseInt(s, 16));
  return decoder.decodeInstr(bin, table);
}

// The type of each byte of an instruction, as a string like 'rex,op,modrm'.
function typesOf(decoded) {
  return decoded.bytes.map(b => b.byte_type).join(',');
}

function TestPrefixesAndRex() {
  // 48 83 ec 08: sub $0x8,%rsp. REX.W, opcode, ModRM, imm8.
  let d = decode('4883ec08');
  assert.equal(d.length, 4);
  assert.equal(d.mnemonic, 'SUB');
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,imm');
  // f0 48 0f b1 0f: lock cmpxchg %rcx,(%rdi). A legacy prefix, a REX and a
  // two-byte opcode.
  d = decode('f0480fb10f');
  assert.equal(d.length, 5);
  assert.equal(d.mnemonic, 'CMPXCHG');
  assert.equal(typesOf(d), 'prefix,rex-prefix,opcode,opcode,modrm');
  // f3 0f 1e fa: endbr64. The whole instruction is in the table, ModRM byte
  // included.
  d = decode('f30f1efa');
  assert.equal(d.length, 4);
  assert.equal(d.mnemonic, 'ENDBR64');
  // 90: nop, and f3 90: pause, which the mandatory prefix tells apart.
  assert.equal(decode('90').mnemonic, 'NOP');
  assert.equal(decode('f390').mnemonic, 'PAUSE');
}

function TestModRMAndSIBAndDisp() {
  // 48 8b 05 b1 df 01 00: mov 0x1dfb1(%rip),%rax. mod=00 rm=101 is
  // RIP-relative and brings a disp32.
  let d = decode('488b05b1df0100');
  assert.equal(d.length, 7);
  assert.equal(d.mnemonic, 'MOV');
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,disp,disp,disp,disp');
  // 48 8b 04 c8: mov (%rax,%rcx,8),%rax. mod=00 rm=100 brings a SIB byte and
  // no displacement.
  d = decode('488b04c8');
  assert.equal(d.length, 4);
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,sib');
  // 48 8b 04 25 10 00 00 00: mov 0x10,%rax. mod=00 rm=100 with base=101 in the
  // SIB byte brings a disp32.
  d = decode('488b042510000000');
  assert.equal(d.length, 8);
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,sib,disp,disp,disp,disp');
  // 48 8b 44 c8 10: mov 0x10(%rax,%rcx,8),%rax. mod=01 brings a disp8, after
  // the SIB byte.
  d = decode('488b44c810');
  assert.equal(d.length, 5);
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,sib,disp');
  // 8b 80 80 00 00 00: mov 0x80(%rax),%eax. mod=10 brings a disp32.
  d = decode('8b8080000000');
  assert.equal(d.length, 6);
  assert.equal(typesOf(d), 'opcode,modrm,disp,disp,disp,disp');
  // 48 89 e5: mov %rsp,%rbp. mod=11 brings nothing.
  d = decode('4889e5');
  assert.equal(d.length, 3);
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm');
}

function TestImmediate() {
  // c7 45 fc 01 00 00 00: movl $0x1,-0x4(%rbp). imm32.
  let d = decode('c745fc01000000');
  assert.equal(d.length, 7);
  assert.equal(d.mnemonic, 'MOV');
  assert.equal(typesOf(d), 'opcode,modrm,disp,imm,imm,imm,imm');
  // 66 c7 45 fc 01 00: movw $0x1,-0x4(%rbp). The 66 prefix makes the same
  // immediate 16-bit.
  d = decode('66c745fc0100');
  assert.equal(d.length, 6);
  assert.equal(typesOf(d), 'prefix,opcode,modrm,disp,imm,imm');
  // 48 b8 ..: movabs $imm64,%rax. REX.W picks the imm64 form of B8+rd.
  d = decode('48b80102030405060708');
  assert.equal(d.length, 10);
  assert.equal(d.mnemonic, 'MOV');
  // b8 ..: mov $imm32,%eax, the same opcode without REX.W.
  d = decode('b801020304');
  assert.equal(d.length, 5);
  // 6a 00: push $0x0, an imm8 which the 66 prefix must not resize.
  assert.equal(decode('6a00').length, 2);
  // c8 10 00 00: enter $0x10,$0x0. iw followed by ib, and the iw is a fixed
  // 16-bit one which no 66 prefix resizes.
  assert.equal(decode('c8100000').length, 4);
  assert.equal(decode('66c8100000').length, 5);
}

function TestJumps() {
  // 74 02: je. rel8.
  let d = decode('7402');
  assert.equal(d.length, 2);
  assert.equal(typesOf(d), 'opcode,imm');
  // e8 00 00 00 00: call rel32.
  d = decode('e800000000');
  assert.equal(d.length, 5);
  assert.equal(d.mnemonic, 'CALL');
  // 0f 84 00 00 00 00: je rel32, a two-byte opcode with a rel32.
  d = decode('0f8400000000');
  assert.equal(d.length, 6);
  assert.equal(typesOf(d), 'opcode,opcode,imm,imm,imm,imm');
  // ff 25 00 00 00 00: jmp *0x0(%rip). The /4 of the group picks JMP.
  d = decode('ff2500000000');
  assert.equal(d.length, 6);
  assert.equal(d.mnemonic, 'JMP');
  // The same opcode with /2 is CALL and with /6 is PUSH.
  assert.equal(decode('ff1500000000').mnemonic, 'CALL');
  assert.equal(decode('ff3500000000').mnemonic, 'PUSH');
}

function TestGroupsAndThreeByteOpcodes() {
  // f7 /0 has an imm32 while f7 /3 has none: the reg field of the ModRM byte
  // selects the entry.
  let d = decode('f7c001000000');
  assert.equal(d.length, 6);
  assert.equal(d.mnemonic, 'TEST');
  d = decode('f7d8');
  assert.equal(d.length, 2);
  assert.equal(d.mnemonic, 'NEG');
  // 66 0f 38 f6 c1: adcx %ecx,%eax. A three-byte opcode.
  d = decode('660f38f6c1');
  assert.equal(d.length, 5);
  assert.equal(d.mnemonic, 'ADCX');
  assert.equal(typesOf(d), 'prefix,opcode,opcode,opcode,modrm');
  // 66 0f 3a 0f c1 08: palignr $0x8,%xmm1,%xmm0. A three-byte opcode with an
  // imm8.
  d = decode('660f3a0fc108');
  assert.equal(d.length, 6);
  assert.equal(d.mnemonic, 'PALIGNR');
  // The mandatory prefix picks between the four instructions of 0f 58.
  assert.equal(decode('0f58c1').mnemonic, 'ADDPS');
  assert.equal(decode('660f58c1').mnemonic, 'ADDPD');
  assert.equal(decode('f30f58c1').mnemonic, 'ADDSS');
  assert.equal(decode('f20f58c1').mnemonic, 'ADDSD');
}

function TestVexAndEvex() {
  // c5 f8 57 c0: vxorps %xmm0,%xmm0,%xmm0. A two-byte VEX prefix.
  let d = decode('c5f857c0');
  assert.equal(d.length, 4);
  assert.equal(d.mnemonic, 'VXORPS');
  assert.equal(typesOf(d), 'vex-prefix,vex-prefix,opcode,modrm');
  // c4 e2 7d 18 05 00 00 00 00: vbroadcastss 0x0(%rip),%ymm0. A three-byte
  // VEX prefix, in the 0F38 map, with a RIP-relative operand.
  d = decode('c4e27d180500000000');
  assert.equal(d.length, 9);
  assert.equal(d.mnemonic, 'VBROADCASTSS');
  // c4 e3 7d 39 c1 01: vextracti128 $0x1,%ymm0,%xmm1. 0F3A map, with an imm8.
  d = decode('c4e37d39c101');
  assert.equal(d.length, 6);
  assert.equal(d.mnemonic, 'VEXTRACTI128');
  // 62 f1 7c 48 28 c1: vmovaps %zmm1,%zmm0. A four-byte EVEX prefix.
  d = decode('62f17c4828c1');
  assert.equal(d.length, 6);
  assert.equal(d.mnemonic, 'VMOVAPS');
  assert.equal(
      typesOf(d),
      'evex-prefix,evex-prefix,evex-prefix,evex-prefix,opcode,modrm');
}

function TestUnknownAndTruncated() {
  // An opcode which is in no entry of the SDM list is reported as such
  // instead of being decoded as something else.
  let d = decode('0f04');
  assert.equal(d.matched, false);
  assert.ok(d.note.indexOf('not in the SDM instruction list') !== -1);
  // A byte sequence which ends in the middle of an instruction is reported as
  // truncated, and the bytes it does have keep their type.
  d = decode('488b05b1df');
  assert.equal(d.matched, true);
  assert.equal(d.truncated, true);
  assert.equal(d.length, 5);
  assert.equal(typesOf(d), 'rex-prefix,opcode,modrm,disp,disp');
  // The bytes which follow the instruction are marked as unknown, and the
  // length says where it ends.
  d = decode('9090');
  assert.equal(d.length, 1);
  assert.equal(typesOf(d), 'opcode,unknown');
  // ff /7 is not documented: the closest entry of the group is shown, and the
  // note says that it is only the closest one.
  d = decode('ffff');
  assert.equal(d.matched, true);
  assert.equal(d.length, 2);
  assert.ok(d.note.indexOf('closest') !== -1);
  // A documented member of the same group has no such note.
  assert.equal(decode('ffc8').note, '');
}

// objdump prints the AT&T names, which carry a size suffix ('movl') and which
// are not always the name the SDM uses ('je' for JZ). The names below are the
// ones seen in the fixture whose SDM counterpart has another name.
const MNEMONIC_ALIASES = {
  'je': ['JZ', 'JE'],
  'jne': ['JNZ', 'JNE'],
  'jb': ['JC', 'JNAE', 'JB'],
  'jae': ['JNC', 'JNB', 'JAE'],
  'ja': ['JNBE', 'JA'],
  'jbe': ['JNA', 'JBE'],
  'jl': ['JNGE', 'JL'],
  'jge': ['JNL', 'JGE'],
  'jg': ['JNLE', 'JG'],
  'jle': ['JNG', 'JLE'],
  'jp': ['JPE', 'JP'],
  'jnp': ['JPO', 'JNP'],
  'cltq': ['CDQE'],
  'cltd': ['CDQ'],
  'cqto': ['CQO'],
  'cwtl': ['CWDE'],
  'cwtd': ['CWD'],
  'cbtw': ['CBW'],
  'movabs': ['MOV'],
  'movsl': ['MOVS', 'MOVSD'],
  'movsq': ['MOVS', 'MOVSQ'],
  'stos': ['STOS'],
  'cmpsb': ['CMPS', 'CMPSB'],
  'scas': ['SCAS'],
  'iret': ['IRET', 'IRETD', 'IRETQ'],
  'sysret': ['SYSRET'],
  'fxch': ['FXCH'],
  'fucomi': ['FUCOMI'],
  'xlat': ['XLAT', 'XLATB'],
  'ljmp': ['JMP'],
  'lcall': ['CALL'],
  'lret': ['RET'],
  'loopne': ['LOOPNE', 'LOOPNZ'],
  'loope': ['LOOPE', 'LOOPZ'],
  'sal': ['SAL', 'SHL'],
  'shl': ['SHL', 'SAL'],
  'xchg': ['XCHG', 'NOP'],
  'data16': ['NOP'],
  'nop': ['NOP', 'XCHG'],
  'endbr64': ['ENDBR64'],
  'ud2': ['UD2', 'UD'],
  'int3': ['INT3', 'INT'],
  'pushf': ['PUSHF', 'PUSHFQ'],
  'popf': ['POPF', 'POPFQ'],
  'cvtsi2ss': ['CVTSI2SS'],
  'cvtsi2sd': ['CVTSI2SD'],
  'jrcxz': ['JRCXZ', 'JECXZ'],
  'jecxz': ['JECXZ', 'JRCXZ'],
  // gas names the x87 forms which take ST(i) after the operand order it
  // prints, which is the other way round than the SDM: its 'fsub' is FSUBR.
  'fsub': ['FSUB', 'FSUBR'],
  'fsubr': ['FSUBR', 'FSUB'],
  'fsubp': ['FSUBP', 'FSUBRP'],
  'fsubrp': ['FSUBRP', 'FSUBP'],
  'fdiv': ['FDIV', 'FDIVR'],
  'fdivr': ['FDIVR', 'FDIV'],
  'fdivp': ['FDIVP', 'FDIVRP'],
  'fdivrp': ['FDIVRP', 'FDIVP'],
  'fwait': ['WAIT', 'FWAIT'],
  'wait': ['WAIT', 'FWAIT'],
};

function mnemonicMatches(sdmMnemonic, objdumpMnemonic) {
  if (!sdmMnemonic) return false;
  const sdm = sdmMnemonic.toUpperCase();
  let name = objdumpMnemonic.toLowerCase();
  // 'cs', 'bnd' and friends are dropped while the fixture is generated, and
  // the '.s' of e.g. 'mov.s' only says which encoding was used.
  name = name.replace(/\.s$/, '');
  const candidates = [name];
  // The AT&T size suffix, e.g. 'movl' for MOV or 'cmpxchgq' for CMPXCHG. The
  // x87 instructions use two letters for a 64-bit integer, as in 'fildll'.
  if (name.length > 2 && 'bwlqst'.indexOf(name[name.length - 1]) !== -1) {
    candidates.push(name.substr(0, name.length - 1));
  }
  if (name.length > 3 && name.substr(name.length - 2) === 'll') {
    candidates.push(name.substr(0, name.length - 2));
  }
  // 'movzbl' and 'movsbq' name the size of both of their operands, and
  // 'movslq' is MOVSXD.
  const movx = name.match(/^mov([zs])[bwl][wlq]$/);
  if (movx) candidates.push(movx[1] === 'z' ? 'movzx' : 'movsx');
  if (name === 'movslq') candidates.push('movsxd');
  // 'vpclmullqhqdq' and friends are all forms of VPCLMULQDQ.
  const pclmul = name.match(/^(v?)pclmul[lh]q[lh]qdq$/);
  if (pclmul) candidates.push(`${pclmul[1]}pclmulqdq`);
  // objdump writes the condition of (V)PCMP and of (V)CMPccPS in the name of
  // the instruction: 'vpcmpneqd' is VPCMPD with an immediate of 4, and
  // 'cmpltsd' is CMPSD with an immediate of 1.
  const vpcmp = name.match(/^(vpcmp)[a-z]+?(u?[bwdq])$/);
  if (vpcmp) candidates.push(`${vpcmp[1]}${vpcmp[2]}`);
  const cmpcc = name.match(/^(v?cmp)[a-z]+?(p[sd]|s[sd])$/);
  if (cmpcc) candidates.push(`${cmpcc[1]}${cmpcc[2]}`);
  for (const c of candidates) {
    if (c.toUpperCase() === sdm) return true;
    const aliases = MNEMONIC_ALIASES[c];
    if (aliases && aliases.indexOf(sdm) !== -1) return true;
  }
  return false;
}

function TestMnemonicMatches() {
  assert.ok(mnemonicMatches('MOV', 'movl'));
  assert.ok(mnemonicMatches('MOV', 'movq'));
  assert.ok(mnemonicMatches('MOV', 'movabs'));
  assert.ok(mnemonicMatches('JZ', 'je'));
  assert.ok(mnemonicMatches('RET', 'retq'));
  assert.ok(mnemonicMatches('NOP', 'nopw'));
  assert.ok(mnemonicMatches('VPXOR', 'vpxor'));
  assert.ok(!mnemonicMatches('MOV', 'lea'));
  assert.ok(!mnemonicMatches('', 'mov'));
}

function readFixture() {
  const file = path.join(rootDir, 'test', 'objdump_fixture.txt');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const cases = [];
  for (const line of lines) {
    if (line === '' || line[0] === '#') continue;
    const parts = line.split(' ');
    cases.push({bytes: parts[0], mnemonic: parts[1]});
  }
  return cases;
}

// Decodes every case of the fixture and checks that the decoder consumes
// exactly the bytes objdump gave to the instruction.
function TestAgainstObjdumpFixture() {
  const cases = readFixture();
  assert.ok(cases.length > 1000);
  let lengthOk = 0;
  let mnemonicOk = 0;
  const lengthFailures = {};
  const mnemonicFailures = {};
  for (const c of cases) {
    const d = decode(c.bytes);
    if (d.length === c.bytes.length / 2) {
      lengthOk++;
      // A wrong length makes the mnemonic meaningless, so only the cases
      // which have the right length can match.
      if (mnemonicMatches(d.mnemonic, c.mnemonic)) {
        mnemonicOk++;
      } else {
        const key = `${c.mnemonic} -> ${d.mnemonic || '?'}`;
        mnemonicFailures[key] = (mnemonicFailures[key] | 0) + 1;
      }
    } else {
      const key = `${c.mnemonic} (${d.note || 'wrong length'})`;
      lengthFailures[key] = (lengthFailures[key] | 0) + 1;
    }
  }
  const lengthRate = lengthOk / cases.length;
  const mnemonicRate = mnemonicOk / cases.length;
  const top = (failures) => Object.keys(failures)
                                .sort((a, b) => failures[b] - failures[a])
                                .slice(0, 10)
                                .map(k => `${k} x${failures[k]}`);
  console.log(`objdump fixture: ${cases.length} cases`);
  console.log(`  length matched:   ${lengthOk} (${
      (lengthRate * 100).toFixed(2)}%, threshold ${
      (LENGTH_PASS_RATE_THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`  mnemonic matched: ${mnemonicOk} (${
      (mnemonicRate * 100).toFixed(2)}%, threshold ${
      (MNEMONIC_MATCH_RATE_THRESHOLD * 100).toFixed(0)}%)`);
  if (lengthOk !== cases.length) {
    console.log(`  most common length failures: ${top(lengthFailures).join(', ')}`);
  }
  if (mnemonicOk !== lengthOk) {
    console.log(
        `  most common mnemonic failures: ${top(mnemonicFailures).join(', ')}`);
  }
  assert.ok(
      lengthRate >= LENGTH_PASS_RATE_THRESHOLD,
      `length pass rate ${(lengthRate * 100).toFixed(2)}% is below the ${
          (LENGTH_PASS_RATE_THRESHOLD * 100).toFixed(0)}% threshold`);
  assert.ok(
      mnemonicRate >= MNEMONIC_MATCH_RATE_THRESHOLD,
      `mnemonic match rate ${(mnemonicRate * 100).toFixed(2)}% is below the ${
          (MNEMONIC_MATCH_RATE_THRESHOLD * 100).toFixed(0)}% threshold`);
}

function runTest() {
  TestPrefixesAndRex();
  TestModRMAndSIBAndDisp();
  TestImmediate();
  TestJumps();
  TestGroupsAndThreeByteOpcodes();
  TestVexAndEvex();
  TestUnknownAndTruncated();
  TestMnemonicMatches();
  TestAgainstObjdumpFixture();
  console.log('PASS');
}

runTest();
