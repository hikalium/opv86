run : sdmparser.js
	node sdmparser.js

extract_ops.js : extract_ops.ts
	tsc extract_ops.ts

sdmparser.js : sdmparser.ts
	tsc -target es2016 --out sdmparser.js sdmparser.ts
