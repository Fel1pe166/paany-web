// Gera o código "Pix copia e cola" (BR Code / EMV) para o Pix manual,
// seguindo o Manual de Padrões para Iniciação do Pix do Banco Central.

const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido pelo BR Code. */
export function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Nome e cidade: sem acento, maiúsculo, só caracteres seguros
const clean = (s, max) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .-]/g, '').trim().toUpperCase().slice(0, max);

/**
 * @param {object} p
 * @param {string} p.key chave Pix (e-mail, CPF/CNPJ, telefone +55..., ou aleatória)
 * @param {string} p.name nome do recebedor
 * @param {string} p.city cidade do recebedor
 * @param {number} p.amountCents valor em centavos
 * @param {string} p.txid identificador (o ID do pedido), até 25 caracteres alfanuméricos
 */
export function buildPixCode({ key, name, city, amountCents, txid }) {
  const tx = (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const account = field('00', 'br.gov.bcb.pix') + field('01', key.trim());
  let payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    field('54', (amountCents / 100).toFixed(2)) +
    field('58', 'BR') +
    field('59', clean(name, 25)) +
    field('60', clean(city, 15)) +
    field('62', field('05', tx)) +
    '6304';
  return payload + crc16(payload);
}
