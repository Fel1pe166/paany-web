// Votações com botões. Sem Discord aqui: só regras e banco (testável).
import { all, audit, one, run, tx } from '../db.js';

export const MAX_OPTIONS = 10;

const parse = (p) => (p ? { ...p, options: JSON.parse(p.options), hide_results: Boolean(p.hide_results) } : null);
export const getPoll = (id) => parse(one('SELECT * FROM polls WHERE id = ?', Number(id)));
export const listPolls = (limit = 50) => all('SELECT * FROM polls ORDER BY id DESC LIMIT ?', limit).map(parse);

/** "A | B | C" ou "A, B, C" → lista limpa e sem repetição. */
export function parseOptions(text) {
  const sep = String(text).includes('|') ? '|' : ',';
  const seen = new Set();
  return String(text).split(sep).map((s) => s.trim().slice(0, 80)).filter((s) => {
    const k = s.toLowerCase();
    if (!s || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function createPoll({ question, options, minutes = null, roleId = null, hideResults = false, createdBy, channelId = null }) {
  const q = String(question || '').trim().slice(0, 200);
  if (!q) return { error: 'Escreva a pergunta.' };
  if (options.length < 2) return { error: 'A votação precisa de pelo menos 2 opções.' };
  if (options.length > MAX_OPTIONS) return { error: `Use no máximo ${MAX_OPTIONS} opções.` };
  const ends = minutes ? Date.now() + Math.min(Number(minutes), 60 * 24 * 30) * 60_000 : null;
  const r = run(`INSERT INTO polls(question, options, channel_id, role_id, hide_results, ends_at, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)`,
    q, JSON.stringify(options), channelId, roleId, hideResults ? 1 : 0, ends, createdBy, Date.now());
  const id = Number(r.lastInsertRowid);
  audit(createdBy, 'votacao.criar', `#${id} ${q}`);
  return { ok: true, poll: getPoll(id) };
}

export const setPollMessage = (id, channelId, messageId) =>
  run('UPDATE polls SET channel_id = ?, message_id = ? WHERE id = ?', channelId, messageId, Number(id));

/**
 * Registra o voto. Clicar de novo na mesma opção retira o voto; em outra, troca.
 * hasRole: se a votação exige cargo, quem chama informa se o membro tem.
 */
export function vote(id, userId, optionIndex, { hasRole = true } = {}) {
  return tx(() => {
    const p = getPoll(id);
    if (!p) return { error: 'Votação não encontrada.' };
    if (p.status !== 'aberta' || (p.ends_at && p.ends_at <= Date.now())) return { error: 'Essa votação já foi encerrada.' };
    if (p.role_id && !hasRole) return { error: 'Você não tem o cargo necessário para votar.' };
    const idx = Number(optionIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.options.length) return { error: 'Opção inválida.' };
    const cur = one('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, userId);
    if (cur && cur.option_index === idx) {
      run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', p.id, userId);
      return { ok: true, action: 'removed', option: p.options[idx] };
    }
    run(`INSERT INTO poll_votes(poll_id, user_id, option_index, created_at) VALUES(?,?,?,?)
         ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index, created_at = excluded.created_at`,
    p.id, userId, idx, Date.now());
    return { ok: true, action: cur ? 'changed' : 'added', option: p.options[idx] };
  });
}

/** Contagem por opção, total e vencedor(es) (empates aparecem juntos). */
export function results(id) {
  const p = getPoll(id);
  const counts = p.options.map(() => 0);
  for (const r of all('SELECT option_index i, COUNT(*) n FROM poll_votes WHERE poll_id = ? GROUP BY option_index', p.id)) counts[r.i] = r.n;
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(...counts);
  const winners = total ? counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [];
  return { counts, total, winners };
}

export function closePoll(id, actorId = null) {
  const r = run(`UPDATE polls SET status = 'encerrada', closed_at = ? WHERE id = ? AND status = 'aberta'`, Date.now(), Number(id));
  if (r.changes) audit(actorId, 'votacao.encerrar', `#${id}`);
  return r.changes === 1;
}

export const duePolls = () => all(`SELECT id FROM polls WHERE status = 'aberta' AND ends_at IS NOT NULL AND ends_at <= ?`, Date.now()).map((r) => r.id);
export const userVote = (id, userId) => one('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?', Number(id), userId)?.option_index ?? null;
