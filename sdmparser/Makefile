PARSERFLAGS:=

default: run

run : sdmparser.js
	node sdmparser.js $(PARSERFLAGS)

debug : sdmparser.js
	node --inspect-brk sdmparser.js $(PARSERFLAGS)

unittest : sdmparser.js
	node sdmparser.js --runtest

test : sdmparser.js
	make unittest
	node sdmparser.js --mnemonic \
		SYSCALL SYSRET \
		ENTER LEAVE \
		AAA \
		INC DEC \
		ADD SUB MUL DIV CMP \
		CDQ \
		IMUL \
		SETcc \
		FADD FSUB FMUL FDIV FCOMI \
		FLD FILD FSTP FXCH \
		FSTSW \
		XOR NOT AND OR TEST NEG \
		SAL SAR SHL SHR \
		SBB \
		MOV MOVSB MOVSX MOVZX LEA XCHG NOP \
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
		SAHF
	@echo "All tests passed."

format :
	clang-format -i sdmparser.ts

commit :
	make format
	make test
	git add ../
	git diff HEAD --color=always | less -R
	git commit

extract_ops.js : extract_ops.ts
	tsc extract_ops.ts

sdmparser.js : sdmparser.ts sdm_instr.ts
	tsc -target es2019 --out sdmparser.js sdmparser.ts sdm_instr.ts

install :
	-make
	cp instr_list.json ../data
