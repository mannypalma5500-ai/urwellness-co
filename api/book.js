// Vercel Serverless Function — POST /api/book
// Creates a contact (or finds existing) then books an appointment in GHL.

const GHL_API_KEY   = process.env.GHL_API_KEY;
const CALENDAR_ID   = process.env.GHL_CALENDAR_ID;
const LOCATION_ID   = process.env.GHL_LOCATION_ID;
const TIMEZONE       = 'America/Los_Angeles';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const HEADERS  = {
  'Authorization': `Bearer ${GHL_API_KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
  'Accept':        'application/json',
};

// Duration of consultation in minutes (matches GHL calendar setting: 1hr 30min)
const DURATION_MIN = 90;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, phone, email, date, time, interest } = req.body || {};

  if (!name || !phone || !email || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields: name, phone, email, date, time' });
  }

  try {
    // ── 1. Upsert contact ──────────────────────────────────────────────
    const [firstName, ...lastParts] = name.trim().split(/\s+/);
    const lastName = lastParts.join(' ') || '';

    // Search for existing contact by email
    const searchRes = await fetch(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${LOCATION_ID}&email=${encodeURIComponent(email)}`,
      { method: 'GET', headers: HEADERS }
    );
    const searchData = await searchRes.json();
    let contactId = searchData?.contact?.id;

    if (!contactId) {
      // Create new contact
      const createRes = await fetch(`${GHL_BASE}/contacts/`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          locationId: LOCATION_ID,
          firstName,
          lastName,
          email,
          phone: phone.replace(/\D/g, '').replace(/^(\d{10})$/, '+1$1'),
          tags: ['clarity-lead', 'clarity-consultation-booked', 'source-organic-social'],
          source: 'Website Booking',
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error('GHL create contact error:', createRes.status, errText);
        return res.status(500).json({ error: 'Failed to create contact', detail: errText });
      }

      const createData = await createRes.json();
      contactId = createData?.contact?.id;
    } else {
      // Update existing contact with booking tag
      await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ tags: ['clarity-consultation-booked'] }),
      });
    }

    if (!contactId) {
      return res.status(500).json({ error: 'Could not resolve contact ID' });
    }

    // ── 2. Build appointment times ─────────────────────────────────────
    // time comes in as "9:00 AM", "1:30 PM", etc. — parse into ISO
    const [timePart, ampm] = time.split(' ');
    let [hours, minutes] = timePart.split(':').map(Number);
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    // Build a Date in PT by constructing in UTC then adjusting
    // (Vercel runs in UTC, so we send ISO strings and let GHL handle timezone)
    const startISO = `${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

    const startDate = new Date(`${startISO}-07:00`); // PDT offset (adjust for PST if needed)
    const endDate   = new Date(startDate.getTime() + DURATION_MIN * 60 * 1000);

    // ── 3. Create appointment ──────────────────────────────────────────
    const apptRes = await fetch(`${GHL_BASE}/calendars/events/appointments`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        calendarId: CALENDAR_ID,
        locationId: LOCATION_ID,
        contactId,
        startTime:  startDate.toISOString(),
        endTime:    endDate.toISOString(),
        title:      'CLARITY\u2122 Consultation',
        appointmentStatus: 'new',
        toNotify: true,
        notes: interest ? `Interest: ${interest}` : 'Booked via urwellness.co',
      }),
    });

    if (!apptRes.ok) {
      const errText = await apptRes.text();
      console.error('GHL create appointment error:', apptRes.status, errText);
      return res.status(500).json({ error: 'Failed to create appointment', detail: errText });
    }

    const apptData = await apptRes.json();

    return res.status(200).json({
      success: true,
      appointmentId: apptData?.id || apptData?.event?.id,
      contactId,
    });

  } catch (err) {
    console.error('Book endpoint error:', err);
    return res.status(500).json({ error: 'Server error creating appointment' });
  }
}
