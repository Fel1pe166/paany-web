// Fluxos administrativos. TODA ação confere isAdmin() no servidor —
// esconder comandos/botões não é considerado proteção.
import {
  ActionRowBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { all, audit, getSetting, one, run, setSetting } from '../db.js';
import { baseEmbed, CATEGORIES, logoFile, notice } from '../theme.js';
import { brl, clip, isAdmin, isHttpUrl, parsePrice, rel, ts } from '../util.js';
import { makeBackup } from '../services/backup.js';
import { logError, sendLog } from '../services/logger.js';
import {
  createCoupon, createProduct, getOrder, getProduct, listProducts, normalizeCode, salesStats, updateProduct,
  userOrders,
} from '../services/orders.js';
import {
  approveManualOrder, cancelOrderAdmin, redeliverOrder, refundOrder, rejectManualOrder,
} from '../services/actions.js';
import { orderButtons, orderEmbed, storePanel, termsText } from '../ui/store.js';
import { publishSupportPanel } from '../ui/support.js';
import { EPH, respond } from './client.js';

const err = (text) => ({ embeds: [notice(text, 'error')], flags: EPH });
const ok = (text) => ({ embeds: [notice(text, 'ok')], flags: EPH });

export function requireAdmin(i) {
  if (isAdmin(i.user.id)) return true;
  audit(i.user.id, 'acesso.negado', `${i.commandName || i.customId}`);
  respond(i, err('Você não tem permissão para isso.')).catch(() => {});
  return false;
}

// Dados temporários entre o comando e o formulário (modal)
const pending = new Map();
const stash = (data) => {
  const token = randomBytes(6).toString('hex');
  pending.set(token, { data, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60_000) pending.delete(k);
  return token;
};
const unstash = (token) => { const v = pending.get(token); pending.delete(token); return v?.data; };

/* ------------------------------ Validações ----------------------------- */

function checkRole(guild, role) {
  if (!role) return null;
  if (role.managed) return 'Esse cargo é gerenciado por uma integração e não pode ser dado.';
  if (role.id === guild.roles.everyone.id) return 'Cargo inválido.';
  const me = guild.members.me;
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return `Arraste o cargo da ${config.botName} para **acima** de ${role} em Configurações do servidor → Cargos.`;
  }
  return null;
}

/* ------------------------------- Produtos ------------------------------ */

function productTextModal(customId, p = {}, needsContent = true) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(p.name ? clip(`Editar: ${p.name}`, 45) : 'Novo produto');
  m.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Descrição (aparece na loja)')
      .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(p.description || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rules').setLabel('Regras de uso / reembolso')
      .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setValue(p.rules || '')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('content')
      .setLabel('Conteúdo PRIVADO da entrega (link/instruções)').setPlaceholder('Só vai para quem pagou. Ex.: link do Drive/Mega')
      .setStyle(TextInputStyle.Paragraph).setRequired(needsContent).setMaxLength(1000).setValue(p.delivery_content || '')),
  );
  return m;
}

export async function productCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();
  const o = i.options;

  if (sub === 'adicionar') {
    const price = parsePrice(o.getString('preco'));
    if (!price) return respond(i, err('Preço inválido. Use algo como 8,00.'));
    const role = o.getRole('cargo');
    const type = o.getString('entrega');
    if (type === 'cargo' && !role) return respond(i, err('Entrega do tipo "Cargo" precisa de um cargo.'));
    const roleProblem = checkRole(i.guild, role);
    if (roleProblem) return respond(i, err(roleProblem));
    const image = o.getString('imagem');
    if (image && !isHttpUrl(image)) return respond(i, err('A imagem precisa ser um link https://.'));

    const token = stash({
      name: o.getString('nome').trim(), price_cents: price, category: o.getString('categoria'), delivery_type: type,
      role_id: role?.id ?? null, vip_days: o.getInteger('dias_vip') ?? null, stock: o.getInteger('estoque') ?? null,
      image_url: image || null,
    });
    return i.showModal(productTextModal(`modal:padd:${token}`, {}, type !== 'cargo'));
  }

  if (sub === 'editar') {
    const p = getProduct(o.getString('produto'));
    if (!p) return respond(i, err('Produto não encontrado.'));
    const changes = {};
    if (o.getString('nome')) changes.name = o.getString('nome').trim();
    if (o.getString('preco')) {
      changes.price_cents = parsePrice(o.getString('preco'));
      if (!changes.price_cents) return respond(i, err('Preço inválido.'));
    }
    if (o.getString('categoria')) changes.category = o.getString('categoria');
    if (o.getString('entrega')) changes.delivery_type = o.getString('entrega');
    if (o.getRole('cargo')) {
      const problem = checkRole(i.guild, o.getRole('cargo'));
      if (problem) return respond(i, err(problem));
      changes.role_id = o.getRole('cargo').id;
    }
    if (o.getInteger('dias_vip') != null) changes.vip_days = o.getInteger('dias_vip') || null;
    const img = o.getString('imagem');
    if (img) {
      if (img.toLowerCase() === 'remover') changes.image_url = null;
      else if (!isHttpUrl(img)) return respond(i, err('A imagem precisa ser um link https://.'));
      else changes.image_url = img;
    }
    if (o.getBoolean('ativo') != null) changes.active = o.getBoolean('ativo') ? 1 : 0;
    if ((changes.delivery_type ?? p.delivery_type) === 'cargo' && !(changes.role_id ?? p.role_id)) {
      return respond(i, err('Entrega do tipo "Cargo" precisa de um cargo.'));
    }

    if (o.getBoolean('textos')) {
      const token = stash({ id: p.id, changes });
      return i.showModal(productTextModal(`modal:pedit:${token}`, p, (changes.delivery_type ?? p.delivery_type) !== 'cargo'));
    }
    const up = updateProduct(p.id, changes, i.user.id);
    await sendLog('admin', { title: 'Produto editado', description: `**${up.name}** (#${up.id}) por <@${i.user.id}>\nCampos: ${Object.keys(changes).join(', ') || 'nenhum'}` });
    return respond(i, ok(`Produto **${up.name}** atualizado.`));
  }

  if (sub === 'remover') {
    const p = getProduct(o.getString('produto'));
    if (!p) return respond(i, err('Produto não encontrado.'));
    updateProduct(p.id, { active: 0 }, i.user.id);
    await sendLog('admin', { title: 'Produto removido da loja', description: `**${p.name}** (#${p.id}) por <@${i.user.id}>` });
    return respond(i, ok(`**${p.name}** saiu da loja. Pedidos antigos continuam no histórico. Para voltar: \`/produto editar ativo:true\`.`));
  }

  if (sub === 'listar') {
    const items = listProducts({ includeInactive: true });
    const e = baseEmbed('Produtos cadastrados').setDescription(items.length
      ? items.map((p) => `${p.active ? '◆' : '◇'} \`#${p.id}\` **${clip(p.name, 40)}** — ${brl(p.price_cents)} • ${CATEGORIES[p.category] || p.category} • ` +
        `${p.stock == null ? '∞' : p.stock} un.${p.role_id ? ` • <@&${p.role_id}>${p.vip_days ? ` ${p.vip_days}d` : ' perm.'}` : ''}`).join('\n').slice(0, 4000)
      : 'Nenhum produto ainda. Use `/produto adicionar`.');
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }

  if (sub === 'estoque') {
    const p = getProduct(o.getString('produto'));
    if (!p) return respond(i, err('Produto não encontrado.'));
    const stock = o.getBoolean('ilimitado') ? null : o.getInteger('quantidade');
    if (stock === undefined || (stock == null && !o.getBoolean('ilimitado'))) return respond(i, err('Informe a quantidade ou marque ilimitado.'));
    updateProduct(p.id, { stock }, i.user.id);
    return respond(i, ok(`Estoque de **${p.name}**: ${stock == null ? 'ilimitado' : stock}.`));
  }
}

export async function productModalSubmit(i, kind, token) {
  if (!requireAdmin(i)) return;
  const data = unstash(token);
  if (!data) return respond(i, err('O formulário expirou. Rode o comando de novo.'));
  const texts = {
    description: i.fields.getTextInputValue('description').trim(),
    rules: i.fields.getTextInputValue('rules').trim(),
    delivery_content: i.fields.getTextInputValue('content').trim() || null,
  };
  if (kind === 'padd') {
    const p = createProduct({ ...data, ...texts }, i.user.id);
    await sendLog('admin', { title: 'Produto criado', description: `**${p.name}** (#${p.id}) — ${brl(p.price_cents)} por <@${i.user.id}>` });
    return respond(i, ok(`Produto **${p.name}** criado (#${p.id}). Ele já aparece na /loja.`));
  }
  const up = updateProduct(data.id, { ...data.changes, ...texts }, i.user.id);
  await sendLog('admin', { title: 'Produto editado', description: `**${up.name}** (#${up.id}) por <@${i.user.id}> (textos e conteúdo)` });
  return respond(i, ok(`Produto **${up.name}** atualizado.`));
}

/* -------------------------------- Pedidos ------------------------------ */

export function approveModal(orderId) {
  return new ModalBuilder().setCustomId(`modal:approve:${orderId}`).setTitle('Aprovar Pix manual')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('confirm').setLabel(`Digite ${orderId} para confirmar`)
        .setPlaceholder('Confirmo que o valor caiu no extrato').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20),
    ));
}

export function rejectModal(orderId) {
  return new ModalBuilder().setCustomId(`modal:reject:${orderId}`).setTitle('Recusar pagamento')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Motivo (vai para o cliente)').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(500),
    ));
}

const reply = (r) => (r.ok ? ok(r.message) : err(r.message));

/** Aprovação humana de Pix manual. Exige digitar o ID (evita clique acidental). */
export async function approveManual(i, orderId, typed) {
  if (!requireAdmin(i)) return;
  await i.deferReply({ flags: EPH });
  const r = await approveManualOrder(orderId, i.user.id, typed);
  // Desativa os botões da mensagem de aprovação
  if (r.ok && i.message?.editable) {
    await i.message.edit({ components: [], embeds: [...i.message.embeds, notice(`Aprovado por <@${i.user.id}>`, 'ok').toJSON()] }).catch(() => {});
  }
  return i.editReply(reply(r));
}

export async function rejectManual(i, orderId, reason) {
  if (!requireAdmin(i)) return;
  await i.deferReply({ flags: EPH });
  const r = await rejectManualOrder(orderId, i.user.id, reason);
  if (r.ok && i.message?.editable) await i.message.edit({ components: [] }).catch(() => {});
  return i.editReply(reply(r));
}

export async function redeliver(i, orderId) {
  if (!requireAdmin(i)) return;
  await i.deferReply({ flags: EPH });
  const r = await redeliverOrder(orderId, i.user.id);
  if (r.ok && i.message?.editable && i.message.components?.length) await i.message.edit({ components: [] }).catch(() => {});
  return i.editReply(reply(r));
}

export async function orderAdminCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();
  const id = i.options.getString('id')?.trim().toUpperCase();

  if (sub === 'consultar') {
    const o = getOrder(id);
    if (!o) return respond(i, err('Pedido não encontrado.'));
    return respond(i, { embeds: [orderEmbed(o, { admin: true })], components: orderButtons(o, { admin: true }), files: [logoFile()], flags: EPH });
  }
  if (sub === 'aprovar') {
    const o = getOrder(id);
    if (!o) return respond(i, err('Pedido não encontrado.'));
    return i.showModal(approveModal(o.id));
  }
  if (sub === 'reenviar') return redeliver(i, id);
  if (sub === 'cancelar') return respond(i, reply(await cancelOrderAdmin(id, i.user.id, i.options.getString('motivo'))));
  if (sub === 'reembolsar') {
    await i.deferReply({ flags: EPH });
    return i.editReply(reply(await refundOrder(id, i.user.id, {
      removeRole: i.options.getBoolean('remover_cargo') ?? true, reason: i.options.getString('motivo') || '',
    })));
  }
  if (sub === 'cliente') {
    const u = i.options.getUser('usuario');
    const orders = userOrders(u.id, 20);
    const paid = orders.filter((o) => ['entregue', 'pago', 'falha_entrega'].includes(o.status));
    const e = baseEmbed(`Cliente: ${u.username}`).setDescription(
      `**${paid.length}** compras confirmadas • ${brl(paid.reduce((s, o) => s + o.total_cents, 0))}\n\n` +
      (orders.map((o) => `\`${o.id}\` ${clip(o.product_name, 30)} • ${brl(o.total_cents)} • ${o.status} • ${ts(o.created_at)}`).join('\n') || 'Sem pedidos.'));
    const vips = all('SELECT * FROM vips WHERE user_id = ? AND active = 1', u.id);
    if (vips.length) e.addFields({ name: 'VIPs ativos', value: vips.map((v) => `<@&${v.role_id}> ${v.expires_at ? `até ${ts(v.expires_at)}` : 'permanente'}`).join('\n') });
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }
  if (sub === 'pendentes') return respond(i, { ...pendingView(), flags: EPH });
}

function pendingView() {
  const review = all(`SELECT * FROM orders WHERE status = 'em_analise' ORDER BY created_at LIMIT 15`);
  const fails = all(`SELECT * FROM orders WHERE status IN ('falha_entrega','pago') ORDER BY updated_at DESC LIMIT 15`);
  const line = (o) => `\`${o.id}\` • ${clip(o.product_name, 30)} • ${brl(o.total_cents)} • <@${o.user_id}> • ${rel(o.updated_at)}`;
  const e = baseEmbed('Pendências')
    .addFields(
      { name: `Pix manual em análise (${review.length})`, value: review.map(line).join('\n').slice(0, 1024) || 'Nenhum' },
      { name: `Pagos sem entrega / falhas (${fails.length})`, value: fails.map((o) => `${line(o)}${o.last_error ? `\n  ↳ ${clip(o.last_error, 80)}` : ''}`).join('\n').slice(0, 1024) || 'Nenhum' },
    )
    .setFooter({ text: 'Use /gpedido consultar <id> para agir' });
  return { embeds: [e], files: [logoFile()] };
}

/* ------------------------------ Painel / vendas ------------------------------ */

function statsFields(s) {
  return [
    { name: 'Vendas confirmadas', value: String(s.vendas), inline: true },
    { name: 'Faturamento bruto', value: brl(s.bruto), inline: true },
    { name: 'Reembolsos', value: `${s.refunds.n} • ${brl(s.refunds.total)}`, inline: true },
  ];
}

export async function adminCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();

  if (sub === 'painel') {
    const day = 86400000;
    const all_ = salesStats(0);
    const week = salesStats(Date.now() - 7 * day);
    const today = salesStats(new Date().setHours(0, 0, 0, 0));
    const e = baseEmbed(`Painel • ${config.storeName}`)
      .addFields(
        { name: 'Hoje', value: `${today.vendas} vendas • ${brl(today.bruto)}`, inline: true },
        { name: '7 dias', value: `${week.vendas} vendas • ${brl(week.bruto)}`, inline: true },
        { name: 'Total', value: `${all_.vendas} vendas • ${brl(all_.bruto)}`, inline: true },
        { name: 'Reembolsos (total)', value: `${all_.refunds.n} • ${brl(all_.refunds.total)}`, inline: true },
        { name: 'Pedidos em aberto', value: String(all_.pending), inline: true },
        { name: 'Pix manual p/ conferir', value: String(all_.review), inline: true },
        { name: 'Falhas de entrega', value: String(all_.failures), inline: true },
        { name: 'VIPs ativos', value: String(one('SELECT COUNT(*) n FROM vips WHERE active = 1').n), inline: true },
        { name: 'Tickets abertos', value: String(one(`SELECT COUNT(*) n FROM tickets WHERE status = 'aberto'`).n), inline: true },
        { name: 'Mais vendidos', value: all_.top.map((t, n) => `${n + 1}. ${clip(t.name, 30)} — ${t.qtd}x • ${brl(t.total)}`).join('\n') || '—' },
        { name: 'Últimas ações', value: auditLines(5) || '—' },
      );
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }
  if (sub === 'logs') {
    return respond(i, { embeds: [baseEmbed('Histórico administrativo').setDescription(auditLines(25) || 'Vazio.')], files: [logoFile()], flags: EPH });
  }
  if (sub === 'backup') {
    await i.deferReply({ flags: EPH });
    try {
      const file = makeBackup();
      audit(i.user.id, 'backup.gerar', file);
      return i.editReply({ embeds: [notice('Backup gerado. Guarde em local seguro — ele contém os links privados dos produtos.', 'ok')], files: [new AttachmentBuilder(file)] });
    } catch (e) {
      await logError('backup', e);
      return i.editReply(err(`Falha no backup: ${e.message}`));
    }
  }
}

function auditLines(n) {
  return all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', n)
    .map((a) => `${rel(a.created_at)} ${a.actor_id ? `<@${a.actor_id}>` : 'sistema'} • \`${a.action}\` ${clip(a.details || '', 60)}`)
    .join('\n').slice(0, 1024);
}

export async function salesCommand(i) {
  if (!requireAdmin(i)) return;
  const days = i.options.getInteger('dias') || 30;
  const s = salesStats(Date.now() - days * 86400000);
  const e = baseEmbed(`Vendas • últimos ${days} dias`).addFields(
    ...statsFields(s),
    { name: 'Descontos concedidos', value: brl(s.descontos), inline: true },
    { name: 'Ticket médio', value: s.vendas ? brl(Math.round(s.bruto / s.vendas)) : '—', inline: true },
    { name: 'Mais vendidos', value: s.top.map((t, n) => `${n + 1}. ${clip(t.name, 30)} — ${t.qtd}x • ${brl(t.total)}`).join('\n') || '—' },
  );
  return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
}

/* -------------------------------- Cupons ------------------------------- */

export async function couponCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();
  const o = i.options;

  if (sub === 'criar') {
    const type = o.getString('tipo');
    const raw = o.getString('valor');
    const value = type === 'percent' ? Math.round(Number(String(raw).replace(',', '.'))) : parsePrice(raw);
    if (!value || value <= 0) return respond(i, err('Valor inválido.'));
    const startsH = o.getInteger('comeca_em_horas');
    const days = o.getInteger('validade_dias');
    const starts = startsH ? Date.now() + startsH * 3600_000 : null;
    const productId = o.getString('produto') ? Number(o.getString('produto')) : null;
    if (productId && !getProduct(productId)) return respond(i, err('Produto não encontrado.'));
    try {
      const c = createCoupon({
        code: o.getString('codigo'), type, value, max_uses: o.getInteger('usos') ?? null,
        starts_at: starts, expires_at: days ? (starts || Date.now()) + days * 86400000 : null,
        min_cents: o.getString('minimo') ? parsePrice(o.getString('minimo')) || 0 : 0,
        product_id: productId, one_per_user: o.getBoolean('um_por_cliente') ?? true,
      }, i.user.id);
      await sendLog('admin', { title: 'Cupom criado', description: `\`${c.code}\` por <@${i.user.id}>` });
      return respond(i, ok(`Cupom \`${c.code}\` criado: ${type === 'percent' ? `${value}%` : brl(value)} de desconto` +
        `${c.max_uses ? ` • ${c.max_uses} usos` : ''}${c.starts_at ? ` • começa ${rel(c.starts_at)}` : ''}${c.expires_at ? ` • expira ${rel(c.expires_at)}` : ''}.`));
    } catch (e) {
      return respond(i, err(e.message));
    }
  }
  if (sub === 'listar') {
    const list = all('SELECT * FROM coupons ORDER BY active DESC, created_at DESC LIMIT 30');
    const e = baseEmbed('Cupons').setDescription(list.map((c) =>
      `${c.active ? '◆' : '◇'} \`${c.code}\` ${c.type === 'percent' ? `${c.value}%` : brl(c.value)} • usos ${c.uses}/${c.max_uses ?? '∞'}` +
      `${c.expires_at ? ` • expira ${rel(c.expires_at)}` : ''}${c.product_id ? ` • produto #${c.product_id}` : ''}`).join('\n') || 'Nenhum cupom.');
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }
  if (sub === 'desativar') {
    const code = normalizeCode(o.getString('codigo'));
    const r = run('UPDATE coupons SET active = 0 WHERE code = ?', code);
    if (!r.changes) return respond(i, err('Cupom não encontrado.'));
    audit(i.user.id, 'cupom.desativar', code);
    return respond(i, ok(`Cupom \`${code}\` desativado.`));
  }
}

/* --------------------------------- VIP --------------------------------- */

export async function vipCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();

  if (sub === 'listar') {
    const list = all('SELECT * FROM vips WHERE active = 1 ORDER BY expires_at IS NULL, expires_at LIMIT 40');
    const e = baseEmbed('VIPs ativos').setDescription(list.map((v) =>
      `<@${v.user_id}> • <@&${v.role_id}> • ${v.expires_at ? `vence ${rel(v.expires_at)}` : 'permanente'}`).join('\n').slice(0, 4000) || 'Nenhum.');
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }
  if (sub === 'dar') {
    const u = i.options.getUser('usuario');
    const p = getProduct(i.options.getString('produto'));
    if (!p?.role_id) return respond(i, err('Escolha um produto que libera cargo.'));
    const member = await i.guild.members.fetch(u.id).catch(() => null);
    if (!member) return respond(i, err('Membro não encontrado no servidor.'));
    await member.roles.add(p.role_id, `VIP manual por ${i.user.id}`);
    const t = Date.now();
    run(`INSERT INTO vips(user_id, product_id, role_id, order_id, expires_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`,
      u.id, p.id, p.role_id, null, p.vip_days ? t + p.vip_days * 86400000 : null, t, t);
    audit(i.user.id, 'vip.dar', `${u.id} ${p.name} — ${i.options.getString('motivo')}`);
    await sendLog('admin', { title: 'VIP manual', description: `<@${u.id}> recebeu <@&${p.role_id}> de <@${i.user.id}> — ${i.options.getString('motivo')}` });
    return respond(i, ok(`<@${u.id}> recebeu <@&${p.role_id}>${p.vip_days ? ` por ${p.vip_days} dias` : ''}.`));
  }
  if (sub === 'remover') {
    const u = i.options.getUser('usuario');
    const role = i.options.getRole('cargo');
    const member = await i.guild.members.fetch(u.id).catch(() => null);
    await member?.roles.remove(role.id, `Removido por ${i.user.id}`).catch(() => {});
    run('UPDATE vips SET active = 0, updated_at = ? WHERE user_id = ? AND role_id = ? AND active = 1', Date.now(), u.id, role.id);
    audit(i.user.id, 'vip.remover', `${u.id} ${role.id}`);
    return respond(i, ok(`VIP ${role} removido de <@${u.id}>.`));
  }
}

/* ------------------------------ Configuração ------------------------------ */

export async function configCommand(i) {
  if (!requireAdmin(i)) return;
  const sub = i.options.getSubcommand();

  if (sub === 'canais') {
    const map = { vendas: 'channel_logs_vendas', admin: 'channel_logs_admin', erros: 'channel_logs_erros', aprovacoes: 'channel_approvals', avaliacoes: 'channel_reviews', avaliacoes_atendimento: 'channel_ticket_reviews', categoria_tickets: 'ticket_category' };
    const done = [];
    for (const [opt, key] of Object.entries(map)) {
      const ch = i.options.getChannel(opt);
      if (ch) { setSetting(key, ch.id); done.push(`${opt}: ${ch}`); }
    }
    audit(i.user.id, 'config.canais', done.join(', '));
    return respond(i, done.length ? ok(`Configurado:\n${done.join('\n')}`) : err('Escolha pelo menos um canal.'));
  }
  if (sub === 'painel-loja') {
    await i.channel.send(storePanel());
    audit(i.user.id, 'config.painel_loja', i.channelId);
    return respond(i, ok('Vitrine publicada! Ela lê os produtos ao vivo, não precisa republicar ao mudar preços.'));
  }
  if (sub === 'painel-suporte') {
    await publishSupportPanel(i.client, i.channelId);
    audit(i.user.id, 'config.painel_suporte', i.channelId);
    return respond(i, ok('Painel de suporte publicado. Para mudar título, banner e opções, use `/ticket personalizar` e `/ticket opcao` (ou o painel web): ele se atualiza sozinho.'));
  }
  if (sub === 'termos') {
    return i.showModal(new ModalBuilder().setCustomId('modal:terms').setTitle('Termos da loja').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('terms').setLabel('Termos, reembolso e privacidade')
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3000).setValue(termsText().slice(0, 3000))),
    ));
  }
  if (sub === 'ver') {
    const ch = (k) => (getSetting(k) ? `<#${getSetting(k)}>` : '—');
    const e = baseEmbed('Configuração').addFields(
      { name: 'Log de vendas', value: ch('channel_logs_vendas'), inline: true },
      { name: 'Log admin', value: ch('channel_logs_admin'), inline: true },
      { name: 'Log de erros', value: ch('channel_logs_erros'), inline: true },
      { name: 'Aprovações', value: ch('channel_approvals'), inline: true },
      { name: 'Avaliações', value: ch('channel_reviews'), inline: true },
      { name: 'Avaliações do atendimento', value: ch('channel_ticket_reviews'), inline: true },
      { name: 'Categoria tickets', value: ch('ticket_category'), inline: true },
      { name: 'Cargo da equipe', value: config.staffRoleId ? `<@&${config.staffRoleId}>` : '—', inline: true },
      { name: 'Pix automático', value: config.mpAccessToken ? (config.mpAccessToken.startsWith('TEST-') ? 'modo teste' : 'ativo') : 'desligado', inline: true },
      { name: 'Pix manual', value: config.pixKey ? 'ativo' : 'desligado', inline: true },
      { name: 'Webhook', value: config.mpWebhookSecret && config.publicUrl ? 'ativo' : 'verificação automática a cada ' + config.pollSeconds + 's', inline: true },
    );
    return respond(i, { embeds: [e], files: [logoFile()], flags: EPH });
  }
}

export async function termsModalSubmit(i) {
  if (!requireAdmin(i)) return;
  setSetting('terms_text', i.fields.getTextInputValue('terms'));
  audit(i.user.id, 'config.termos', 'atualizados');
  return respond(i, ok('Termos atualizados.'));
}
