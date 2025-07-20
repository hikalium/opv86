SRCS=src/opv86.ts src/opinterface.ts sdmparser/sdm_instr.ts

TSARGS=-target es2016 --outFile gen/opv86.js ${SRCS}

.PHONY : default 
default:
	make clean
	make gen/opv86.js
	make -C sdmparser install

.PHONY : test
test:
	make -C sdmparser test

gen/opv86.js : ${SRCS}
	tsc ${TSARGS}

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
