/**
 * MODO SOBREVIVÊNCIA — Hotmart Webhook Handler
 * Recebe confirmação de compra da Hotmart
 * Salva email no Supabase + dispara Purchase via CAPI Meta
 */

const crypto = require('crypto');

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION  = 'v19.0';
const DEBUG        = process.env.DEBUG_MODE === 'true';

const PRODUCTS = {
  'M106019427D': {
    content_name: 'Protocolo 7 Dias — Modo Sobrevivência',
    content_ids:  ['protocolo-7dias'],
    value:        37.00,
    product_name: '7dias',
  },
  'U106019773B': {
    content_name: 'Protocolo 21 Dias — Modo Sobrevivência',
    content_ids:  ['protocolo-21dias'],
    value:        97.00,
    product_name: '21dias',
  },
};

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).toLowerCase().trim()).digest('hex');
}

function normalizePhone(phone) {
  if (!phone) return undefined;
  return phone.replace(/\D/g, '');
}

async function saveToSupabase(email, buyerName, productId, productName, transactionId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[SUPABASE] Variáveis não configuradas');
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/purchases`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      email: email.toLowerCase().trim(),
      buyer_name: buyerName || null,
      product_id: productId || null,
      product_name: productName || 'unknown',
      hotmart_transaction_id: transactionId || null,
      status: 'approved',
      purchased_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('[SUPABASE] Erro ao salvar:', err);
  } else {
    console.log(`[SUPABASE] ✅ Salvo: ${email} | ${productName}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    if (DEBUG) console.log('[HOTMART WEBHOOK]', JSON.stringify(body, null, 2));

    const event = body.event || body.data?.event;
    if (event !== 'PURCHASE_APPROVED' && event !== 'PURCHASE_COMPLETE') {
      console.log('[WEBHOOK SKIP]', event);
      return res.status(200).json({ received: true, skipped: true });
    }

    const buyer    = body.data?.buyer    || {};
    const purchase = body.data?.purchase || {};
    const prod     = body.data?.product  || {};

    const productKey  = String(prod.id || prod.hottok || '');
    const productInfo = PRODUCTS[productKey] || {
      content_name: prod.name || 'Produto Modo Sobrevivência',
      content_ids:  [productKey || 'modo-sobrevivencia'],
      value:        purchase.price?.value || 0,
      product_name: 'unknown',
    };

    const email = buyer.email || null;

    // ── Salva no Supabase ────────────────────────────────────────────────────
    if (email) {
      await saveToSupabase(
        email,
        buyer.name || null,
        productKey || null,
        productInfo.product_name,
        purchase.transaction || null
      );
    } else {
      console.error('[WEBHOOK] Email não encontrado no payload');
    }

    // ── Responde OK para Hotmart ─────────────────────────────────────────────
    res.status(200).json({ received: true });

    // ── Dispara CAPI Meta (após responder) ───────────────────────────────────
    if (!PIXEL_ID || !ACCESS_TOKEN) return;

    const userData = {
      em:          email       ? sha256(email)                                    : undefined,
      ph:          buyer.phone ? sha256(normalizePhone(buyer.phone))              : undefined,
      fn:          buyer.name  ? sha256(buyer.name.split(' ')[0])                 : undefined,
      ln:          buyer.name  ? sha256(buyer.name.split(' ').slice(1).join(' ')) : undefined,
      country:     sha256('br'),
      external_id: email       ? sha256(email)                                    : undefined,
    };

    const customData = {
      value:        purchase.price?.value || productInfo.value,
      currency:     'BRL',
      content_name: productInfo.content_name,
      content_type: 'product',
      content_ids:  productInfo.content_ids,
      order_id:     purchase.transaction || body.id || undefined,
    };

    const payload = {
      data: [{
        event_name:       'Purchase',
        event_time:       Math.floor(Date.now() / 1000),
        event_id:         `hotmart_${purchase.transaction || Date.now()}`,
        event_source_url: 'https://modosobrevivencia.online',
        action_source:    'website',
        user_data:        Object.fromEntries(Object.entries(userData).filter(([,v]) => v !== undefined)),
        custom_data:      Object.fromEntries(Object.entries(customData).filter(([,v]) => v !== undefined)),
      }],
    };

    if (DEBUG) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const metaRes = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await metaRes.json();
    console.log('[PURCHASE SENT]', data);

  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    if (!res.headersSent) res.status(200).json({ received: true });
  }
};
