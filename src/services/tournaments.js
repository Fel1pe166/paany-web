// Torneios em eliminatória simples. Sem Discord aqui: só regras e banco (testável).
import { randomInt } from 'node:crypto';
import { all, audit, one, run, tx } from '../db.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 64;

export const getTournament = (id) => one('SELECT * FROM tournaments WHERE id = ?', Number(id));
export const players = (id) => all('SELECT user_id FROM tournament_players WHERE tournament_id = ? ORDER BY joined_at', Number(id)).map((r) => r.user_id);
export const matches = (id) => all('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round, position', Number(id));
export const getMatch = (id) => one('SELECT * FROM tournament_matches WHERE id = ?', Number(id));
export const listTournaments = (limit = 50) => all('SELECT * FROM tournaments ORDER BY id DESC LIMIT ?', limit);

export function createTournament({ name, description = '', prize = null, maxPlayers = 16, createdBy, channelId = null }) {
  const max = Math.min(Math.max(Number(maxPlayers) || 16, MIN_PLAYERS), MAX_PLAYERS);
  const r = run(`INSERT INTO tournaments(name, description, prize, max_players, channel_id, created_by, created_at) VALUES(?,?,?,?,?,?,?)`,
    String(name).trim().slice(0, 80), String(description || '').slice(0, 1000), prize ? String(prize).slice(0, 200) : null, max, channelId, createdBy, Date.now());
  const id = Number(r.lastInsertRowid);
  audit(createdBy, 'torneio.criar', `#${id} ${name}`);
  return getTournament(id);
}

export const setMessage = (id, channelId, messageId) =>
  run('UPDATE tournaments SET channel_id = ?, message_id = ? WHERE id = ?', channelId, messageId, Number(id));

export function join(id, userId) {
  return tx(() => {
    const t = getTournament(id);
    if (!t) return { error: 'Torneio não encontrado.' };
    if (t.status !== 'inscricoes') return { error: 'As inscrições deste torneio estão fechadas.' };
    if (one('SELECT 1 FROM tournament_players WHERE tournament_id = ? AND user_id = ?', t.id, userId)) return { error: 'Você já está inscrito.' };
    const n = one('SELECT COUNT(*) n FROM tournament_players WHERE tournament_id = ?', t.id).n;
    if (n >= t.max_players) return { error: 'As vagas acabaram.' };
    run('INSERT INTO tournament_players(tournament_id, user_id, joined_at) VALUES(?,?,?)', t.id, userId, Date.now());
    return { ok: true, count: n + 1 };
  });
}

export function leave(id, userId) {
  const t = getTournament(id);
  if (!t) return { error: 'Torneio não encontrado.' };
  if (t.status !== 'inscricoes') return { error: 'O torneio já começou. Fale com a equipe para sair.' };
  const r = run('DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?', t.id, userId);
  return r.changes ? { ok: true } : { error: 'Você não está inscrito.' };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Nome da rodada a partir do total de rodadas. */
export function roundName(round, totalRounds) {
  const left = totalRounds - round;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semifinal';
  if (left === 2) return 'Quartas de final';
  if (left === 3) return 'Oitavas de final';
  return `Rodada ${round}`;
}

export const totalRounds = (tournamentId) => one('SELECT MAX(round) r FROM tournament_matches WHERE tournament_id = ?', Number(tournamentId)).r || 0;

/** Coloca o vencedor na próxima partida. Retorna o campeão se acabou. */
function advance(t, m, winner) {
  const rounds = totalRounds(t.id);
  if (m.round === rounds) {
    run(`UPDATE tournaments SET status = 'finalizado', winner_id = ?, finished_at = ? WHERE id = ?`, winner, Date.now(), t.id);
    return { champion: winner };
  }
  const next = one('SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = ? AND position = ?', t.id, m.round + 1, Math.floor(m.position / 2));
  const slot = m.position % 2 === 0 ? 'p1' : 'p2';
  run(`UPDATE tournament_matches SET ${slot} = ?, updated_at = ? WHERE id = ?`, winner, Date.now(), next.id);
  const n = getMatch(next.id);
  if (n.p1 && n.p2) run(`UPDATE tournament_matches SET status = 'pronta' WHERE id = ?`, n.id);
  return {};
}

/**
 * Fecha as inscrições e monta o chaveamento.
 * Quem sobra numa chave que não é potência de 2 passa direto ("bye") na 1ª rodada.
 */
export function start(id, actorId) {
  return tx(() => {
    const t = getTournament(id);
    if (!t) return { error: 'Torneio não encontrado.' };
    if (t.status !== 'inscricoes') return { error: 'Esse torneio já começou ou foi encerrado.' };
    const list = shuffle(players(t.id));
    if (list.length < MIN_PLAYERS) return { error: `São necessários pelo menos ${MIN_PLAYERS} inscritos.` };

    let size = 1;
    while (size < list.length) size *= 2;
    const rounds = Math.log2(size);
    const byes = size - list.length;
    const now = Date.now();

    // 1ª rodada: os "byes" ficam espalhados, nunca bye contra bye
    const pairs = [];
    let k = 0;
    for (let i = 0; i < size / 2; i++) pairs.push(i < byes ? [list[k++], null] : [list[k++], list[k++]]);
    const order = shuffle(pairs);

    for (let r = 1; r <= rounds; r++) {
      for (let pos = 0; pos < size / 2 ** r; pos++) {
        const [p1, p2] = r === 1 ? order[pos] : [null, null];
        run(`INSERT INTO tournament_matches(tournament_id, round, position, p1, p2, status, updated_at) VALUES(?,?,?,?,?,?,?)`,
          t.id, r, pos, p1, p2, r === 1 && p1 && p2 ? 'pronta' : 'pendente', now);
      }
    }
    run(`UPDATE tournaments SET status = 'andamento', started_at = ? WHERE id = ?`, now, t.id);

    // Byes avançam sozinhos
    for (const m of all(`SELECT * FROM tournament_matches WHERE tournament_id = ? AND round = 1 AND p2 IS NULL`, t.id)) {
      run(`UPDATE tournament_matches SET winner = ?, status = 'concluida' WHERE id = ?`, m.p1, m.id);
      advance(t, m, m.p1);
    }
    audit(actorId, 'torneio.iniciar', `#${t.id} ${list.length} jogadores`);
    return { ok: true, players: list.length, rounds };
  });
}

/** Registra o vencedor de uma partida pronta e avança a chave. */
export function reportWinner(matchId, winnerId, actorId) {
  return tx(() => {
    const m = getMatch(matchId);
    if (!m) return { error: 'Partida não encontrada.' };
    const t = getTournament(m.tournament_id);
    if (t.status !== 'andamento') return { error: 'Esse torneio não está em andamento.' };
    if (m.status !== 'pronta') return { error: m.status === 'concluida' ? 'Essa partida já tem vencedor.' : 'Essa partida ainda espera os jogadores.' };
    if (winnerId !== m.p1 && winnerId !== m.p2) return { error: 'Esse jogador não está na partida.' };
    run(`UPDATE tournament_matches SET winner = ?, status = 'concluida', reported_by = ?, updated_at = ? WHERE id = ?`, winnerId, actorId, Date.now(), m.id);
    audit(actorId, 'torneio.resultado', `#${t.id} partida ${m.id} vencedor=${winnerId}`);
    const r = advance(t, m, winnerId);
    return { ok: true, tournament: getTournament(t.id), match: getMatch(m.id), champion: r.champion || null };
  });
}

export function cancel(id, actorId) {
  const r = run(`UPDATE tournaments SET status = 'cancelado', finished_at = ? WHERE id = ? AND status IN ('inscricoes','andamento')`, Date.now(), Number(id));
  if (r.changes) audit(actorId, 'torneio.cancelar', `#${id}`);
  return r.changes ? { ok: true } : { error: 'Esse torneio não pode ser cancelado.' };
}

export const openMatches = (id) => all(`SELECT * FROM tournament_matches WHERE tournament_id = ? AND status = 'pronta' ORDER BY round, position`, Number(id));
