import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { CATEGORIES } from '../theme.js';

const categoryChoices = Object.entries(CATEGORIES).map(([value, name]) => ({ name, value }));
const deliveryChoices = [
  { name: 'Cargo (VIP)', value: 'cargo' },
  { name: 'Link', value: 'link' },
  { name: 'Arquivo / download', value: 'arquivo' },
  { name: 'Texto / instruções', value: 'texto' },
];
const ADMIN = PermissionFlagsBits.Administrator;

export const commands = [
  /* ------------------------------ Clientes ------------------------------ */
  new SlashCommandBuilder().setName('loja').setDescription('Abrir a loja')
    .addStringOption((o) => o.setName('categoria').setDescription('Filtrar por categoria').addChoices(...categoryChoices))
    .addStringOption((o) => o.setName('busca').setDescription('Pesquisar pelo nome').setMaxLength(50)),

  new SlashCommandBuilder().setName('comprar').setDescription('Comprar um produto')
    .addStringOption((o) => o.setName('produto').setDescription('Nome do produto').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('cupom').setDescription('Cupom de desconto').setMaxLength(32)),

  new SlashCommandBuilder().setName('meuspedidos').setDescription('Ver os seus pedidos'),

  new SlashCommandBuilder().setName('pedido').setDescription('Consultar um pedido seu')
    .addStringOption((o) => o.setName('id').setDescription('ID do pedido (ex.: CUT-ABCD1234)').setRequired(true).setMaxLength(20)),

  new SlashCommandBuilder().setName('suporte').setDescription('Abrir um ticket de suporte'),
  new SlashCommandBuilder().setName('ajuda').setDescription('Ver os comandos'),
  new SlashCommandBuilder().setName('termos').setDescription('Termos, reembolso e privacidade'),

  /* ------------------------------ Comunidade ------------------------------ */
  new SlashCommandBuilder().setName('torneio').setDescription('Torneios do servidor')
    .addSubcommand((s) => s.setName('criar').setDescription('Criar torneio neste canal (equipe)')
      .addStringOption((o) => o.setName('nome').setDescription('Nome do torneio').setRequired(true).setMaxLength(80))
      .addIntegerOption((o) => o.setName('vagas').setDescription('Máximo de jogadores (2 a 64, padrão 16)').setMinValue(2).setMaxValue(64))
      .addStringOption((o) => o.setName('premio').setDescription('Prêmio, ex.: VIP KingX 30 dias').setMaxLength(200))
      .addStringOption((o) => o.setName('descricao').setDescription('Regras e informações').setMaxLength(1000)))
    .addSubcommand((s) => s.setName('iniciar').setDescription('Fechar inscrições e sortear a chave (equipe)')
      .addStringOption((o) => o.setName('torneio').setDescription('Torneio').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('chave').setDescription('Ver a chave de um torneio')
      .addStringOption((o) => o.setName('torneio').setDescription('Torneio').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('cancelar').setDescription('Cancelar torneio (equipe)')
      .addStringOption((o) => o.setName('torneio').setDescription('Torneio').setRequired(true).setAutocomplete(true))),

  new SlashCommandBuilder().setName('votacao').setDescription('Votações do servidor (equipe)')
    .addSubcommand((s) => s.setName('criar').setDescription('Criar votação neste canal')
      .addStringOption((o) => o.setName('pergunta').setDescription('Pergunta').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('opcoes').setDescription('Opções separadas por | (ex.: Sim | Não | Talvez), até 10').setRequired(true).setMaxLength(900))
      .addIntegerOption((o) => o.setName('duracao_min').setDescription('Encerra sozinha após X minutos (vazio = só manual)').setMinValue(1).setMaxValue(43200))
      .addRoleOption((o) => o.setName('cargo').setDescription('Só quem tem este cargo pode votar'))
      .addBooleanOption((o) => o.setName('ocultar_resultado').setDescription('Mostrar o resultado só no fim')))
    .addSubcommand((s) => s.setName('encerrar').setDescription('Encerrar votação agora')
      .addStringOption((o) => o.setName('votacao').setDescription('Votação').setRequired(true).setAutocomplete(true))),

  new SlashCommandBuilder().setName('video').setDescription('Buscar vídeos gratuitos para edição (Pexels/Pixabay)')
    .addStringOption((o) => o.setName('busca').setDescription('O que procurar, ex.: city night, ocean, smoke').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('formato').setDescription('Orientação')
      .addChoices({ name: 'Horizontal', value: 'horizontal' }, { name: 'Vertical (TikTok/Reels)', value: 'vertical' }, { name: 'Quadrado', value: 'quadrado' }))
    .addBooleanOption((o) => o.setName('publico').setDescription('Mostrar para todos no canal')),

  new SlashCommandBuilder().setName('musica').setDescription('Buscar músicas livres (Creative Commons, Jamendo)')
    .addStringOption((o) => o.setName('busca').setDescription('Gênero, clima ou nome, ex.: lofi, phonk, epic').setRequired(true).setMaxLength(100))
    .addBooleanOption((o) => o.setName('publico').setDescription('Mostrar para todos no canal')),

  /* ---------------------------- Administração ---------------------------- */
  new SlashCommandBuilder().setName('admin').setDescription('Painel administrativo').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('painel').setDescription('Resumo de vendas, pendências e falhas'))
    .addSubcommand((s) => s.setName('backup').setDescription('Gerar e baixar um backup do banco de dados'))
    .addSubcommand((s) => s.setName('logs').setDescription('Últimas ações administrativas')),

];

const produto = new SlashCommandBuilder().setName('produto').setDescription('Gerenciar produtos').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('adicionar').setDescription('Criar produto (abre formulário para textos)')
      .addStringOption((o) => o.setName('nome').setDescription('Nome').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('preco').setDescription('Preço em reais, ex.: 8,00').setRequired(true))
      .addStringOption((o) => o.setName('categoria').setDescription('Categoria').setRequired(true).addChoices(...categoryChoices))
      .addStringOption((o) => o.setName('entrega').setDescription('Tipo de entrega').setRequired(true).addChoices(...deliveryChoices))
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo liberado na compra (VIP)'))
      .addIntegerOption((o) => o.setName('dias_vip').setDescription('Duração do VIP em dias (vazio = permanente)').setMinValue(1).setMaxValue(3650))
      .addIntegerOption((o) => o.setName('estoque').setDescription('Quantidade (vazio = ilimitado)').setMinValue(0))
      .addStringOption((o) => o.setName('imagem').setDescription('Link direto da imagem (https://...png/jpg/gif)')))
  .addSubcommand((s) => s.setName('editar').setDescription('Editar produto')
    .addStringOption((o) => o.setName('produto').setDescription('Produto').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('nome').setDescription('Novo nome').setMaxLength(80))
    .addStringOption((o) => o.setName('preco').setDescription('Novo preço, ex.: 9,90'))
    .addStringOption((o) => o.setName('categoria').setDescription('Nova categoria').addChoices(...categoryChoices))
    .addStringOption((o) => o.setName('entrega').setDescription('Novo tipo de entrega').addChoices(...deliveryChoices))
    .addRoleOption((o) => o.setName('cargo').setDescription('Novo cargo'))
    .addIntegerOption((o) => o.setName('dias_vip').setDescription('Dias de VIP (0 = permanente)').setMinValue(0).setMaxValue(3650))
    .addStringOption((o) => o.setName('imagem').setDescription('Link direto da imagem ("remover" para tirar)'))
    .addBooleanOption((o) => o.setName('textos').setDescription('Editar descrição, regras e conteúdo da entrega'))
    .addBooleanOption((o) => o.setName('ativo').setDescription('Mostrar na loja?')))
  .addSubcommand((s) => s.setName('remover').setDescription('Tirar produto da loja (o histórico é mantido)')
    .addStringOption((o) => o.setName('produto').setDescription('Produto').setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName('listar').setDescription('Listar todos os produtos'))
  .addSubcommand((s) => s.setName('estoque').setDescription('Definir estoque')
    .addStringOption((o) => o.setName('produto').setDescription('Produto').setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName('quantidade').setDescription('Nova quantidade').setMinValue(0))
    .addBooleanOption((o) => o.setName('ilimitado').setDescription('Estoque ilimitado')));

commands.push(
  produto,

  new SlashCommandBuilder().setName('gpedido').setDescription('Gerenciar pedidos').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('consultar').setDescription('Ver qualquer pedido')
      .addStringOption((o) => o.setName('id').setDescription('ID do pedido').setRequired(true)))
    .addSubcommand((s) => s.setName('aprovar').setDescription('Aprovar Pix manual (após conferir o extrato)')
      .addStringOption((o) => o.setName('id').setDescription('ID do pedido').setRequired(true)))
    .addSubcommand((s) => s.setName('reenviar').setDescription('Tentar entregar de novo (sem cobrar)')
      .addStringOption((o) => o.setName('id').setDescription('ID do pedido').setRequired(true)))
    .addSubcommand((s) => s.setName('cancelar').setDescription('Cancelar pedido em aberto')
      .addStringOption((o) => o.setName('id').setDescription('ID do pedido').setRequired(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo')))
    .addSubcommand((s) => s.setName('reembolsar').setDescription('Reembolsar pedido pago')
      .addStringOption((o) => o.setName('id').setDescription('ID do pedido').setRequired(true))
      .addBooleanOption((o) => o.setName('remover_cargo').setDescription('Remover o cargo VIP do cliente?'))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo')))
    .addSubcommand((s) => s.setName('cliente').setDescription('Histórico de um cliente')
      .addUserOption((o) => o.setName('usuario').setDescription('Cliente').setRequired(true)))
    .addSubcommand((s) => s.setName('pendentes').setDescription('Pedidos em análise e falhas de entrega')),

  new SlashCommandBuilder().setName('cupom').setDescription('Cupons e promoções').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('criar').setDescription('Criar cupom')
      .addStringOption((o) => o.setName('codigo').setDescription('Código, ex.: CUTIFY10').setRequired(true).setMaxLength(32))
      .addStringOption((o) => o.setName('tipo').setDescription('Tipo de desconto').setRequired(true)
        .addChoices({ name: 'Porcentagem (%)', value: 'percent' }, { name: 'Valor fixo (R$)', value: 'fixed' }))
      .addStringOption((o) => o.setName('valor').setDescription('Ex.: 10 (para 10%) ou 2,50 (para R$ 2,50)').setRequired(true))
      .addIntegerOption((o) => o.setName('usos').setDescription('Limite total de usos (vazio = ilimitado)').setMinValue(1))
      .addIntegerOption((o) => o.setName('validade_dias').setDescription('Vale por quantos dias (vazio = sem fim)').setMinValue(1))
      .addIntegerOption((o) => o.setName('comeca_em_horas').setDescription('Promoção agendada: começa daqui a X horas').setMinValue(1))
      .addStringOption((o) => o.setName('produto').setDescription('Só para este produto').setAutocomplete(true))
      .addStringOption((o) => o.setName('minimo').setDescription('Valor mínimo do produto, ex.: 10,00'))
      .addBooleanOption((o) => o.setName('um_por_cliente').setDescription('Cada cliente usa uma vez (padrão: sim)')))
    .addSubcommand((s) => s.setName('listar').setDescription('Listar cupons'))
    .addSubcommand((s) => s.setName('desativar').setDescription('Desativar cupom')
      .addStringOption((o) => o.setName('codigo').setDescription('Código').setRequired(true))),

  new SlashCommandBuilder().setName('vendas').setDescription('Relatório de vendas').setDefaultMemberPermissions(ADMIN)
    .addIntegerOption((o) => o.setName('dias').setDescription('Período em dias (padrão 30)').setMinValue(1).setMaxValue(3650)),

  new SlashCommandBuilder().setName('vip').setDescription('Gerenciar VIPs').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('listar').setDescription('VIPs ativos'))
    .addSubcommand((s) => s.setName('dar').setDescription('Dar VIP manualmente (sem venda)')
      .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addStringOption((o) => o.setName('produto').setDescription('Plano VIP').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('motivo').setDescription('Motivo').setRequired(true)))
    .addSubcommand((s) => s.setName('remover').setDescription('Remover VIP')
      .addUserOption((o) => o.setName('usuario').setDescription('Membro').setRequired(true))
      .addRoleOption((o) => o.setName('cargo').setDescription('Cargo VIP').setRequired(true))),

  new SlashCommandBuilder().setName('configurar').setDescription('Configurar a Paany').setDefaultMemberPermissions(ADMIN)
    .addSubcommand((s) => s.setName('canais').setDescription('Canais de log, aprovação e tickets')
      .addChannelOption((o) => o.setName('vendas').setDescription('Log de vendas').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('admin').setDescription('Log administrativo').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('erros').setDescription('Log de erros').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('aprovacoes').setDescription('Onde chegam os Pix manuais para aprovar').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('avaliacoes').setDescription('Onde as avaliações dos clientes são publicadas').addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('categoria_tickets').setDescription('Categoria dos tickets').addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((s) => s.setName('painel-loja').setDescription('Publicar a vitrine da loja neste canal'))
    .addSubcommand((s) => s.setName('painel-suporte').setDescription('Publicar o painel de tickets neste canal'))
    .addSubcommand((s) => s.setName('termos').setDescription('Editar os termos da loja'))
    .addSubcommand((s) => s.setName('ver').setDescription('Ver a configuração atual')),
);

export const commandsJson = () => commands.map((c) => c.toJSON());
