PARSERFLAGS:=

default: run

.PHONY : pdf/325383-sdm-vol-2abcd.xml

run : sdmparser.js
	-node sdmparser.js $(PARSERFLAGS)

update_pdf : pdf/325383-sdm-vol-2abcd.xml

pdf/325383-sdm-vol-2abcd.xml:
	cd pdf && wget -O 325383-sdm-vol-2abcd.pdf --user-agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.60 Safari/537.36" https://www.intel.com/content/dam/develop/public/us/en/documents/325383-sdm-vol-2abcd.pdf && pdftohtml -nodrm -xml 325383-sdm-vol-2abcd.pdf

debug : sdmparser.js
	node --inspect-brk sdmparser.js $(PARSERFLAGS)

unittest : sdmparser.js
	node sdmparser.js --runtest

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

op_table.json : sdmparser.js
	node sdmparser.js --gen-op-table-only

sdmparser.js : sdmparser.ts sdm_instr.ts
	tsc -target es2019 --out sdmparser.js sdmparser.ts sdm_instr.ts

install :
	-make
	cp instr_list.json ../data
