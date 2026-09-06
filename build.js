#!/usr/bin/env node
/* Bundles app/ into a single self-contained HTML file: dist/draft-command.html */
const fs = require('fs');
const path = require('path');
const app = path.join(__dirname, 'app');
let html = fs.readFileSync(path.join(app, 'index.html'), 'utf8');
for (const f of ['players.js', 'engine.js', 'app.js', 'chat.js']) {
  const src = fs.readFileSync(path.join(app, f), 'utf8').replace(/<\/script>/g, '<\\/script>');
  html = html.replace(`<script src="${f}"></script>`, `<script>\n${src}\n</script>`);
}
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'draft-command.html'), html);
// Artifact variant: no doctype/html/head/body wrapper (the artifact host supplies it).
const inner = html.replace(/^[\s\S]*?<head>/, '').replace(/<\/head>\s*<body>/, '').replace(/<\/body>\s*<\/html>\s*$/, '').replace(/<meta [^>]*>\s*/g, '');
fs.writeFileSync(path.join(__dirname, 'dist', 'draft-command.artifact.html'), inner);
console.log('built dist/draft-command.html (' + (html.length / 1024).toFixed(0) + ' KB)');
