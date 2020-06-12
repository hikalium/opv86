TSARGS=-target es2016 --out gen/opv86.js opv86.ts opinterface.ts

gen/opv86.js : opv86.ts
	tsc ${TSARGS}

watch : 
	tsc -w ${TSARGS}

run : gen/opv86.js
	python3 -m http.server 8080
