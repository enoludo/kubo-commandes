const PWD = 'Miniloute2016';
const SECRET = process.env.KUBO_SECRET;

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { password } = req.body;

  if (!password || password !== PWD) {
    res.status(401).json({ error: 'Mot de passe incorrect' });
    return;
  }

  if (!SECRET) {
    res.status(500).json({ error: 'Secret non configuré' });
    return;
  }

  res.status(200).json({ token: SECRET });
}
