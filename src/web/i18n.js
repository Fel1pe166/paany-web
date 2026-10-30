// Tradução das mensagens que o servidor devolve ao painel (erros e confirmações).
// O texto original é em português; aqui ficam as versões em inglês e espanhol.
export const LANGS = ['pt', 'en', 'es'];

const EXACT = {
  'Sessão expirada. Entre de novo.': ['Session expired. Please sign in again.', 'Sesión expirada. Inicia sesión de nuevo.'],
  'Requisição bloqueada (CSRF). Recarregue a página.': ['Request blocked (CSRF). Reload the page.', 'Solicitud bloqueada (CSRF). Recarga la página.'],
  'Use JSON.': ['Use JSON.', 'Usa JSON.'],
  'JSON inválido.': ['Invalid JSON.', 'JSON inválido.'],
  'Conteúdo grande demais.': ['Content too large.', 'Contenido demasiado grande.'],
  'Muitas requisições. Aguarde um minuto.': ['Too many requests. Wait a minute.', 'Demasiadas solicitudes. Espera un minuto.'],
  'Erro interno. A equipe foi avisada nos logs.': ['Internal error. It was recorded in the logs.', 'Error interno. Quedó registrado en los logs.'],
  'Rota não encontrada.': ['Route not found.', 'Ruta no encontrada.'],
  'Pedido não encontrado.': ['Order not found.', 'Pedido no encontrado.'],
  'Produto não encontrado.': ['Product not found.', 'Producto no encontrado.'],
  'Cupom não encontrado.': ['Coupon not found.', 'Cupón no encontrado.'],
  'Avaliação não encontrada.': ['Review not found.', 'Reseña no encontrada.'],
  'Cliente não encontrado.': ['Customer not found.', 'Cliente no encontrado.'],
  'Ação desconhecida.': ['Unknown action.', 'Acción desconocida.'],
  'Informe o nome.': ['Enter a name.', 'Escribe el nombre.'],
  'Preço inválido. Ex.: 8,00': ['Invalid price. E.g. 8.00', 'Precio inválido. Ej.: 8,00'],
  'Categoria inválida.': ['Invalid category.', 'Categoría inválida.'],
  'Tipo de entrega inválido.': ['Invalid delivery type.', 'Tipo de entrega inválido.'],
  'A imagem precisa ser um link https://.': ['The image must be an https:// link.', 'La imagen debe ser un enlace https://.'],
  'Dias de VIP inválidos.': ['Invalid VIP days.', 'Días de VIP inválidos.'],
  'Estoque inválido.': ['Invalid stock.', 'Stock inválido.'],
  'Entrega do tipo "Cargo" precisa de um cargo.': ['"Role" delivery needs a role.', 'La entrega tipo "Rol" necesita un rol.'],
  'Informe o conteúdo da entrega (link ou instruções).': ['Enter the delivery content (link or instructions).', 'Escribe el contenido de la entrega (enlace o instrucciones).'],
  'Cargo não encontrado no servidor.': ['Role not found in the server.', 'Rol no encontrado en el servidor.'],
  'Arquivo vazio.': ['Empty file.', 'Archivo vacío.'],
  'Imagem maior que 3 MB.': ['Image larger than 3 MB.', 'Imagen mayor de 3 MB.'],
  'Envie PNG, JPG, GIF ou WEBP.': ['Upload PNG, JPG, GIF or WEBP.', 'Sube PNG, JPG, GIF o WEBP.'],
  'Valor do desconto inválido.': ['Invalid discount value.', 'Valor de descuento inválido.'],
  'Data inválida.': ['Invalid date.', 'Fecha inválida.'],
  'A validade precisa ser depois do início.': ['The end date must be after the start.', 'La fecha final debe ser posterior al inicio.'],
  'Código inválido.': ['Invalid code.', 'Código inválido.'],
  'Já existe um cupom com esse código.': ['A coupon with this code already exists.', 'Ya existe un cupón con ese código.'],
  'Porcentagem deve ser entre 1 e 100.': ['Percentage must be between 1 and 100.', 'El porcentaje debe estar entre 1 y 100.'],
  'Valor do desconto deve ser maior que zero.': ['Discount must be greater than zero.', 'El descuento debe ser mayor que cero.'],
  'Pedidos do Mercado Pago são confirmados só pela API do Mercado Pago.': ['Mercado Pago orders are confirmed only by the Mercado Pago API.', 'Los pedidos de Mercado Pago solo los confirma la API de Mercado Pago.'],
  'O ID digitado não confere. Nada foi aprovado.': ['The typed ID does not match. Nothing was approved.', 'El ID escrito no coincide. No se aprobó nada.'],
  'Nada foi alterado.': ['Nothing changed.', 'No se cambió nada.'],
  'Pedido já confirmado anteriormente.': ['Order was already confirmed.', 'El pedido ya fue confirmado.'],
  'Valor pago diferente do valor do pedido.': ['Paid amount differs from the order amount.', 'El monto pagado difiere del pedido.'],
  'Evento já processado.': ['Event already processed.', 'Evento ya procesado.'],
  'Pagamento aprovado e produto entregue.': ['Payment approved and product delivered.', 'Pago aprobado y producto entregado.'],
  'Pagamento aprovado e produto entregue (DM do cliente fechada — ele vê em /meuspedidos).': ['Payment approved and product delivered (customer DMs closed — they can see it in /meuspedidos).', 'Pago aprobado y producto entregado (DM del cliente cerrada — lo ve en /meuspedidos).'],
  'Informe o motivo.': ['Enter a reason.', 'Escribe el motivo.'],
  'Esse pedido não está em aberto.': ['This order is not open.', 'Este pedido no está abierto.'],
  'Pedido recusado e cliente avisado.': ['Order rejected and customer notified.', 'Pedido rechazado y cliente avisado.'],
  'Mensagem de entrega reenviada na DM do cliente.': ['Delivery message resent to the customer\'s DMs.', 'Mensaje de entrega reenviado al DM del cliente.'],
  'A DM do cliente está fechada. Ele pode ver em /meuspedidos.': ['The customer\'s DMs are closed. They can see it in /meuspedidos.', 'El DM del cliente está cerrado. Puede verlo en /meuspedidos.'],
  'Entregue com sucesso.': ['Delivered successfully.', 'Entregado con éxito.'],
  'Pedido não encontrado ou não está em aberto.': ['Order not found or not open.', 'Pedido no encontrado o no abierto.'],
  'Estorno feito automaticamente pelo Mercado Pago.': ['Refund issued automatically by Mercado Pago.', 'Reembolso hecho automáticamente por Mercado Pago.'],
  'Pix manual: devolva o valor pelo app do seu banco (o bot não movimenta sua conta).': ['Manual Pix: return the money through your bank app (the bot does not move your money).', 'Pix manual: devuelve el dinero desde la app de tu banco (el bot no mueve tu cuenta).'],
  'Configurações salvas.': ['Settings saved.', 'Configuración guardada.'],
  'Produto duplicado.': ['Product duplicated.', 'Producto duplicado.'],
  'Sessão de login inválida. Tente de novo.': ['Invalid login session. Try again.', 'Sesión de inicio inválida. Inténtalo de nuevo.'],
  'O Discord recusou o login. Confira o Client Secret e o Redirect.': ['Discord rejected the login. Check the Client Secret and Redirect.', 'Discord rechazó el inicio. Revisa el Client Secret y el Redirect.'],
  'Não consegui ler sua conta do Discord.': ['Could not read your Discord account.', 'No pude leer tu cuenta de Discord.'],
  'Torneio cancelado.': ['Tournament cancelled.', 'Torneo cancelado.'],
  'Esse torneio não pode ser cancelado.': ['This tournament can\'t be cancelled.', 'Este torneo no se puede cancelar.'],
  'Votação encerrada.': ['Poll closed.', 'Votación cerrada.'],
  'Votação não encontrada.': ['Poll not found.', 'Votación no encontrada.'],
  'Essa votação já foi encerrada.': ['This poll is already closed.', 'Esta votación ya está cerrada.'],
  // Páginas HTML
  'Acesso negado': ['Access denied', 'Acceso denegado'],
  'Sua conta do Discord não está na lista de administradores da loja.': ['Your Discord account is not on the store\'s admin list.', 'Tu cuenta de Discord no está en la lista de administradores.'],
  'Não deu certo': ['Something went wrong', 'Algo salió mal'],
  'Tentar de novo': ['Try again', 'Intentar de nuevo'],
  'Não encontrado': ['Not found', 'No encontrado'],
  'Essa página não existe.': ['This page does not exist.', 'Esta página no existe.'],
  'Ir para o painel': ['Go to the panel', 'Ir al panel'],
  'Painel desligado': ['Panel disabled', 'Panel desactivado'],
  'Configure PUBLIC_URL, DISCORD_CLIENT_SECRET e PANEL_SECRET no .env para ligar o painel.': ['Set PUBLIC_URL, DISCORD_CLIENT_SECRET and PANEL_SECRET in .env to enable the panel.', 'Configura PUBLIC_URL, DISCORD_CLIENT_SECRET y PANEL_SECRET en el .env para activar el panel.'],
  'Muitas tentativas de login.': ['Too many login attempts.', 'Demasiados intentos de inicio.'],
};

// Mensagens com partes variáveis: [regex, en(m), es(m)]
const PATTERNS = [
  [/^Pedido (\S+) cancelado\.$/, (m) => `Order ${m[1]} cancelled.`, (m) => `Pedido ${m[1]} cancelado.`],
  [/^Pedido está "(.+)", não dá para entregar\.$/, (m) => `Order is "${m[1]}", it can't be delivered.`, (m) => `El pedido está "${m[1]}", no se puede entregar.`],
  [/^Pedido está "(.+)" e não pode ser reembolsado\.$/, (m) => `Order is "${m[1]}" and can't be refunded.`, (m) => `El pedido está "${m[1]}" y no se puede reembolsar.`],
  [/^Falhou de novo: (.+)$/, (m) => `Failed again: ${m[1]}`, (m) => `Falló de nuevo: ${m[1]}`],
  [/^O Mercado Pago recusou o estorno: (.+)$/, (m) => `Mercado Pago rejected the refund: ${m[1]}`, (m) => `Mercado Pago rechazó el reembolso: ${m[1]}`],
  [/^Pagamento aprovado, mas a entrega falhou: (.+)\. Use "Reenviar entrega"\.$/, (m) => `Payment approved, but delivery failed: ${m[1]}. Use "Retry delivery".`, (m) => `Pago aprobado, pero la entrega falló: ${m[1]}. Usa "Reintentar entrega".`],
  [/^Pedido reembolsado\. (.+)$/, (m) => `Order refunded. ${tr(m[1], 'en')}`, (m) => `Pedido reembolsado. ${tr(m[1], 'es')}`],
  [/^O cargo "(.+)" está acima do cargo da (.+)\. Arraste o cargo do bot para cima em Configurações do servidor → Cargos\.$/,
    (m) => `The role "${m[1]}" is above ${m[2]}'s role. Drag the bot's role higher in Server Settings → Roles.`,
    (m) => `El rol "${m[1]}" está por encima del rol de ${m[2]}. Sube el rol del bot en Ajustes del servidor → Roles.`],
];

/** Traduz uma mensagem do servidor. Mensagens desconhecidas voltam como estão. */
export function tr(text, lang) {
  if (!text || lang === 'pt' || !LANGS.includes(lang)) return text;
  const idx = lang === 'en' ? 0 : 1;
  if (EXACT[text]) return EXACT[text][idx];
  for (const [re, en, es] of PATTERNS) {
    const m = String(text).match(re);
    if (m) return (idx === 0 ? en : es)(m);
  }
  return text;
}

/** Idioma pedido: cookie "paany_lang" → cabeçalho X-Lang → Accept-Language. */
export function langOf(req) {
  const cookie = /(?:^|;\s*)paany_lang=(pt|en|es)/.exec(req.headers.cookie || '');
  if (cookie) return cookie[1];
  const h = String(req.headers['x-lang'] || '').slice(0, 2);
  if (LANGS.includes(h)) return h;
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  if (al.startsWith('es')) return 'es';
  return 'pt';
}
