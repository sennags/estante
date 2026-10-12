# Trama

Aplicação web para escritores organizarem e terminarem suas histórias, reunindo planejamento, referências e escrita no mesmo lugar. O nome joga com os dois sentidos da palavra: o enredo de uma história e o entrelaçado de fios de um tecido, como os fios narrativos que o app ajuda a acompanhar. Funciona no computador e no celular, e todos os dados ficam salvos no próprio navegador.

## O que já funciona

- **Biblioteca**: as histórias ficam numa estante, separadas pela fase (planejamento, escrita e revisão). Cada uma tem título, sinopse, gênero e capa, com uma cor ou uma imagem sua. No topo há um atalho para o último capítulo editado.
- **Editor em folha de papel**:
  - O texto passa sozinho para a página seguinte quando a atual enche. A numeração de páginas segue pelo livro inteiro, e cada capítulo começa numa página nova.
  - O botão **+ Nova página em branco** cria uma página vazia no fim do capítulo.
  - Salva sozinho e mostra a contagem de palavras.
  - Tem negrito e itálico.
  - O **modo foco** esconde tudo menos a folha. Para sair, aperte Esc. No celular ele não aparece, porque a tela já mostra só a folha.
  - A barra de ferramentas pode ser recolhida.
  - **Versões**: uma cópia do capítulo é guardada sozinha a cada 10 minutos de escrita, e você também pode guardar uma na hora. Qualquer versão pode ser restaurada.
  - **Versões** fica no topo da folha, ao lado de Referências.
- **Exportação** da história inteira em `.docx` e PDF, pelo botão abaixo dos capítulos no menu lateral.
- **Lixeira**: uma história apagada vai para a lixeira e fica lá por 7 dias. Nesse prazo dá para devolvê-la à estante ou apagá-la na hora; depois disso, ela é apagada sozinha.
- **Rascunhos**: o que você digita ao criar ou editar uma história fica guardado até salvar, mesmo se fechar a janela. A janela só fecha pelo botão Cancelar ou pelo X.
- **Personagens e universo**: fichas de personagens, lugares, objetos e regras do mundo. Personagens têm campos para motivações e relações. As fichas podem ser consultadas num painel ao lado da folha enquanto você escreve.
- **Planejamento**: a história vira um quadro em que cada capítulo é uma coluna e cada cena é um cartão.
  - Arraste os cartões para mudar a ordem ou o capítulo, e as colunas para reordenar os capítulos. No celular aparece um capítulo por vez, e o cartão é arrastado pela alça.
  - Cada cena tem título, descrição, objetivo, conflito, resultado, situação (planejada, escrita ou revisada), personagens envolvidos e narrador.
  - O capítulo tem um narrador padrão, que a cena herda ou troca por outro: um personagem das fichas ou um narrador externo.
  - O cartão mostra o narrador, os personagens e quantos fios surgiram ou foram resolvidos ali, e leva direto ao capítulo no editor.
  - Abaixo do quadro, a seção **Cenas** guarda ideias de cena com uma breve descrição, antes de elas terem um capítulo. Dá para arrastar uma cena de lá para um capítulo e de volta. Quando um capítulo é apagado, as cenas dele também vão para lá.
- **Fios narrativos**: mistérios, promessas, conflitos, acontecimentos e objetos importantes que a história abriu.
  - Cada fio fica ligado à cena e ao capítulo onde surgiu. Se a cena muda de capítulo, o fio vai junto.
  - Um fio pode ser marcado como resolvido, com a cena e o modo, ou como abandonado de propósito, com o motivo. Também pode ser reaberto.
  - A tela "Fios narrativos" filtra por situação, tipo e capítulo, e avisa quando um fio está aberto há muitos capítulos ou foi resolvido antes de surgir.
  - Ao lado da folha, a aba "Fios" mostra o que está em aberto e permite resolver, abandonar ou registrar um fio sem sair do capítulo.
  - Na biblioteca, o cartão "Continuar escrevendo" mostra quantos fios estão em aberto.

O planejamento e os fios não entram na exportação, que leva só o texto do livro.

## Como rodar

Precisa de Node 20 ou mais recente.

```bash
npm install
npm run dev
```

Para gerar a versão de produção, rode `npm run build`. O resultado vai para `dist/` e funciona em qualquer servidor estático, porque as rotas usam `#`.

## Tecnologias

React, TypeScript e Vite. Os dados ficam no IndexedDB do navegador, acessado pelo Dexie. O editor é feito com TipTap (ProseMirror), e o arrastar do planejamento usa o dnd-kit. A exportação usa `docx` e `pdfmake`. As fontes são Newsreader, Literata e Instrument Sans, servidas localmente pelo Fontsource.

## Limitações conhecidas

- Os dados ficam só no navegador onde foram criados. Ainda não há sincronização nem backup.
- A paginação nunca divide um parágrafo entre duas páginas: se ele não cabe, vai inteiro para a página seguinte.
- O tamanho da página acompanha a largura da tela, então o celular mostra mais páginas que o computador para o mesmo texto.
- O PDF usa a fonte Roboto, e não as fontes do editor.
