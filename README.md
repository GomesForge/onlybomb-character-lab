# Laboratório de personagens · OnlyBomb

[Abrir laboratório](https://gomesforge.github.io/onlybomb-character-lab/)

Ferramenta interna deste projeto para importar, inspecionar e testar personagens. Publicada no GitHub Pages. Não é uma ferramenta oficial da Hudson ou da equipe do servidor.

Antes de iniciar o treino, o laboratório verifica piso, blocos, sombras e fundo do mapa. Recursos ausentes são baixados novamente, contornando falhas de carregamento em cache. Se continuarem indisponíveis ou corrompidos, o treino não inicia e identifica o arquivo; isso evita arena preta e rastros de quadros anteriores. A recuperação é registrada no relatório local. Regressão: `node testar_recursos_treino.mjs`.

## Uso

1. A página sempre abre **sem personagem**. Importe uma pasta, ZIP ou GRA soltos, **com ou sem `character.json`**. Pode selecionar a coleção `TODOS_OS_PERSONAGENS`: cada subpasta vira um personagem na lista.
2. A importação é processada **somente neste navegador**. Não há upload, login, telemetria ou persistência dos pacotes. Atualizar ou fechar a página limpa a sessão. Para reler arquivos modificados no computador, importe novamente.
3. Em **Animações**, escolha ação e direção, pause, avance quadro a quadro e compare com os looks oficiais. Louie e carrinho usam as camadas originais.
4. Em **Treino jogável**, inicie a arena: setas movem, espaço coloca bomba/usa luva, Z usa habilidade. É o Training original, com Match, World, Player e HUD, colisão, bombas, itens, bots e READY/GO. Os botões de diagnóstico forçam estados e registram essa distinção no relatório local.
5. Em **Continuidade**, compare poses na mesma âncora. Em **Validação**, confira contagens, RLE, dimensões, JSON e bordas. Baixe o relatório explicitamente se desejar guardá-lo.

O treino inicia no modo normal, com os botões de diagnóstico acima da arena. No treino, a barra lateral é recolhida para a arena usar toda a largura disponível. **Tela cheia** usa a tela do navegador; Escape retorna à interface. A proporção original 4:3 é preservada, sem esticar ou cortar o campo. Os filtros **Nítido**, **Suave (xBR)**, **Clássico** e **CRT** usam o renderizador original; a opção de movimento fluido interpola o deslocamento entre os passos de20ms, sem criar ou retardar quadros de animação. A inspeção das folhas continua em RGB565 nativo.

O site e este repositório são públicos: o plano disponível não permitiu Pages em repositório privado. Os personagens customizados não fazem parte do repositório nem da publicação.

## Motor e recursos

Os 58 módulos em `web/js` permanecem byte a byte idênticos ao código do cliente do backup de 31/10/2026. Os hashes estão em `ORIGEM_MODULOS.json`. Os recursos gráficos/áudio do cliente estão em `web/data`, com traduções e imagens auxiliares. Dados de contas, registros e painel GM não estão incluídos. Não há conexão com o servidor de produção.

`web/engine.mjs` executa o relógio real do cliente em passos de 20 ms; não altera FPS para fazer a arte parecer correta. `web/app.mjs` integra a interface ao treino; `web/pack.mjs` importa e valida no navegador. A montagem do jogador de teste recebe diretamente os Runs decodificados do pacote importado; sua identidade não é substituída pelo personagem oficial usado pelo carregador de treino.

Atordoado repete na inspeção; no treino dura 1 s. Prévia, carrinho e retrato usam o quadro 0. A derrota não expõe o último quadro no relógio do jogo; a inspeção manual permite vê-lo. Repetir ações únicas insere uma pausa identificada de inspeção, sem alterar o relógio original. Naturalidade, identidade e aceitação pelo importador de produção exigem verificações próprias.

## Executar localmente

Com Python 3, execute `INICIAR.cmd` no Windows ou `python servidor.py`. Abra http://localhost:8768/. Os recursos necessários estão neste repositório; não é necessário ter o backup externo. O servidor legado mantém endpoints locais de validação, mas a interface não os utiliza para importar nem enviar relatórios.

Para simular a publicação estática:

```sh
python build_pages.py
python -m http.server 8769 --bind 127.0.0.1
```

Abra http://localhost:8769/dist/. O build mantém as grafias exatas das URLs de recursos, inclusive em Linux, sem modificar os módulos originais.

## Verificar e publicar

```sh
node testar_importacao.mjs
python build_pages.py
```

Node 22 ou superior. Testa ZIP armazenado/deflate, CRC, limites, arquivos corrompidos, duplicatas, JSON, 37 folhas e integridade dos 58 módulos. Não requer dependências npm.

`testar_servidor.py` e `testar_motor.cjs` são verificações adicionais do ambiente de produção local; seus testes de arte real pressupõem o backup e as entregas locais. O segundo executa os relógios originais, sem automação do navegador. Resultados locais não são publicados.

O workflow `.github/workflows/pages.yml` testa, constrói `dist` e publica via GitHub Pages em cada push para `main`. Em Settings → Pages, a origem deve ser GitHub Actions.

Guia definitivo integral: [Guia completo](https://gomesforge.github.io/onlybomb-character-lab/guia/), disponível em /guia/ também no localhost. Inclui todos os anexos originais; SHA-256 conferido no build. Os controles de diagnóstico ficam no topo da arena, inclusive em tela cheia. A guia azul mostra o canvas real; a área amarela opcional é apenas recomendada e não recorta adereços oficiais.

Para conferir o relógio de outro pacote local, `node --experimental-vm-modules testar_motor.cjs "caminho/da/pasta-com-os-GRA"`. Esse teste executa o grafo original sem interface; não substitui o treino no navegador nem a avaliação visual de cada quadro.


Atualização de interface: nomes exatos da animação anterior/atual em destaque, inclusive por teclado. Modo de expansão artificial removido; Tela cheia nativa permanece opcional. O índice do guia acompanha a seção atual. Texto e108anexos permanecem intactos: build verifica o SHA original após remover somente a tag da melhoria de navegação autorizada.


### Personagens HD do backup

Importe as folhas GRA, com ou sem character.json, junto de uma pasta hd/ com hd.json e os atlas <folha>.png ou <folha>.webp. Também pode selecionar os arquivos juntos. O contrato é o do backup: format, scale, grey_bit, sheets com frames/box/size/rects; a grade PNG antiga com cols também funciona. Os35slots de partida podem ter HD; preview/face continuam nativos, como o cliente original.

HD no treino usa hdPixels, HD_SHEETS e o shader/oclusão/desempenho do Screen original, sem modificar os58módulos ou os relógios. A inspeção de GRA e seus limites permanece nativa. Desmarque HD no treino para comparar. O contador informa quantas folhas estão efetivamente sendo usadas pelo passe HD. Arquivo ausente, contagem divergente, retângulo inválido ou imagem que falha ao decodificar retorna ao GRA daquela folha, com aviso. Sem WebGL ou quando o controle original detecta aparelho lento, o GRA também permanece.

Importação exclusivamente local, sem envio. Limites:32MB por arquivo,128MB porZIP,256MB de conteúdo reconhecido,10000arquivos reconhecidos e40000entradas no diretório ZIP. Testes: testar_hd.mjs, testar_importacao.mjs, testar_motor.cjs e navegador com PNG antigo/WebP/HDdesligado/atlas corrompido. Fixtures técnicas em .test-data não são arte de personagem nem publicadas no site.


### Importação dos personagens originais e versões regionais

O GRA binário é a fonte de verdade. JSON ausente, inválido ou divergente não impede reprodução de GRA válido. As recomendações de contagem/tamanho para criar e enviar personagens são avisos, separados da leitura no laboratório. Corrupção RLE, assinatura, offsets e limites de memória continuam sendo erros.

Pastas com `ARQUIVOS_DO_JOGO` são reconhecidas automaticamente. ZIP/pasta contendo vários personagens separa cada um, preservando seus nomes. PNGs de revisão e mapas são ignorados. A pasta Lui é reconhecida como montaria com suas8folhas de movimento/repouso. Folhas adicionais (add, ho_*, rui_ri etc.) aparecem na lista de inspeção: o loop de60ms dessas folhas é apenas inspeção, pois elas não fazem parte dos37slots deste cliente.

`preview.gra` ausente usa explicitamente `st_s.gra` na prévia. Soco ausente desabilita seu diagnóstico; se o estado for acionado pelo próprio jogo, usa o repouso do mesmo personagem e identifica isso no nome/relatório. Outras ações ausentes também são indicadas; não há substituição por White. Os arquivos originais não são modificados.

Verificação integral local do kit: `node --experimental-vm-modules testar_motor.cjs --kit`. Este teste importa cada pasta sem JSON, decodifica e desenha todos os quadros com Runs/FB originais e executa os relógios das folhas disponíveis. Resultado local em resultado_kit.json (não publicado). Limites de envio reconhecido:32MB/arquivo,128MB/ZIP,256MB no total,10000arquivos reconhecidos; o diretório ZIP pode ter até40000entradas incluindo conteúdo ignorado.
