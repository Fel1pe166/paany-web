// Testes da lógica de negócio (sem Discord e sem internet): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DB_PATH = ':memory:';
process.env.MP_WEBHOOK_SECRET = 'segredo-teste';

const { openDb, one } = await import('../src/db.js');
openDb(':memory:');
const orders = await import('../src/services/orders.js');
const { buildPixCode, crc16 } = await import('../src/services/pix.js');
const { validateApproved, verifyWebhookSignature, mpDate } = await import('../src/services/mercadopago.js');
const { parsePrice } = await import('../src/util.js');

const product = (extra = {}) => orders.createProduct({
  name: 'VIP KingX', category: 'vip', price_cents: 800, delivery_type: 'cargo', role_id: '1', vip_days: 30, ...extra,
}, 'admin');

test('CRC16 do Pix bate com o exemplo oficial do Banco Central', () => {
  assert.equal(crc16('123456789'), '29B1');
  const exemplo = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
  assert.equal(crc16(exemplo), '1D3D');
});

test('código Pix copia e cola tem valor, txid e CRC válidos', () => {
  const code = buildPixCode({ key: 'loja@cutify.com', name: 'Cutífy Store', city: 'São Paulo', amountCents: 800, txid: 'CUT-ABCD1234' });
  assert.ok(code.includes('54048.00'));
  assert.ok(code.includes('0511CUTABCD1234'));
  assert.ok(code.includes('5912CUTIFY STORE'));
  assert.ok(code.includes('6009SAO PAULO'));
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
});

test('preços em reais', () => {
  assert.equal(parsePrice('8,00'), 800);
  assert.equal(parsePrice('R$ 1.234,56'), 123456);
  assert.equal(parsePrice('9.9'), 990);
  assert.equal(parsePrice('0'), null);
  assert.equal(parsePrice('abc'), null);
});

test('pedido duplicado é reaproveitado e limite de pendentes funciona', () => {
  const p = product();
  const a = orders.createOrder({ userId: 'u1', productId: p.id, method: 'mercadopago' });
  const b = orders.createOrder({ userId: 'u1', productId: p.id, method: 'mercadopago' });
  assert.equal(a.order.id, b.order.id);
  assert.equal(b.reused, true);
  orders.createOrder({ userId: 'u1', productId: p.id, method: 'pix_manual' });
  const p2 = product({ name: 'Outro' });
  orders.createOrder({ userId: 'u1', productId: p2.id, method: 'pix_manual' });
  const blocked = orders.createOrder({ userId: 'u1', productId: p2.id, method: 'mercadopago' });
  assert.match(blocked.error, /pedidos em aberto/);
});

test('confirmação é idempotente e confere o valor', () => {
  const p = product({ price_cents: 1000 });
  const { order } = orders.createOrder({ userId: 'u2', productId: p.id, method: 'mercadopago' });
  const wrong = orders.confirmPayment(order.id, { provider: 'mercadopago', providerId: '99', amountCents: 1 });
  assert.equal(wrong.changed, false);
  assert.match(wrong.reason, /Valor/);
  const first = orders.confirmPayment(order.id, { provider: 'mercadopago', providerId: '99', amountCents: 1000 });
  assert.equal(first.changed, true);
  assert.equal(first.order.status, 'pago');
  const again = orders.confirmPayment(order.id, { provider: 'mercadopago', providerId: '99', amountCents: 1000 });
  assert.equal(again.changed, false); // webhook repetido não entrega duas vezes
});

test('entrega só pode ser reservada uma vez e estoque baixa uma vez', () => {
  const p = product({ stock: 1, delivery_type: 'link', role_id: null });
  const { order } = orders.createOrder({ userId: 'u3', productId: p.id, method: 'pix_manual' });
  orders.confirmPayment(order.id, { provider: 'pix_manual', providerId: order.id, amountCents: order.total_cents, actorId: 'admin' });
  const claim1 = orders.claimDelivery(order.id);
  const claim2 = orders.claimDelivery(order.id);
  assert.ok(claim1);
  assert.equal(claim2, null);
  assert.equal(orders.takeStock(claim1), true);
  assert.equal(orders.takeStock(claim1), true);
  assert.equal(orders.getProduct(p.id).stock, 0);
  orders.finishDelivery(order.id, true);
  assert.equal(orders.getOrder(order.id).status, 'entregue');
  const sold = orders.createOrder({ userId: 'u9', productId: p.id, method: 'pix_manual' });
  assert.match(sold.error, /esgotado/);
});

test('falha de entrega permite nova tentativa sem nova cobrança', () => {
  const p = product({ delivery_type: 'texto', role_id: null });
  const { order } = orders.createOrder({ userId: 'u4', productId: p.id, method: 'pix_manual' });
  orders.confirmPayment(order.id, { provider: 'pix_manual', providerId: order.id, amountCents: order.total_cents });
  orders.claimDelivery(order.id);
  orders.finishDelivery(order.id, false, 'erro simulado');
  assert.equal(orders.getOrder(order.id).status, 'falha_entrega');
  assert.ok(orders.claimDelivery(order.id));
  assert.equal(one('SELECT COUNT(*) n FROM payment_events WHERE order_id = ?', order.id).n, 1);
});

test('cupons: desconto, uso único por cliente, limite e validade', () => {
  const p = product({ price_cents: 2000 });
  orders.createCoupon({ code: 'cutify10', type: 'percent', value: 10, max_uses: 2 }, 'admin');
  const ev = orders.evaluateCoupon('CUTIFY10', 'c1', p);
  assert.equal(ev.ok, true);
  assert.equal(ev.discount, 200);

  const { order } = orders.createOrder({ userId: 'c1', productId: p.id, method: 'pix_manual', couponCode: 'cutify10' });
  assert.equal(order.total_cents, 1800);
  assert.equal(orders.evaluateCoupon('CUTIFY10', 'c1', p).ok, false); // pedido pendente já usa
  orders.confirmPayment(order.id, { provider: 'pix_manual', providerId: order.id, amountCents: 1800 });
  assert.match(orders.evaluateCoupon('CUTIFY10', 'c1', p).reason, /já usou/);

  orders.createOrder({ userId: 'c2', productId: p.id, method: 'pix_manual', couponCode: 'CUTIFY10' });
  assert.match(orders.evaluateCoupon('CUTIFY10', 'c3', p).reason, /esgotou/);

  orders.createCoupon({ code: 'VELHO', type: 'fixed', value: 100, expires_at: Date.now() - 1000 }, 'admin');
  assert.match(orders.evaluateCoupon('VELHO', 'c1', p).reason, /expirou/);
  orders.createCoupon({ code: 'TUDO', type: 'fixed', value: 999999 }, 'admin');
  assert.equal(orders.evaluateCoupon('TUDO', 'c9', p).discount, 1900); // nunca deixa o Pix zerado
});

test('validação do pagamento aprovado do Mercado Pago', () => {
  const o = { id: 'CUT-X', total_cents: 800, mp_payment_id: '123' };
  assert.equal(validateApproved({ id: 123, status: 'approved', currency_id: 'BRL', external_reference: 'CUT-X', transaction_amount: 8 }, o).ok, true);
  assert.equal(validateApproved({ id: 123, status: 'pending', currency_id: 'BRL', external_reference: 'CUT-X', transaction_amount: 8 }, o).ok, false);
  assert.equal(validateApproved({ id: 123, status: 'approved', currency_id: 'BRL', external_reference: 'CUT-Y', transaction_amount: 8 }, o).ok, false);
  assert.equal(validateApproved({ id: 123, status: 'approved', currency_id: 'BRL', external_reference: 'CUT-X', transaction_amount: 0.01 }, o).ok, false);
  assert.equal(validateApproved({ id: 999, status: 'approved', currency_id: 'BRL', external_reference: 'CUT-X', transaction_amount: 8 }, o).ok, false);
});

test('assinatura do webhook do Mercado Pago', () => {
  const tsv = '1730000000';
  const manifest = `id:123456;request-id:req-1;ts:${tsv};`;
  const v1 = createHmac('sha256', 'segredo-teste').update(manifest).digest('hex');
  assert.equal(verifyWebhookSignature({ signature: `ts=${tsv},v1=${v1}`, requestId: 'req-1', dataId: '123456' }), true);
  assert.equal(verifyWebhookSignature({ signature: `ts=${tsv},v1=${v1}`, requestId: 'req-2', dataId: '123456' }), false);
  assert.equal(verifyWebhookSignature({ signature: `ts=${tsv},v1=abc`, requestId: 'req-1', dataId: '123456' }), false);
  assert.equal(verifyWebhookSignature({ signature: null, requestId: 'req-1', dataId: '1' }), false);
});

test('data de expiração no formato do Mercado Pago (Brasília)', () => {
  assert.equal(mpDate(Date.UTC(2026, 9, 27, 23, 30, 0)), '2026-10-27T20:30:00.000-03:00');
});

test('pedido expirado ainda pode ser confirmado se o dinheiro entrou', () => {
  const p = product({ delivery_type: 'texto', role_id: null });
  const { order } = orders.createOrder({ userId: 'u5', productId: p.id, method: 'mercadopago' });
  orders.cancelOrder(order.id, { status: 'expirado', reason: 'teste' });
  const r = orders.confirmPayment(order.id, { provider: 'mercadopago', providerId: '555', amountCents: order.total_cents });
  assert.equal(r.changed, true);
});

test('relatório de vendas soma só pedidos pagos', () => {
  const s = orders.salesStats(0);
  assert.ok(s.vendas >= 4);
  assert.ok(s.bruto > 0);
  assert.ok(Array.isArray(s.top));
});
