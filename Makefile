SRCS=src/opv86.ts src/opinterface.ts sdmparser/sdm_instr.ts

TSARGS=-target es2016 --out gen/opv86.js ${SRCS}

default:
	make clean
	make gen/opv86.js
	make -C sdmparser install

gen/opv86.js : ${SRCS}
	tsc ${TSARGS}

.PHONY : default watch run clean

watch : 
	tsc -w ${TSARGS}

run : gen/opv86.js
	python3 -m http.server 8080

clean :
	-rm data/*
	-rm gen/*
