/**
 * Reassembles public/index.html from the original HTML partials, replacing
 * the two things that only worked inside Google Apps Script's server-side
 * templating (HtmlService):
 *
 *   <?!= include('CSS_Theme') ?>          -> pastes that file's content in directly
 *   <script>...<?= initialPage ?>...</script>  -> reads ?page= from the URL in the browser instead
 *
 * Run this again any time you edit one of the files in src-partials/.
 *   node scripts/build-index.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src-partials');
const PUBLIC = path.join(ROOT, 'public');

let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');

// Replace each <?!= include('Name') ?> with that partial's raw content.
html = html.replace(/<\?!=\s*include\(\s*'([^']+)'\s*\)\s*\?>/g, (match, fileName) => {
  const partialPath = path.join(SRC, fileName + '.html');
  if (!fs.existsSync(partialPath)) {
    throw new Error('Missing partial referenced by include(): ' + fileName + '.html');
  }
  return fs.readFileSync(partialPath, 'utf8');
});

// The server used to inject ?page= via HtmlService templating; read it client-side instead.
html = html.replace(
  /<script>window\.__INITIAL_PAGE__ = "<\?= initialPage \?>";<\/script>/,
  `<script>window.__INITIAL_PAGE__ = new URLSearchParams(location.search).get('page') || 'dashboard';</script>`
);

// Load the google.script.run shim before any app code runs.
// A relative path works both through Express and when the generated preview is
// opened directly from disk.
html = html.replace('<head>', '<head>\n  <script src="./gas-shim.js"></script>');

if (!fs.existsSync(PUBLIC)) fs.mkdirSync(PUBLIC, { recursive: true });
fs.writeFileSync(path.join(PUBLIC, 'index.html'), html, 'utf8');
fs.copyFileSync(path.join(__dirname, 'gas-shim.js'), path.join(PUBLIC, 'gas-shim.js'));

console.log('Built public/index.html (' + (html.length / 1024).toFixed(0) + ' KB) and public/gas-shim.js');
