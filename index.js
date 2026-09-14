const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { callRpc } = require('./rpc');
const store = require('./store');
const logic = require('./logic');

const app = express();
const PORT = process.env.PORT || 3000;

/* ===================== LOGIN =====================
 * Plain HTTP Basic Auth. Set these in your hosting platform's environment
 * variable settings (e.g. Render's dashboard) — do NOT rely on the defaults
 * once this is reachable from the internet.
 */
const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || 'change-me-now';
if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) {
  console.log('  ⚠️  Using default login (admin / change-me-now). Set APP_USERNAME and');
  console.log('     APP_PASSWORD environment variables in your hosting platform before going live.');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (timingSafeEqualStr(user, APP_USERNAME) && timingSafeEqualStr(pass, APP_PASSWORD)) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="KGS ERP Lite"');
  res.status(401).send('Login required.');
});

app.use(express.json({ limit: '20mb' }));

app.post('/api/rpc', async (req, res) => {
  const { fn, args } = req.body || {};
  try {
    const result = await callRpc(fn, args);
    res.json({ result });
  } catch (err) {
    res.status(200).json({ error: (err && err.message) || String(err) });
  }
});

// Attachments now live in Postgres (Attachments table), not on disk —
// Render's free-tier filesystem is wiped on every restart/redeploy.
app.get('/attachments/:id', async (req, res) => {
  try {
    const file = await store.getAttachment(req.params.id);
    if (!file) return res.status(404).send('Not found.');
    res.set('Content-Type', file.MimeType || 'application/octet-stream');
    res.set('Content-Disposition', 'inline; filename="' + (file.FileName || 'attachment').replace(/"/g, '') + '"');
    res.send(file.Data);
  } catch (err) {
    res.status(500).send('Error reading attachment: ' + err.message);
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Ensure the schema exists before accepting traffic (idempotent — safe on every boot).
logic.whenSchemaReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('  KGS ERP Lite — cloud edition running');
      console.log('  Listening on port ' + PORT);
      console.log('  Database: Postgres (DATABASE_URL)');
      console.log('  Attachments: stored in the Attachments table');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('Failed to set up the database schema:', err);
    process.exit(1);
  });
