# decoder.ts comes first so that the constants it declares are initialized
# before the page starts to use them.
SRCS=src/decoder.ts src/opv86.ts src/opinterface.ts sdmparser/sdm_instr.ts
# The decoder alone, without the part which touches the DOM, so that the tests
# can load it from node.
DECODER_SRCS=src/decoder.ts src/opinterface.ts sdmparser/sdm_instr.ts

TSARGS=-target es2016 --outFile gen/opv86.js ${SRCS}

.PHONY : default
default:
	make clean
	make gen/opv86.js
	make gen/decoder.js
	make -C sdmparser install

.PHONY : test
test:
	make -C sdmparser test
	make decodertest

# Checks the decoder against the objdump output committed in test/.
.PHONY : decodertest
decodertest: gen/decoder.js
	node test/decoder_test.js

# Regenerates the fixture from the binaries of this machine with objdump. The
# fixture is committed, so this is only needed to refresh it.
.PHONY : fixture
fixture:
	node test/gen_objdump_fixture.js test/objdump_fixture.txt

gen/opv86.js : ${SRCS}
	tsc ${TSARGS}

gen/decoder.js : ${DECODER_SRCS}
	tsc -target es2016 --outFile gen/decoder.js ${DECODER_SRCS}

.PHONY : watch
watch :
	tsc -w ${TSARGS}

.PHONY : run
run : gen/opv86.js
	python3 -m http.server 8080

.PHONY : clean
clean :
	-rm data/*
	-rm gen/*

.PHONY : setup
setup :
	npm install -g typescript
