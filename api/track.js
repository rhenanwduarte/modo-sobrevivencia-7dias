/**
 * MODO SOBREVIVÊNCIA — Meta CAPI Endpoint
 * Vercel Serverless Function
 * Recebe eventos do browser e envia para Meta Conversions API
 */

const crypto = require('crypto');

// ─── TRACKING CONFIG ────────────────────────────────────────────────────────
const TRACKING_CONFIG = {
  pixelId: process.env.META_PIXEL_ID,
  accessToken: process.env.META_ACCESS_TOKEN,
  apiVersion: 'v19.0',
  debug: process.env.DEBUG_MODE === 'true',

  events: {
    PageView:         { enabled: true },
    ViewContent:      { enabled: true },
    Lead:             { enabled: true },
    InitiateCheckout: { enabled: true },
    Purchase:         { enabled: true },
    Contact:          { enabled: true },
  },

  products: {
    'protocolo-7dias': {
      content_name: 'Protocolo 7 Dias — Modo Sobrevivência',
      content_type: 'product',
      content_ids:  ['protocolo-7dias'],
      value:        37.00,
      currency:     'BRL',
    },
    'protocolo-21dias': {
      content_name: 'Protocolo 21 Dias — Modo Sobrevivência',
      content_type: 'product',
      content_ids:  ['protocolo-21dias'],
      value:        97.00,
      currency:     'BRL',
    },
  },
};

// ─── HELPERS ────────────────────────────────────────────────────────────────

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return phone.replace(/\D/g, '');
}

function buildUserData(raw = {}, req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || undefined;

  return {
    em:          raw.email     ? sha256(raw.email)               : undefined,
    ph:          raw.phone     ? sha256(normalizePhone(raw.phone)): undefined,
    fn:          raw.firstName ? sha256(raw.firstName)            : undefined,
    ln:          raw.lastName  ? sha256(raw.lastName)             : undefined,
    ct:          raw.city      ? sha256(raw.city)                 : undefined,
    st:          raw.state     ? sha256(raw.state)                : undefined,
    country:     raw.country   ? sha256(raw.country || 'br')      : sha256('br'),
    zp:          raw.zip       ? sha256(raw.zip)                  : undefined,
    external_id: raw.externalId? sha256(raw.externalId)           : undefined,
    client_ip_address: ip,
    client_user_agent: req.headers['user-agent'] || undefined,
    fbp: raw.fbp || undefined,
    fbc: raw.fbc || undefined,
  };
}

function cleanUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ─── MAIN HANDLER ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    eventName,
    eventId,
    eventSourceUrl,
    userData = {},
    customData = {},
  } = req.body || {};

  // Validações
  if (!eventName) return res.status(400).json({ error: 'eventName is required' });
  if (!TRACKING_CONFIG.events[eventName]?.enabled) {
    return res.status(200).json({ skipped: true, reason: 'Event disabled in config' });
  }
  if (!TRACKING_CONFIG.pixelId || !TRACKING_CONFIG.accessToken) {
    return res.status(500).json({ error: 'Missing env vars META_PIXEL_ID or META_ACCESS_TOKEN' });
  }

  const payload = {
    data: [
      cleanUndefined({
        event_name:        eventName,
        event_time:        Math.floor(Date.now() / 1000),
        event_id:          eventId || crypto.randomUUID(),
        event_source_url:  eventSourceUrl || 'https://modosobrevivencia.online',
        action_source:     'website',
        user_data:         cleanUndefined(buildUserData(userData, req)),
        custom_data:       Object.keys(customData).length ? customData : undefined,
      }),
    ],
  };

  if (TRACKING_CONFIG.debug) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE || undefined;
    console.log('[CAPI DEBUG]', JSON.stringify(payload, null, 2));
  }

  const url = `https://graph.facebook.com/${TRACKING_CONFIG.apiVersion}/${TRACKING_CONFIG.pixelId}/events?access_token=${TRACKING_CONFIG.accessToken}`;

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[CAPI ERROR]', data);
      return res.status(500).json({ error: 'Meta API error', details: data });
    }

    return res.status(200).json({ success: true, events_received: data.events_received });

  } catch (err) {
    console.error('[CAPI FETCH ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
