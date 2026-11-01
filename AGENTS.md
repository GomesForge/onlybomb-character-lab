HD LOCAL —01/11/2026: importar hd.json+atlasPNG/WebP junto dos37GRA; hd-pack.mjs valida contrato atual/gradePNGantiga, hd-local.mjs anexa objetoscompatíveis Runs.hd com decoderoriginal hdPixels eHD_SHEETS. Treino renderiza shader/oclusão/desempenhooriginal Screen; inspeção permaneceGRA nativa. FalhasHD avisam e voltamaGRA, sem bloquear pacoteGRA válido; checkboxHD no treino+contadorvisible. Nenhum arquivo enviado. Não confundir HD com aumentarFPS nem chamar ampliação deGRA deHDautêntico.

ATUALIZAÇÃO 01/11/2026 — pedido atual: remover modo Ampliar arena; preservar tamanho normal e Tela cheia nativa. Mostrar Animação anterior à esquerda e Animação atual à direita com nomes exatos GRA destacados, observando drawBody/drawCart e a cada passo original, sem alterar estado ou relógio. Guia tem adição de apresentação navigation.js: índice rola apenas seu próprio contêiner para manter seção ativa visível. Conteúdo/anexos originais intactos; guia_apresentacao.verify remove só o TAG conhecido e confere SHA original. Não exigir mais identidade byte a byte do HTML final sem remover essa adição autorizada.

# Atualização vigente — publicação e importação, 01/11/2026

Treino usa a largura disponível e INICIA SEM AMPLIAR. Botões de diagnóstico ficam DENTRO do play-surface, ACIMA da arena, acessíveis também ampliado e em tela cheia. Caminhada forçada usa Input e colisão originais em corredor livre; registrar separadamente do teste manual. Ampliar arena e Tela cheia são opções MANUAIS. Padrão: Suave/xBR e movimento fluido (interpolação de posição original), sem alterar relógio, quadros ou física. A inspeção de GRA continua nativa; não aprovar arte apenas porque um filtro de apresentação melhora sua aparência. Escape sai da ampliação antes de abrir o menu de sair da partida. Mudanças de filtro podem reconstruir somente a instância Screen, preservando Match/World/Player.

Canvas real GRA:256×256; área x80–176/y88–216 é RECOMENDAÇÃO, opcional e tracejada, não limite nem máscara de recorte. Special_26 mo_w#2 tem caixa74,122,148,190 válida. Nunca recortar adereços oficiais nessa área nem sinalizar erro por ultrapassá-la. Corte real/RLE fora do canvas continua inválido. Guia integral em web/guia/index.html, cópia byte a byte do v3, SHA em ORIGEM_GUIA.json e conferido no build. Rota /guia/ funciona localmente e no Pages; não resumir ou remover anexos.

A interface deve iniciar vazia, sem carregar personagem até importação. Importados e relatórios ficam exclusivamente na memória da aba; não enviar arquivos, metadados ou diagnósticos a APIs. Recarregar a página limpa a sessão. O usuário autorizou GitHub Pages público caso acesso privado via convite não seja suportado pelo plano. Repositório: GomesForge/onlybomb-character-lab. URL: https://gomesforge.github.io/onlybomb-character-lab/.

Frontend estático em web; importação/validação em web/pack.mjs. Recursos necessários em web/data/img/i18n; não publicar entregas customizadas, contas, logs ou painel GM. Build via build_pages.py com caminhos de recursos sensíveis a maiúsculas/minúsculas. Novas mudanças devem passar testar_importacao.mjs e verificação real da importação e treino no navegador; preservar os 58 módulos originais.

# Contrato do simulador

Esta é a ferramenta interna oficial de teste dos personagens deste projeto, autorizada pelo usuário em01/11/2026. Iniciar em localhost:8768 via INICIAR.cmd ou python servidor.py. O servidor atende somente127.0.0.1.

Preservar os58módulos originais em web/js byte a byte; não alterar relógio, animação, física, colisão, máscaras ou seleção de sprites para fazer uma arte parecer correta. Adaptadores/interface em app.mjs e engine.mjs. Se o cliente de referência mudar, registrar a origem, comparar e refazer testes; nunca atualizar silenciosamente.

Todo personagem deve ser validado comoGRA real, visto nas37folhas no relógio original, comparado por continuidade e testado no modo Treino. Testes automáticos ou hashes únicos não aprovam movimento. Registrar separadamente ações forçadas e ações naturais. Não declarar teste em partida se houve só laboratório ou teste determinístico.

Não servir dados sensíveis do backup, nem conectar ao servidor de produção. O backend legado mantém importados até reiniciar o servidor, mas a interface não usa esse armazenamento; entregas originais são somente leitura. Não substituir arquivo faltante/corrompido porWhite silenciosamente. Não certificar aceitação pelo importador de produção; o backend desse importador não está no backup.

Antes de entregar mudanças da ferramenta, executar testar_servidor.py e testar_motor.cjs e testar importação + treino pelo navegador. Marcar a aba localhost como entregável para permanecer aberta. Guia definitivo v3 continua sendo a referência das artes.
