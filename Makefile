SRCS=src/opv86.ts src/opinterface.ts

TSARGS=-target es2016 --out gen/opv86.js ${SRCS}

gen/opv86.js : ${SRCS}
	tsc ${TSARGS}

watch : 
	tsc -w ${TSARGS}

run : gen/opv86.js
	python3 -m http.server 8080
