/**
 * MODO SOBREVIVÊNCIA — Hotmart Webhook Handler
 * Recebe confirmação de compra da Hotmart e dispara Purchase via CAPI
 * + Salva email no Supabase para autenticação do protocolo
 */

const crypto = require('crypto');

// ─── SUPABASE ────────────────────────────────────────────────────────────────

async function saveToSupabase(email, buyerName, productId, productName, transactionId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[SUPABASE] Variáveis não configuradas — pulando salvamento');
    return;
  }

  try {
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
        product_id: productId,
        product_name: productName,
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
  } catch (err) {
    console.error('[SUPABASE] Erro inesperado:', err.message);
  }
}

const PIXEL_ID     = process.env.META_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const API_VERSION  = 'v19.0';
const DEBUG        = process.env.DEBUG_MODE === 'true';

const PRODUCTS = {
  'M106019427D': {
    content_name: 'Protocolo 7 Dias — Modo Sobrevivência',
    content_ids:  ['protocolo-7dias'],
    value:        37.00,
  },
  'U106019773B': {
    content_name: 'Protocolo 21 Dias — Modo Sobrevivência',
    content_ids:  ['protocolo-21dias'],
    value:        97.00,
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

module.exports = async function handler(req, res) {
  // Responde imediatamente para evitar timeout da Hotmart
  res.status(200).json({ received: true });

  if (req.method !== 'POST') return;

  try {
    const body = req.body || {};
    if (DEBUG) console.log('[HOTMART WEBHOOK]', JSON.stringify(body, null, 2));

    const event = body.event || body.data?.event;
    if (event !== 'PURCHASE_APPROVED' && event !== 'PURCHASE_COMPLETE') {
      console.log('[WEBHOOK SKIP]', event);
      return;
    }

    const buyer    = body.data?.buyer    || {};
    const purchase = body.data?.purchase || {};
    const prod     = body.data?.product  || {};

    const productKey  = prod.id || prod.hottok || '';
    const productInfo = PRODUCTS[productKey] || {
      content_name: prod.name || 'Produto Modo Sobrevivência',
      content_ids:  [productKey || 'modo-sobrevivencia'],
      value:        purchase.price?.value || 0,
    };
    const productName = productKey === 'M106019427D' ? '7dias' :
                        productKey === 'U106019773B' ? '21dias' : 'unknown';

    // ── Salva no Supabase (autenticação do protocolo) ────────────────────
    if (buyer.email) {
      await saveToSupabase(
        buyer.email,
        buyer.name || null,
        productKey,
        productName,
        purchase.transaction || null
      );
    }

    const userData = {
      em:          buyer.email ? sha256(buyer.email) : undefined,
      ph:          buyer.phone ? sha256(normalizePhone(buyer.phone)) : undefined,
      fn:          buyer.name  ? sha256(buyer.name.split(' ')[0]) : undefined,
      ln:          buyer.name  ? sha256(buyer.name.split(' ').slice(1).join(' ')) : undefined,
      country:     sha256('br'),
      external_id: buyer.email ? sha256(buyer.email) : undefined,
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

    const response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('[PURCHASE SENT]', data);

  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
  }
};
