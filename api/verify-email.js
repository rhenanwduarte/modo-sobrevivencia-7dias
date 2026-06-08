/**
 * MODO SOBREVIVÊNCIA — Verify Email Endpoint
 * Verifica se email tem compra aprovada no Supabase
 * Mantém a service_role key fora do frontend
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.modosobrevivencia.online');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body || {};

    if (!email || !email.includes('@')) {
      return res.status(400).json({ authorized: false, error: 'Email inválido' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[verify-email] Variáveis Supabase não configuradas');
      return res.status(500).json({ authorized: false, error: 'Erro de configuração' });
    }

    const queryUrl = `${supabaseUrl}/rest/v1/purchases?email=eq.${encodeURIComponent(normalizedEmail)}&status=eq.approved&select=email,product_name,product_id,purchased_at&limit=1`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[verify-email] Erro Supabase:', err);
      return res.status(500).json({ authorized: false, error: 'Erro ao consultar banco' });
    }

    const rows = await response.json();

    if (!rows || rows.length === 0) {
      console.log(`[verify-email] ❌ Não encontrado: ${normalizedEmail}`);
      return res.status(200).json({ authorized: false });
    }

    const purchase = rows[0];
    console.log(`[verify-email] ✅ Acesso liberado: ${normalizedEmail} | ${purchase.product_name}`);

    return res.status(200).json({
      authorized: true,
      product: purchase.product_name,   // '7dias' ou '21dias'
      product_id: purchase.product_id,
      purchased_at: purchase.purchased_at,
    });

  } catch (err) {
    console.error('[verify-email] Erro inesperado:', err);
    return res.status(500).json({ authorized: false, error: 'Erro interno' });
  }
};
