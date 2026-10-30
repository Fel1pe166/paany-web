// Comunidade: torneios, votações e busca de vídeos/músicas livres.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder,
} from 'discord.js';
import { baseEmbed, COLORS, logoFile, notice } from '../theme.js';
import { clip, cooldown, isStaff, rel, ts } from '../util.js';
import { getClient, logError, sendLog } from '../services/logger.js';
import * as T from '../services/tournaments.js';
import * as P from '../services/polls.js';
import * as M from '../services/media.js';

const EPH = MessageFlags.Ephemeral;
const err = (text) => ({ embeds: [notice(text, 'error')], flags: EPH });
const ok = (text) => ({ embeds: [notice(text, 'ok')], flags: EPH });
const needStaff = (i) => {
  if (isStaff(i.member)) return false;
  i.reply(err('Só a equipe pode fazer isso.')).catch(() => {});
  return true;
};
const LETTERS = 'ABCDEFGHIJ';

/** Nomes de exibição dos membros (para menus, onde menção não funciona). */
async function displayNames(guild, ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const found = await guild.members.fetch({ user: uniq }).catch(() => null);
  for (const id of uniq) out[id] = found?.get(id)?.displayName || guild.members.cache.get(id)?.displayName || id;
  return out;
}

/* ================================ Torneios ================================ */

const T_STATUS = { inscricoes: 'Inscrições abertas', andamento: 'Em andamento', finalizado: 'Finalizado', cancelado: 'Cancelado' };

export function tournamentView(t) {
  const list = T.players(t.id);
  const e = baseEmbed(`Torneio · ${t.name}`, { color: t.status === 'finalizado' ? COLORS.main : COLORS.muted })
    .setDescription(t.description || null)
    .addFields(
      { name: 'Situação', value: T_STATUS[t.status], inline: true },
      { name: 'Inscritos', value: `${list.length}/${t.max_players}`, inline: true },
      { name: 'Prêmio', value: t.prize || '—', inline: true },
    );

  if (t.status === 'inscricoes') {
    e.addFields({ name: 'Jogadores', value: list.length ? clip(list.map((id) => `<@${id}>`).join(' '), 1024) : 'Ninguém ainda. Seja o primeiro!' });
  } else {
    const ms = T.matches(t.id);
    const rounds = T.totalRounds(t.id);
    for (let r = 1; r <= rounds && r <= 20; r++) {
      const lines = ms.filter((m) => m.round === r).map((m) => {
        if (!m.p1 && !m.p2) return '`—` a definir';
        if (m.p1 && !m.p2 && m.status === 'concluida') return `<@${m.p1}> passa direto`;
        const a = m.p1 ? `<@${m.p1}>` : '?';
        const b = m.p2 ? `<@${m.p2}>` : '?';
        return m.winner ? `${a} vs ${b} → **✔ <@${m.winner}>**` : `${a} vs ${b}${m.status === 'pronta' ? ' · *jogando*' : ''}`;
      });
      e.addFields({ name: T.roundName(r, rounds), value: clip(lines.join('\n'), 1024) || '—' });
    }
    if (t.winner_id) e.addFields({ name: 'Campeão', value: `🏆 <@${t.winner_id}>` });
  }

  const row = new ActionRowBuilder();
  if (t.status === 'inscricoes') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`trn:join:${t.id}`).setLabel('Inscrever-se').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`trn:leave:${t.id}`).setLabel('Sair').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`trn:start:${t.id}`).setLabel('Iniciar (equipe)').setStyle(ButtonStyle.Secondary),
    );
  } else if (t.status === 'andamento') {
    row.addComponents(new ButtonBuilder().setCustomId(`trn:report:${t.id}`).setLabel('Reportar resultado (equipe)').setStyle(ButtonStyle.Secondary));
  }
  return { embeds: [e], files: [logoFile()], components: row.components.length ? [row] : [], allowedMentions: { parse: [] } };
}

/** Atualiza a mensagem pública do torneio (quando a ação veio de outro lugar). */
export async function refreshTournamentMessage(t) {
  if (!t.channel_id || !t.message_id) return;
  try {
    const ch = await getClient().channels.fetch(t.channel_id);
    const msg = await ch.messages.fetch(t.message_id);
    const view = tournamentView(t);
    delete view.files; // mantém o logo já anexado
    await msg.edit(view);
  } catch (e) {
    console.warn(`[torneio ${t.id}] não consegui atualizar a mensagem: ${e.message}`);
  }
}

export async function tournamentCommand(i) {
  const sub = i.options.getSubcommand();
  if (sub === 'criar') {
    if (needStaff(i)) return null;
    const t = T.createTournament({
      name: i.options.getString('nome'), description: i.options.getString('descricao') || '', prize: i.options.getString('premio'),
      maxPlayers: i.options.getInteger('vagas') || 16, createdBy: i.user.id, channelId: i.channelId,
    });
    const msg = await i.channel.send(tournamentView(t));
    T.setMessage(t.id, i.channelId, msg.id);
    await sendLog('admin', { title: 'Torneio criado', description: `**${t.name}** (#${t.id}) por <@${i.user.id}> em <#${i.channelId}>` });
    return i.reply(ok(`Torneio **${t.name}** publicado! Os membros se inscrevem pelo botão.`));
  }
  const t = T.getTournament(i.options.getString('torneio'));
  if (!t) return i.reply(err('Torneio não encontrado.'));
  if (sub === 'chave') return i.reply({ ...tournamentView(t), components: [], flags: EPH });
  if (needStaff(i)) return null;
  if (sub === 'iniciar') return startTournament(i, t.id);
  if (sub === 'cancelar') {
    const r = T.cancel(t.id, i.user.id);
    if (r.error) return i.reply(err(r.error));
    await refreshTournamentMessage(T.getTournament(t.id));
    return i.reply(ok(`Torneio **${t.name}** cancelado.`));
  }
  return null;
}

async function startTournament(i, id) {
  const r = T.start(id, i.user.id);
  if (r.error) return i.reply(err(r.error));
  const t = T.getTournament(id);
  await refreshTournamentMessage(t);
  if (t.channel_id) {
    const ch = await i.client.channels.fetch(t.channel_id).catch(() => null);
    await ch?.send({ embeds: [notice(`O torneio **${t.name}** começou com ${r.players} jogadores! Confira a chave acima.`, 'ok')] }).catch(() => {});
  }
  return i.reply(ok(`Torneio iniciado: ${r.players} jogadores, ${r.rounds} rodada(s).`));
}

export async function tournamentButton(i, action, args) {
  const id = args[0];
  if (action === 'join' || action === 'leave') {
    const wait = cooldown(i.user.id, `trn:${id}`, 2000);
    if (wait) return i.reply(err('Calma! Tente de novo em instantes.'));
    const r = action === 'join' ? T.join(id, i.user.id) : T.leave(id, i.user.id);
    if (r.error) return i.reply(err(r.error));
    const view = tournamentView(T.getTournament(id));
    delete view.files;
    await i.update(view);
    return i.followUp(ok(action === 'join' ? 'Inscrição confirmada! Boa sorte.' : 'Você saiu do torneio.'));
  }
  if (action === 'start') {
    if (needStaff(i)) return null;
    return startTournament(i, id);
  }
  if (action === 'report') {
    if (needStaff(i)) return null;
    const open = T.openMatches(id);
    if (!open.length) return i.reply(err('Nenhuma partida esperando resultado agora.'));
    const rounds = T.totalRounds(id);
    const nm = await displayNames(i.guild, open.flatMap((m) => [m.p1, m.p2]));
    const menu = new StringSelectMenuBuilder().setCustomId(`trn:pick:${id}`).setPlaceholder('Qual partida terminou?')
      .addOptions(open.slice(0, 25).map((m) => ({
        label: clip(`${nm[m.p1]} vs ${nm[m.p2]}`, 100), value: String(m.id), description: T.roundName(m.round, rounds),
      })));
    return i.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: EPH });
  }
  if (action === 'pick') {
    if (needStaff(i)) return null;
    const m = T.getMatch(i.values[0]);
    if (!m || m.status !== 'pronta') return i.update({ embeds: [notice('Essa partida não está mais aberta.', 'error')], components: [] });
    const nm = await displayNames(i.guild, [m.p1, m.p2]);
    return i.update({
      embeds: [notice(`Quem venceu **${nm[m.p1]}** vs **${nm[m.p2]}**?`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`trn:win:${m.id}:${m.p1}`).setLabel(clip(`🏆 ${nm[m.p1]}`, 80)).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`trn:win:${m.id}:${m.p2}`).setLabel(clip(`🏆 ${nm[m.p2]}`, 80)).setStyle(ButtonStyle.Primary),
      )],
    });
  }
  if (action === 'win') {
    if (needStaff(i)) return null;
    const [matchId, winner] = args;
    const r = T.reportWinner(matchId, winner, i.user.id);
    if (r.error) return i.update({ embeds: [notice(r.error, 'error')], components: [] });
    await refreshTournamentMessage(r.tournament);
    if (r.champion && r.tournament.channel_id) {
      const ch = await i.client.channels.fetch(r.tournament.channel_id).catch(() => null);
      await ch?.send({
        content: `🏆 <@${r.champion}>`,
        embeds: [baseEmbed(`Temos um campeão!`).setDescription(`<@${r.champion}> venceu o torneio **${r.tournament.name}**!${r.tournament.prize ? `\nPrêmio: **${r.tournament.prize}**` : ''}`)],
        files: [logoFile()], allowedMentions: { users: [r.champion] },
      }).catch(() => {});
      await sendLog('admin', { title: 'Torneio finalizado', description: `**${r.tournament.name}** — campeão <@${r.champion}>${r.tournament.prize ? ` · prêmio: ${r.tournament.prize}` : ''}` });
    }
    return i.update({ embeds: [notice(r.champion ? 'Resultado salvo. Torneio encerrado com campeão!' : 'Resultado salvo e chave atualizada.', 'ok')], components: [] });
  }
  return null;
}

/* ================================ Votações ================================ */

const bar = (pct) => {
  const n = Math.round(pct * 12);
  return '█'.repeat(n) + '░'.repeat(12 - n);
};

export function pollView(p) {
  const { counts, total, winners } = P.results(p.id);
  const open = p.status === 'aberta';
  const showResults = !open || !p.hide_results;
  const e = baseEmbed(open ? 'Votação' : 'Votação encerrada', { color: open ? COLORS.muted : COLORS.main }).setDescription(`**${p.question}**`);
  for (const [idx, opt] of p.options.entries()) {
    const pct = total ? counts[idx] / total : 0;
    const win = !open && winners.includes(idx);
    e.addFields({
      name: `${LETTERS[idx]}. ${clip(opt, 200)}${win ? ' ✔' : ''}`,
      value: showResults ? `\`${bar(pct)}\` ${Math.round(pct * 100)}% · ${counts[idx]}` : '`░░░░░░░░░░░░` resultado ao encerrar',
    });
  }
  const info = [`${total} voto(s)`];
  if (open && p.ends_at) info.push(`encerra ${rel(p.ends_at)}`);
  if (!open && p.closed_at) info.push(`encerrada em ${ts(p.closed_at)}`);
  if (p.role_id) info.push(`só para <@&${p.role_id}>`);
  e.addFields({ name: '​', value: info.join(' · ') });

  const rows = [];
  if (open) {
    for (let r = 0; r < Math.ceil(p.options.length / 5); r++) {
      rows.push(new ActionRowBuilder().addComponents(p.options.slice(r * 5, r * 5 + 5).map((opt, k) => {
        const idx = r * 5 + k;
        return new ButtonBuilder().setCustomId(`poll:vote:${p.id}:${idx}`).setLabel(clip(`${LETTERS[idx]} · ${opt}`, 80)).setStyle(ButtonStyle.Secondary);
      })));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`poll:mine:${p.id}`).setLabel('Meu voto').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`poll:end:${p.id}`).setLabel('Encerrar (equipe)').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [e], files: [logoFile()], components: rows, allowedMentions: { parse: [] } };
}

export async function finishPoll(id, actorId = null) {
  if (!P.closePoll(id, actorId)) return false;
  const p = P.getPoll(id);
  const { counts, total, winners } = P.results(id);
  try {
    const ch = await getClient().channels.fetch(p.channel_id);
    const msg = await ch.messages.fetch(p.message_id).catch(() => null);
    const view = pollView(p);
    delete view.files;
    if (msg) await msg.edit(view);
    const result = total
      ? `Vencedor: **${winners.map((w) => p.options[w]).join(' / ')}** com ${counts[winners[0]]} de ${total} votos.`
      : 'Ninguém votou.';
    await ch.send({ embeds: [notice(`Votação encerrada: **${p.question}**\n${result}`, 'ok')], reply: msg ? { messageReference: msg.id } : undefined }).catch(() => {});
  } catch (e) {
    console.warn(`[votação ${id}] não consegui atualizar: ${e.message}`);
  }
  return true;
}

export async function pollCommand(i) {
  if (needStaff(i)) return null;
  const sub = i.options.getSubcommand();
  if (sub === 'criar') {
    const r = P.createPoll({
      question: i.options.getString('pergunta'), options: P.parseOptions(i.options.getString('opcoes')),
      minutes: i.options.getInteger('duracao_min'), roleId: i.options.getRole('cargo')?.id ?? null,
      hideResults: i.options.getBoolean('ocultar_resultado') ?? false, createdBy: i.user.id, channelId: i.channelId,
    });
    if (r.error) return i.reply(err(r.error));
    const msg = await i.channel.send(pollView(r.poll));
    P.setPollMessage(r.poll.id, i.channelId, msg.id);
    return i.reply(ok('Votação publicada!'));
  }
  if (sub === 'encerrar') {
    const p = P.getPoll(i.options.getString('votacao'));
    if (!p) return i.reply(err('Votação não encontrada.'));
    if (!await finishPoll(p.id, i.user.id)) return i.reply(err('Essa votação já foi encerrada.'));
    return i.reply(ok('Votação encerrada.'));
  }
  return null;
}

export async function pollButton(i, action, args) {
  const id = args[0];
  if (action === 'vote') {
    const wait = cooldown(i.user.id, `poll:${id}`, 1500);
    if (wait) return i.reply(err('Calma! Tente de novo em instantes.'));
    const p = P.getPoll(id);
    const hasRole = !p?.role_id || Boolean(i.member?.roles?.cache?.has(p.role_id));
    const r = P.vote(id, i.user.id, args[1], { hasRole });
    if (r.error) return i.reply(err(r.error));
    const view = pollView(P.getPoll(id));
    delete view.files;
    await i.update(view);
    const txt = { added: `Voto registrado em **${r.option}**.`, changed: `Voto trocado para **${r.option}**.`, removed: 'Voto retirado.' }[r.action];
    return i.followUp(ok(`${txt} Clique de novo na mesma opção para retirar.`));
  }
  if (action === 'mine') {
    const p = P.getPoll(id);
    const v = P.userVote(id, i.user.id);
    return i.reply(v == null ? err('Você ainda não votou.') : ok(`Seu voto: **${LETTERS[v]}. ${p.options[v]}**`));
  }
  if (action === 'end') {
    if (needStaff(i)) return null;
    if (!await finishPoll(id, i.user.id)) return i.reply(err('Essa votação já foi encerrada.'));
    return i.reply(ok('Votação encerrada.'));
  }
  return null;
}

let pollTimer = null;
export function startCommunityLoop() {
  if (pollTimer) return;
  const tick = async () => {
    for (const id of P.duePolls()) await finishPoll(id).catch((e) => logError(`encerrar votação ${id}`, e));
  };
  pollTimer = setInterval(tick, 60_000);
  pollTimer.unref?.();
  setTimeout(tick, 10_000);
}

/* ============================ Vídeos e músicas ============================ */

function videoView(res, idx, ownerId) {
  const v = res.items[idx];
  const e = baseEmbed(clip(v.title ? `Vídeo · ${v.title}` : `Vídeo de ${v.author}`, 256), { thumb: false })
    .setDescription(`Vídeo por [${v.author}](${v.authorUrl}) no [${v.source}](${v.page}) · uso gratuito, inclusive comercial.`)
    .addFields(
      { name: 'Resolução', value: v.width && v.height ? `${v.width}×${v.height}` : '—', inline: true },
      { name: 'Duração', value: M.fmtDuration(v.duration), inline: true },
      { name: 'Formato', value: v.height > v.width ? 'Vertical' : v.height === v.width ? 'Quadrado' : 'Horizontal', inline: true },
    )
    .setFooter({ text: `Busca: "${res.query}" · ${idx + 1} de ${res.items.length} · Fonte: ${v.source}`, iconURL: 'attachment://logo.png' });
  if (v.thumb) e.setImage(v.thumb);
  return { embeds: [e], files: [logoFile()], components: [mediaRow(res, idx, ownerId, 'v', v.download, 'Baixar vídeo')] };
}

function musicView(res, idx, ownerId) {
  const m = res.items[idx];
  const e = baseEmbed(clip(m.title, 256), { thumb: false })
    .setDescription(`por **${m.author}** · [${m.source}](${m.page})`)
    .addFields(
      { name: 'Duração', value: M.fmtDuration(m.duration), inline: true },
      { name: 'Licença', value: m.licenseUrl ? `[${m.license}](${m.licenseUrl})` : m.license, inline: true },
      { name: 'Download', value: m.download ? 'Liberado pelo artista' : 'Só para ouvir', inline: true },
    )
    .setFooter({ text: `Busca: "${res.query}" · ${idx + 1} de ${res.items.length} · Músicas Creative Commons do Jamendo`, iconURL: 'attachment://logo.png' });
  if (m.nonCommercial) e.addFields({ name: 'Atenção', value: 'Licença **não comercial**: não use em vídeos monetizados ou anúncios. Sempre dê crédito ao artista.' });
  else e.addFields({ name: 'Crédito', value: `Ao usar, credite: "${m.title}" — ${m.author} (${m.license}).` });
  if (m.thumb) e.setThumbnail(m.thumb);
  return { embeds: [e], files: [logoFile()], components: [mediaRow(res, idx, ownerId, 'm', m.download, 'Baixar MP3', m.page)] };
}

function mediaRow(res, idx, ownerId, kind, download, label, listen = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`med:${kind}:${res.key}:${idx - 1}:${ownerId}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(idx === 0),
    new ButtonBuilder().setCustomId(`med:${kind}:${res.key}:${idx + 1}:${ownerId}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(idx >= res.items.length - 1),
  );
  if (listen) row.addComponents(new ButtonBuilder().setURL(listen).setLabel('Ouvir').setStyle(ButtonStyle.Link));
  if (download && download.length <= 512) row.addComponents(new ButtonBuilder().setURL(download).setLabel(label).setStyle(ButtonStyle.Link));
  else if (!listen) row.addComponents(new ButtonBuilder().setURL(res.items[idx].page).setLabel('Ver na fonte').setStyle(ButtonStyle.Link));
  return row;
}

export async function mediaCommand(i) {
  const isVideo = i.commandName === 'video';
  const f = M.mediaFeatures();
  if (isVideo ? !f.video : !f.music) {
    return i.reply(err(`A busca de ${isVideo ? 'vídeos' : 'músicas'} ainda não foi configurada pela equipe.`));
  }
  const wait = cooldown(i.user.id, 'media', 6000);
  if (wait) return i.reply(err(`Aguarde ${wait}s para buscar de novo.`));
  const publico = i.options.getBoolean('publico') ?? false;
  await i.deferReply(publico ? {} : { flags: EPH });
  try {
    const busca = i.options.getString('busca');
    const orientation = { horizontal: 'landscape', vertical: 'portrait', quadrado: 'square' }[i.options.getString('formato')] || null;
    const res = isVideo ? await M.searchVideos(busca, { orientation }) : await M.searchMusic(busca);
    if (!res.items.length) return i.editReply({ embeds: [notice(`Nada encontrado para "${busca}". Tente em inglês ou com outra palavra.`, 'error')] });
    return i.editReply(isVideo ? videoView(res, 0, i.user.id) : musicView(res, 0, i.user.id));
  } catch (e) {
    console.warn('[mídia]', e.message);
    return i.editReply({ embeds: [notice(`Não consegui buscar agora: ${e.message}`, 'error')] });
  }
}

export async function mediaButton(i, kind, args) {
  const [key, idxRaw, ownerId] = args;
  if (ownerId && ownerId !== i.user.id) return i.reply(err('Só quem fez a busca pode navegar. Use /video ou /musica para a sua.'));
  const res = M.cached(key);
  if (!res) return i.reply(err('Essa busca expirou. Faça uma nova.'));
  const idx = Math.max(0, Math.min(Number(idxRaw) || 0, res.items.length - 1));
  const view = kind === 'v' ? videoView(res, idx, ownerId) : musicView(res, idx, ownerId);
  delete view.files;
  return i.update(view);
}

/* ============================== Autocomplete ============================== */

export function communityAutocomplete(i) {
  const q = String(i.options.getFocused() || '').toLowerCase();
  if (i.commandName === 'torneio') {
    const sub = i.options.getSubcommand();
    const allowed = sub === 'iniciar' ? ['inscricoes'] : sub === 'cancelar' ? ['inscricoes', 'andamento'] : null;
    return T.listTournaments(50).filter((t) => (!allowed || allowed.includes(t.status)) && (!q || t.name.toLowerCase().includes(q)))
      .slice(0, 25).map((t) => ({ name: clip(`#${t.id} ${t.name} · ${T_STATUS[t.status]}`, 100), value: String(t.id) }));
  }
  if (i.commandName === 'votacao') {
    return P.listPolls(50).filter((p) => p.status === 'aberta' && (!q || p.question.toLowerCase().includes(q)))
      .slice(0, 25).map((p) => ({ name: clip(`#${p.id} ${p.question}`, 100), value: String(p.id) }));
  }
  return [];
}
