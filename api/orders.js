export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const WEBFLOW_TOKEN = process.env.WEBFLOW_TOKEN;
  const SITE_ID = process.env.WEBFLOW_SITE_ID;

  if (!WEBFLOW_TOKEN || !SITE_ID) {
    res.status(500).json({ error: 'Variables manquantes (WEBFLOW_TOKEN, WEBFLOW_SITE_ID)' });
    return;
  }

  try {
    let allOrders = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const r = await fetch(
        `https://api.webflow.com/v2/sites/${SITE_ID}/orders?limit=${limit}&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${WEBFLOW_TOKEN}`, 'accept-version': '1.0.0' } }
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        res.status(r.status).json({ error: err.message || `Erreur Webflow ${r.status}` });
        return;
      }
      const data = await r.json();
      const batch = data.orders || data.items || [];
      allOrders = allOrders.concat(batch);
      if (batch.length < limit) break;
      offset += limit;
      if (offset > 2000) break;
    }

    res.status(200).json({ orders: allOrders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
