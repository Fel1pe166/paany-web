import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from '../config.js';
import { all, audit, one, run } from '../db.js';
import { baseEmbed, logoFile } from '../theme.js';
import { rel, ts } from '../util.js';
import { getClient, logError, sendLog } from './logger.js';

/** Botão que abre a compra do mesmo plano direto na DM. */
function renewRow(productId, label) {
  const p = one('SELECT id, active FROM products WHERE id = ?', productId);
  if (!p?.active) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`buy:start:${p.id}`).setLabel(label).setStyle(ButtonStyle.Primary),
  )];
}

/** Avisa antes de vencer e remove o cargo dos VIPs expirados. */
export async function checkVips() {
  const client = getClient();
  if (!client?.isReady()) return;
  const t = Date.now();
  try {
    const guild = await client.guilds.fetch(config.guildId);

    // Aviso prévio
    const soon = all(`SELECT * FROM vips WHERE active = 1 AND warned = 0 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?`,
      t, t + config.vipWarnDays * 86400000);
    for (const v of soon) {
      run('UPDATE vips SET warned = 1 WHERE id = ?', v.id);
      const user = await client.users.fetch(v.user_id).catch(() => null);
      await user?.send({
        embeds: [baseEmbed('Seu VIP está acabando')
          .setDescription(`Seu acesso <@&${v.role_id}> vence ${rel(v.expires_at)} (${ts(v.expires_at)}).\nRenove com um clique abaixo — os dias são somados ao que ainda falta.`)],
        files: [logoFile()],
        components: renewRow(v.product_id, 'Renovar agora'),
      }).catch(() => {});
    }

    // Expiração
    const expired = all('SELECT * FROM vips WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?', t);
    for (const v of expired) {
      run('UPDATE vips SET active = 0, updated_at = ? WHERE id = ?', t, v.id);
      const member = await guild.members.fetch(v.user_id).catch(() => null);
      if (member) await member.roles.remove(v.role_id, 'VIP expirado').catch((e) => logError(`remover VIP ${v.id}`, e));
      audit(null, 'vip.expirado', `user=${v.user_id} role=${v.role_id}`);
      const user = await client.users.fetch(v.user_id).catch(() => null);
      await user?.send({
        embeds: [baseEmbed('Seu VIP expirou').setDescription(`O acesso <@&${v.role_id}> terminou. Quando quiser voltar, é só clicar abaixo.`)],
        files: [logoFile()],
        components: renewRow(v.product_id, 'Comprar de novo'),
      }).catch(() => {});
      await sendLog('admin', { title: 'VIP expirado', description: `<@${v.user_id}> perdeu <@&${v.role_id}>` });
    }
  } catch (e) {
    await logError('checagem de VIPs', e);
  }
}

export function startVipLoop() {
  setInterval(checkVips, 10 * 60_000).unref?.();
  setTimeout(checkVips, 15_000);
}
