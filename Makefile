extract_ops.js : extract_ops.ts
	tsc extract_ops.ts

run : extract_ops.js
	node extract_ops.js
