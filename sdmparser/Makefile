PARSERFLAGS:=

default: run

.PHONY : pdf/325383-sdm-vol-2abcd.xml

run : sdmparser.js
	npm i
	-node sdmparser.js $(PARSERFLAGS)

update_pdf : pdf/325383-sdm-vol-2abcd.xml

pdf/325383-sdm-vol-2abcd.xml:
	sudo apt install ca-certificates
	sudo apt install pdftohtml
	cd pdf && wget -O 325383-sdm-vol-2abcd.pdf --user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.60 Safari/537.36" https://cdrdv2.intel.com/v1/dl/getContent/671110 && pdftohtml -nodrm -xml 325383-sdm-vol-2abcd.pdf

debug : sdmparser.js
	node --inspect-brk sdmparser.js $(PARSERFLAGS)

unittest : sdmparser.js
	node sdmparser.js --runtest

# The mnemonics listed in the second half of the --mnemonic option below are
# the ones whose parsed result was compared with the rendered pages of
# 325383-092US (June 2026) row by row, and confirmed to match.
test : sdmparser.js
	make unittest
	node sdmparser.js --mnemonic \
		BT \
		SYSCALL SYSRET \
		ENTER LEAVE \
		AAA \
		INC DEC \
		ADD SUB MUL DIV CMP CMPXCHG \
		CDQ \
		IMUL \
		SETcc \
		FADD FSUB FMUL FDIV FCOMI \
		FLD FILD FSTP FXCH \
		FSTSW \
		XOR NOT AND OR TEST NEG \
		SAL SAR SHL SHR \
		SBB \
		CMOVcc MOV MOVSB MOVSX MOVZX LEA XCHG NOP \
		MOVSD \
		PUSH POP \
		JMP Jcc CALL RET \
		INT3 IRET UD \
		LGDT SGDT \
		CLFLUSH CLFLUSHOPT CLWB CLDEMOTE \
		MFENCE LFENCE SFENCE \
		STI CLI HLT PAUSE \
		OUT IN \
		CPUID \
		SCAS \
		REP \
		GF2P8AFFINEINVQB GF2P8AFFINEQB GF2P8MULB \
		SAHF \
		AAD ADDSD AESDEC256KL AESENCWIDE128KL \
		ANDPD BLSI BNDMOV BTS \
		CLTS CMPSD CVTPD2DQ CVTPS2PI \
		CVTTPD2PI DIVPD ENCODEKEY256 EXTRACTPS \
		FCOM FINIT FPATAN FSIN \
		FUCOM HADDPS INS KNOTW \
		KXNORW LKGS LSL MAXSD \
		MOVAPS MOVDQA MOVMSKPD MOVNTQ \
		MPSADBW ORPD PADDB PBLENDW \
		PCMPGTB PEXTRW PINSRW PMINUB \
		PMULHUW POR PSHUFLW PSRLW \
		PUNPCKLBW RDFSBASE RDSSPD ROUNDPS \
		SAVEPREVSSP SHA1RNDS4 SIDT STAC \
		STUI TCMMIMFP16PS TILESTORED UMWAIT \
		VADDPH VCMPSH VCVTNEEPH2PS VCVTPD2UQQ \
		VCVTPH2W VCVTQQ2PH VCVTSI2SH VCVTTPH2QQ \
		VCVTTSD2USI VCVTUQQ2PD VDBPSADBW VEXTRACTF128 \
		VFIXUPIMMPS VFMADD132SS VFMSUB132SD VFNMADD132SD \
		VFPCLASSPH VGATHERQPS VGETMANTPD VMASKMOV \
		VMULPH VPBROADCASTB VPCOMPRESSQ 'VPDPW[SU' \
		VPERMILPS VPEXPANDD VPMADD52LUQ VPMOVQD \
		VPSCATTERDD VPSRLVW VRANGESS VREDUCEPH \
		VRNDSCALEPS VRSQRTPH VSCALEFSS VSM3RNDS2 \
		VTESTPD WRFSBASE XACQUIRE XORPS \
		XSETBV 'GETSEC[SEXIT]' VEXP2PS VRCP28PS
	@echo "All tests passed."

format :
	sudo apt install clang-format
	clang-format -i sdmparser.ts

commit :
	make format
	make test
	git add ../
	git diff HEAD --color=always | less -R
	git commit

op_table.json : sdmparser.js
	node sdmparser.js --gen-op-table-only

sdmparser.js : sdmparser.ts sdm_instr.ts
	tsc -target es2019 --skipLibCheck --outFile sdmparser.js sdmparser.ts sdm_instr.ts

install :
	-make
	cp instr_list.json ../data
