const https = require('https');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const SECRET = process.env.KUBO_SECRET;

function base64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken() {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  }));
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(header + '.' + payload);
  const signature = sign.sign(PRIVATE_KEY, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const jwt = header + '.' + payload + '.' + signature;

  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString();
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(j.error_description)); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function sheetsReq(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const bs = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'sheets.googleapis.com', path, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        ...(bs ? { 'Content-Length': Buffer.byteLength(bs) } : {}) }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); if (bs) req.write(bs); req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-kubo-secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PATCH,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH') {
    const provided = req.headers['x-kubo-secret'];
    if (!SECRET || provided !== SECRET) {
      res.status(401).json({ error: 'Non autorisé' });
      return;
    }
  }

  try {
    const token = await getAccessToken();
    const range = encodeURIComponent('Feuille 1!A:I');

    if (req.method === 'GET') {
      const data = await sheetsReq('GET', `/v4/spreadsheets/${SHEET_ID}/values/${range}`, token);
      const rows = data.values || [];
      const orders = rows.slice(1).map(row => ({
        id: row[0]||'', client: row[1]||'', phone: row[2]||'',
        total: row[3]||'—', dateKey: row[4]||'', pickupTime: row[5]||null,
        products: row[6] ? JSON.parse(row[6]) : [],
        source: row[7] || 'boutique',
        paid: row[8] === 'true'
      })).filter(o => o.dateKey);
      res.status(200).json({ orders });
      return;
    }

    if (req.method === 'POST') {
      const o = req.body;
      const row = [o.id, o.client, o.phone||'', o.total||'—', o.dateKey, o.pickupTime||'', JSON.stringify(o.products||[]), o.source||'boutique', o.paid ? 'true' : 'false'];
      await sheetsReq('POST',
        `/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        token, { values: [row] }
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'PATCH') {
      // Toggle paid status
      const { id, paid } = req.body;
      const data = await sheetsReq('GET', `/v4/spreadsheets/${SHEET_ID}/values/${range}`, token);
      const rows = data.values || [];
      const rowIndex = rows.findIndex((r, i) => i > 0 && r[0] === id);
      if (rowIndex === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const paidRange = encodeURIComponent(`Feuille 1!I${rowIndex + 1}`);
      await sheetsReq('PUT',
        `/v4/spreadsheets/${SHEET_ID}/values/${paidRange}?valueInputOption=RAW`,
        token, { values: [[paid ? 'true' : 'false']] }
      );
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      const data = await sheetsReq('GET', `/v4/spreadsheets/${SHEET_ID}/values/${range}`, token);
      const rows = data.values || [];
      const rowIndex = rows.findIndex((r, i) => i > 0 && r[0] === id);
      if (rowIndex === -1) { res.status(404).json({ error: 'Not found' }); return; }
      const meta = await sheetsReq('GET', `/v4/spreadsheets/${SHEET_ID}`, token);
      const sheetGid = meta.sheets[0].properties.sheetId;
      await sheetsReq('POST', `/v4/spreadsheets/${SHEET_ID}:batchUpdate`, token, {
        requests: [{ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex+1 } } }]
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
