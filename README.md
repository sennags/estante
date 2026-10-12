# Trama

Aplicação web para escritores organizarem e terminarem suas histórias, reunindo planejamento, referências e escrita no mesmo lugar. O nome joga com os dois sentidos da palavra: o enredo de uma história e o entrelaçado de fios de um tecido, como os fios narrativos que o app ajuda a acompanhar. Funciona no computador e no celular, e todos os dados ficam salvos no próprio navegador.

## O que já funciona (fase 1)

- **Biblioteca**: as histórias ficam numa estante, separadas pela fase (planejamento, escrita e revisão). Cada uma tem título, sinopse, gênero e capa, com uma cor ou uma imagem sua. No topo há um atalho para o último capítulo editado.
- **Editor em folha de papel**:
  - O texto passa sozinho para a página seguinte quando a atual enche. A numeração de páginas segue pelo livro inteiro, e cada capítulo começa numa página nova.
  - O botão **+ Nova página em branco** cria uma página vazia no fim do capítulo.
  - Salva sozinho e mostra a contagem de palavras.
  - Tem negrito, itálico e separador de cena (⁂).
  - O **modo foco** esconde tudo menos a folha. Para sair, aperte Esc.
  - A barra de ferramentas pode ser recolhida.
  - **Versões**: uma cópia do capítulo é guardada sozinha a cada 10 minutos de escrita, e você também pode guardar uma na hora. Qualquer versão pode ser restaurada.
  - **Exportação** da história inteira em `.docx` e PDF.
- **Personagens e universo**: fichas de personagens, lugares, objetos e regras do mundo. Personagens têm campos para motivações e relações. As fichas podem ser consultadas num painel ao lado da folha enquanto você escreve.

## Próxima fase

- Planejamento da narrativa: capítulos e cenas em cartões arrastáveis, com objetivo, conflito e resultado de cada cena.
- Painel de fios narrativos: mistérios, promessas e conflitos em aberto, ligados à cena onde surgiram e marcados como resolvidos ou abandonados de propósito.

## Como rodar

Precisa de Node 20 ou mais recente.

```bash
npm install
npm run dev
```

Para gerar a versão de produção, rode `npm run build`. O resultado vai para `dist/` e funciona em qualquer servidor estático, porque as rotas usam `#`.

## Tecnologias

React, TypeScript e Vite. Os dados ficam no IndexedDB do navegador, acessado pelo Dexie. O editor é feito com TipTap (ProseMirror). A exportação usa `docx` e `pdfmake`. As fontes são Newsreader, Literata e Instrument Sans, servidas localmente pelo Fontsource.

## Limitações conhecidas

- Os dados ficam só no navegador onde foram criados. Ainda não há sincronização nem backup.
- A paginação nunca divide um parágrafo entre duas páginas: se ele não cabe, vai inteiro para a página seguinte.
- O tamanho da página acompanha a largura da tela, então o celular mostra mais páginas que o computador para o mesmo texto.
- O PDF usa a fonte Roboto, e não as fontes do editor.
