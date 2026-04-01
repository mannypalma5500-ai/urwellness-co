// Vercel Serverless Function — GET /api/availability?date=2026-03-15
// Proxies GHL Calendar "Get Free Slots" API so the API key stays server-side.

const GHL_API_KEY   = process.env.GHL_API_KEY;           // pit-c44e1980-...
const CALENDAR_ID   = process.env.GHL_CALENDAR_ID;       // gzcQg6ifEhZ2S639dMKw
const LOCATION_ID   = process.env.GHL_LOCATION_ID;       // 8WkLEjLa4ogItor920Ci
const TIMEZONE       = 'America/Los_Angeles';

export default async function handler(req, res) {
  // CORS — allow our domain + localhost dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { date } = req.query;  // YYYY-MM-DD

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date param. Use YYYY-MM-DD.' });
  }

  // GHL free-slots wants a startDate and endDate (same day = single day query)
  const startDate = date;
  const endDate   = date;

  const url = `https://services.leadconnectorhq.com/calendars/${CALENDAR_ID}/free-slots`
    + `?startDate=${startDate}&endDate=${endDate}&timezone=${TIMEZONE}`;

  try {
    const ghlRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version':       '2021-07-28',
        'Accept':        'application/json',
      },
    });

    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      console.error('GHL free-slots error:', ghlRes.status, errText);
      return res.status(ghlRes.status).json({ error: 'GHL API error', detail: errText });
    }

    const data = await ghlRes.json();

    // GHL returns { "{calendarId}": { "YYYY-MM-DD": ["ISO_TIMESTAMP", ...] } }
    // or { "YYYY-MM-DD": ["ISO_TIMESTAMP", ...] }
    // Normalize to a flat array of readable time strings in PT
    let slots = [];

    // Try both response shapes
    const dateMap = data[CALENDAR_ID] || data;
    const rawSlots = dateMap[date] || [];

    slots = rawSlots.map(iso => {
      const d = new Date(iso);
      return d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: TIMEZONE,
      });
    });

    return res.status(200).json({ date, slots, raw: rawSlots });

  } catch (err) {
    console.error('Availability fetch failed:', err);
    return res.status(500).json({ error: 'Server error fetching availability' });
  }
}
