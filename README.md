# Laboratório de personagens · OnlyBomb

[Abrir laboratório](https://gomesforge.github.io/onlybomb-character-lab/)

Ferramenta interna deste projeto para importar, inspecionar e testar personagens. Publicada no GitHub Pages. Não é uma ferramenta oficial da Hudson ou da equipe do servidor.

## Uso

1. A página sempre abre **sem personagem**. Importe um ZIP, uma pasta ou os 37 GRA com `character.json`.
2. A importação é processada **somente neste navegador**. Não há upload, login, telemetria ou persistência dos pacotes. Atualizar ou fechar a página limpa a sessão. Para reler arquivos modificados no computador, importe novamente.
3. Em **Animações**, escolha ação e direção, pause, avance quadro a quadro e compare com os looks oficiais. Louie e carrinho usam as camadas originais.
4. Em **Treino jogável**, inicie a arena: setas movem, espaço coloca bomba/usa luva, Z usa habilidade. É o Training original, com Match, World, Player e HUD, colisão, bombas, itens, bots e READY/GO. Os botões de diagnóstico forçam estados e registram essa distinção no relatório local.
5. Em **Continuidade**, compare poses na mesma âncora. Em **Validação**, confira contagens, RLE, dimensões, JSON e bordas. Baixe o relatório explicitamente se desejar guardá-lo.

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
