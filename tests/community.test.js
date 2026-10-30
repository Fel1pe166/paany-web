// Testes de torneios, votações e busca de mídia (sem Discord e sem internet).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { openDb, run } = await import('../src/db.js');
openDb(':memory:');
const T = await import('../src/services/tournaments.js');
const P = await import('../src/services/polls.js');
const M = await import('../src/services/media.js');

function playTournament(n) {
  const t = T.createTournament({ name: `Copa ${n}`, maxPlayers: 64, createdBy: 'adm' });
  for (let k = 0; k < n; k++) assert.equal(T.join(t.id, `u${k}`).ok, true);
  const s = T.start(t.id, 'adm');
  assert.equal(s.ok, true);
  let guard = 0;
  let champion = null;
  while (!champion && guard++ < 200) {
    const open = T.openMatches(t.id);
    assert.ok(open.length, `deveria haver partida aberta (n=${n})`);
    const r = T.reportWinner(open[0].id, open[0].p1, 'adm');
    assert.equal(r.ok, true, r.error);
    champion = r.champion;
  }
  return { t: T.getTournament(t.id), champion, s };
}

test('torneio fecha com campeão para qualquer número de jogadores', () => {
  for (const n of [2, 3, 4, 5, 7, 8, 9, 16, 17, 33]) {
    const { t, champion, s } = playTournament(n);
    assert.equal(t.status, 'finalizado');
    assert.equal(t.winner_id, champion);
    assert.equal(s.rounds, Math.ceil(Math.log2(n)));
    // Todo mundo jogou ou passou direto; ninguém aparece duas vezes na 1ª rodada
    const r1 = T.matches(t.id).filter((m) => m.round === 1).flatMap((m) => [m.p1, m.p2]).filter(Boolean);
    assert.equal(new Set(r1).size, n);
    assert.equal(T.matches(t.id).filter((m) => m.round === 1 && !m.p1 && !m.p2).length, 0);
  }
});

test('inscrição: vagas, duplicidade, sair e inscrição fechada', () => {
  const t = T.createTournament({ name: 'Mini', maxPlayers: 2, createdBy: 'adm' });
  assert.equal(T.join(t.id, 'a').ok, true);
  assert.match(T.join(t.id, 'a').error, /já está inscrito/);
  assert.equal(T.join(t.id, 'b').ok, true);
  assert.match(T.join(t.id, 'c').error, /vagas/);
  assert.equal(T.leave(t.id, 'b').ok, true);
  assert.match(T.start(t.id, 'adm').error, /pelo menos 2/);
  T.join(t.id, 'b');
  assert.equal(T.start(t.id, 'adm').ok, true);
  assert.match(T.join(t.id, 'c').error, /fechadas/);
  assert.match(T.leave(t.id, 'a').error, /já começou/);
});

test('resultado: só jogador da partida, sem repetir', () => {
  const t = T.createTournament({ name: 'Duelo', createdBy: 'adm' });
  T.join(t.id, 'x'); T.join(t.id, 'y');
  T.start(t.id, 'adm');
  const [m] = T.openMatches(t.id);
  assert.match(T.reportWinner(m.id, 'intruso', 'adm').error, /não está na partida/);
  const r = T.reportWinner(m.id, 'y', 'adm');
  assert.equal(r.champion, 'y');
  assert.ok(T.reportWinner(m.id, 'x', 'adm').error);
  assert.equal(T.cancel(t.id, 'adm').error !== undefined, true);
});

test('nomes das rodadas', () => {
  assert.equal(T.roundName(3, 3), 'Final');
  assert.equal(T.roundName(2, 3), 'Semifinal');
  assert.equal(T.roundName(1, 3), 'Quartas de final');
  assert.equal(T.roundName(1, 6), 'Rodada 1');
});

test('votação: opções, voto, troca, retirada e resultado', () => {
  assert.deepEqual(P.parseOptions('Sim | Não | sim |  | Talvez'), ['Sim', 'Não', 'Talvez']);
  assert.deepEqual(P.parseOptions('a, b'), ['a', 'b']);
  assert.match(P.createPoll({ question: 'X?', options: ['só uma'], createdBy: 'adm' }).error, /2 opções/);
  const { poll } = P.createPoll({ question: 'Melhor editor?', options: ['AE', 'Alight', 'CapCut'], createdBy: 'adm' });
  assert.equal(P.vote(poll.id, 'u1', 0).action, 'added');
  assert.equal(P.vote(poll.id, 'u2', 0).action, 'added');
  assert.equal(P.vote(poll.id, 'u3', 2).action, 'added');
  assert.equal(P.vote(poll.id, 'u3', 1).action, 'changed');
  assert.equal(P.vote(poll.id, 'u2', 0).action, 'removed');
  assert.match(P.vote(poll.id, 'u4', 9).error, /inválida/);
  const r = P.results(poll.id);
  assert.deepEqual(r.counts, [1, 1, 0]);
  assert.equal(r.total, 2);
  assert.deepEqual(r.winners, [0, 1]);
  assert.equal(P.userVote(poll.id, 'u3'), 1);
  assert.equal(P.closePoll(poll.id), true);
  assert.equal(P.closePoll(poll.id), false);
  assert.match(P.vote(poll.id, 'u5', 0).error, /encerrada/);
});

test('votação com cargo e com prazo vencido', () => {
  const { poll } = P.createPoll({ question: 'VIP decide?', options: ['A', 'B'], roleId: 'r1', createdBy: 'adm' });
  assert.match(P.vote(poll.id, 'u1', 0, { hasRole: false }).error, /cargo/);
  assert.equal(P.vote(poll.id, 'u1', 0, { hasRole: true }).ok, true);
  const { poll: p2 } = P.createPoll({ question: 'Rápida?', options: ['A', 'B'], minutes: 1, createdBy: 'adm' });
  run('UPDATE polls SET ends_at = ? WHERE id = ?', Date.now() - 1000, p2.id);
  assert.ok(P.duePolls().includes(p2.id));
  assert.match(P.vote(p2.id, 'u1', 0).error, /encerrada/);
});

test('mídia: conversão das respostas do Pexels, Pixabay e Jamendo', () => {
  const px = M.mapPexels({ videos: [{ id: 1, url: 'https://pexels.com/v/1', image: 'https://img', duration: 12, user: { name: 'Ana', url: 'https://pexels.com/@ana' },
    video_files: [{ link: 'https://a/4k.mp4', width: 3840, height: 2160, file_type: 'video/mp4' }, { link: 'https://a/hd.mp4', width: 1920, height: 1080, file_type: 'video/mp4' }] }] });
  assert.equal(px[0].download, 'https://a/hd.mp4');
  assert.equal(px[0].author, 'Ana');
  const pb = M.mapPixabay({ hits: [{ id: 2, pageURL: 'https://pixabay.com/v/2', tags: 'smoke, dark, fog, x', duration: 8, user: 'Leo', user_id: 9,
    videos: { large: { url: '', width: 0, height: 0 }, medium: { url: 'https://p/m.mp4', width: 1920, height: 1080, thumbnail: 'https://p/t.jpg' } } }] });
  assert.equal(pb[0].download, 'https://p/m.mp4');
  assert.equal(pb[0].title, 'smoke, dark, fog');
  const jm = M.mapJamendo({ results: [
    { id: 3, name: 'Lofi', artist_name: 'Zé', duration: 125, shareurl: 'https://jamendo.com/t/3', audio: 'https://s', audiodownload: 'https://d', audiodownload_allowed: true, license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/' },
    { id: 4, name: 'Epic', artist_name: 'Bia', duration: 60, shareurl: 'https://jamendo.com/t/4', audio: 'https://s2', audiodownload: '', audiodownload_allowed: false, license_ccurl: 'http://creativecommons.org/licenses/by/3.0/' },
  ] });
  assert.equal(jm[0].license, 'CC BY-NC-SA 3.0');
  assert.equal(jm[0].nonCommercial, true);
  assert.equal(jm[1].download, null);
  assert.equal(jm[1].nonCommercial, false);
  assert.equal(M.fmtDuration(125), '2:05');
});
