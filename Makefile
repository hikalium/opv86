gen/opv86.js : opv86.ts
	tsc --outFile $@  opv86.ts 

watch : 
	tsc -w --outFile $@  opv86.ts 

run : gen/opv86.js
	python3 -m http.server 8080
