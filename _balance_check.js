// Quick brace-balance scan of the integration suite (string-aware, approximate).
const fs = require('fs');
const src = fs.readFileSync('scripts/verify.jhatka.integration.js', 'utf8');
let depth = 0;
let line = 1;
let inStr = null;
let prev = '';
for (const ch of src) {
  if (ch === '\n') { line += 1; prev = ''; continue; }
  if (inStr) {
    if (ch === inStr && prev !== '\\') inStr = null;
  } else if (ch === '"' || ch === "'" || ch === '`') {
    inStr = ch;
  } else if (ch === '{') {
    depth += 1;
  } else if (ch === '}') {
    depth -= 1;
    if (depth < 0) {
      console.log('NEGATIVE at line', line);
      depth = 0;
    }
  }
  prev = ch;
}
console.log('final depth:', depth);
