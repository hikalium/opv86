dst/opv86.js : opv86.ts
	tsc --outFile $@  opv86.ts 

run : dst/opv86.js
	python3 -m http.server 8080
