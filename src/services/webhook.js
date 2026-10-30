import { features } from '../config.js';
import { getOrderByMpId } from './orders.js';
import { verifyWebhookSignature } from './mercadopago.js';
import { checkMpOrder } from './payments.js';

/**
 * POST /webhook/mercadopago — notificação do Mercado Pago com assinatura verificada.
 * O corpo nunca libera nada sozinho: ele só dispara uma consulta oficial à API.
 */
export function handleMpWebhook(req, res, url, body) {
  let json = {};
  try { json = JSON.parse(body || '{}'); } catch { /* ignora */ }
  const dataId = url.searchParams.get('data.id') || json?.data?.id || null;
  const type = url.searchParams.get('type') || json?.type || json?.topic;

  const valid = features.webhook && verifyWebhookSignature({
    signature: req.headers['x-signature'],
    requestId: req.headers['x-request-id'],
    dataId: dataId ? String(dataId) : null,
  });
  if (!valid) {
    res.writeHead(401);
    return res.end('assinatura inválida');
  }
  res.writeHead(200);
  res.end('ok'); // responde rápido; o processamento continua

  if (type === 'payment' && dataId) {
    const order = getOrderByMpId(dataId);
    if (order) checkMpOrder(order).catch((e) => console.warn('[webhook]', e.message));
  }
  return null;
}
