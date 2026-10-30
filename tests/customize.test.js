// Testes da personalização de tickets, avaliação do atendimento e embeds com botões.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { openDb, run } = await import('../src/db.js');
openDb(':memory:');
const C = await import('../src/services/ticketConfig.js');
const TK = await import('../src/services/tickets.js');
const E = await import('../src/services/embeds.js');

test('config de tickets: padrão, salvar, validar e restaurar', () => {
  const d = C.getTicketConfig();
  assert.equal(d.panel.title, 'Central de suporte');
  assert.equal(d.options.length, 6);
  const s = C.saveTicketConfig({ panel: { title: 'Suporte Cutify', color: '#7c3aed', banner: 'https://i.imgur.com/x.png' } }, 'adm');
  assert.equal(s.panel.title, 'Suporte Cutify');
  assert.equal(C.getTicketConfig().panel.color, '#7c3aed');
  assert.equal(C.getTicketConfig().panel.description, d.panel.description); // o resto fica
  assert.throws(() => C.saveTicketConfig({ panel: { color: 'roxo' } }, 'adm'), /Cor inválida/);
  assert.throws(() => C.saveTicketConfig({ panel: { banner: 'ftp://x' } }, 'adm'), /banner/);
  assert.equal(C.resetTicketConfig('adm').panel.title, 'Central de suporte');
});

test('opções do menu: nova recebe id próprio, emoji validado, pelo menos uma ativa', () => {
  const cur = C.getTicketConfig().options;
  const s = C.saveTicketConfig({ options: [...cur, { label: 'Parcerias', description: 'Propostas', emoji: '🤝' }, { label: 'Bugs', emoji: '<:bug:123456789012345678>' }] }, 'adm');
  const custom = s.options.filter((o) => !C.BUILTIN_REASONS[o.value]);
  assert.equal(custom.length, 2);
  assert.notEqual(custom[0].value, custom[1].value);
  assert.match(custom[0].value, /^c\d+$/);
  assert.equal(C.reasonLabel(custom[0].value), 'Parcerias');
  assert.equal(C.reasonLabel('comprovante'), 'Comprovante de Pix manual');
  assert.throws(() => C.saveTicketConfig({ options: [{ label: 'X', emoji: 'abc' }] }, 'adm'), /Emoji inválido/);
  assert.throws(() => C.saveTicketConfig({ options: [{ label: 'X', enabled: false }] }, 'adm'), /pelo menos uma/);
  assert.throws(() => C.saveTicketConfig({ options: [{ label: '' }] }, 'adm'), /nome/);
  assert.deepEqual(C.parseEmoji('<a:dance:123456789012345678>'), { id: '123456789012345678', name: 'dance', animated: true });
  assert.deepEqual(C.parseEmoji('🎫'), { name: '🎫' });
  assert.equal(C.fillTemplate('Oi {usuario}, {motivo}', { usuario: 'Ana', motivo: 'VIP' }), 'Oi Ana, VIP');
});

test('avaliação do atendimento: só quem abriu, depois de fechado, uma vez', () => {
  run(`INSERT INTO tickets(channel_id, user_id, reason, status, claimed_by, created_at) VALUES('ch1','cli','pagamento','aberto','staff1',?)`, Date.now());
  const t = TK.openTicketOf('cli');
  assert.match(TK.saveTicketRating({ ticketId: t.id, userId: 'cli', rating: 5 }).error, /aberto/);
  run(`UPDATE tickets SET status = 'fechado', closed_by = 'staff2' WHERE id = ?`, t.id);
  assert.match(TK.saveTicketRating({ ticketId: t.id, userId: 'outro', rating: 5 }).error, /não encontrado/);
  assert.match(TK.saveTicketRating({ ticketId: t.id, userId: 'cli', rating: 9 }).error, /inválida/);
  const r = TK.saveTicketRating({ ticketId: t.id, userId: 'cli', rating: 4, comment: 'Rápido!' });
  assert.equal(r.ok, true);
  assert.equal(r.staffId, 'staff1'); // quem assumiu tem prioridade sobre quem fechou
  assert.match(TK.saveTicketRating({ ticketId: t.id, userId: 'cli', rating: 5 }).error, /já avaliou/);
  const s = TK.ticketRatingStats();
  assert.equal(s.count, 1);
  assert.equal(s.byStaff[0].staff_id, 'staff1');
});

test('embeds: validação, botões em texto e mensagem do Discord', () => {
  assert.throws(() => E.normalizeEmbed({}), /pelo menos/);
  assert.throws(() => E.normalizeEmbed({ title: 'x', color: 'azul' }), /Cor/);
  assert.throws(() => E.normalizeEmbed({ title: 'x', buttons: [{ label: 'Site', action: 'link', value: 'site.com' }] }), /link/);
  assert.throws(() => E.normalizeEmbed({ title: 'x', buttons: Array.from({ length: 11 }, () => ({ label: 'a', action: 'store' })) }), /no máximo/);
  const guild = { roles: { cache: new Map([['111111111111111111', { id: '111111111111111111', name: 'Avisos' }]]) } };
  guild.roles.cache.find = (fn) => [...guild.roles.cache.values()].find(fn);
  const btns = E.parseButtonLines('🌐 Site | https://cutify.com\nComprar | loja\nSuporte | ticket\nAvisos | cargo avisos', guild);
  assert.equal(btns.length, 4);
  assert.equal(btns[0].emoji, '🌐');
  assert.equal(btns[0].label, 'Site');
  assert.deepEqual(btns.map((b) => b.action), ['link', 'store', 'ticket', 'role']);
  assert.equal(btns[3].value, '111111111111111111');
  assert.throws(() => E.parseButtonLines('Errado | qualquer coisa', guild), /Não entendi/);
  assert.throws(() => E.parseButtonLines('X | cargo Inexistente', guild), /não encontrado/);
  assert.equal(E.buttonsToLines(btns, guild).split('\n')[3], 'Avisos | cargo Avisos');
  const d = E.normalizeEmbed({ title: 'Regras', description: '**1.** Respeito', color: '#ff0000', buttons: btns });
  const msg = E.buildMessage(d);
  assert.equal(msg.components.length, 1);
  assert.deepEqual(msg.allowedMentions, { parse: [] });
  const rec = E.saveEmbed({ name: '', data: d }, 'adm');
  assert.equal(rec.name, 'Regras');
  assert.equal(E.listEmbeds().length, 1);
  assert.equal(E.deleteEmbedRecord(rec.id, 'adm'), true);
});
