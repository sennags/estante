# Lirismo

Um lugar para escrever e terminar suas histórias: planejamento, personagens e o texto do livro, tudo junto. Funciona no computador e no celular.

## O que dá para fazer

- **Estante de histórias**, separadas por fase: planejamento, escrita e revisão. Cada livro tem capa, sinopse e gênero.
- **Escrever numa folha de papel**, no formato de um livro (14 × 21 cm). O texto passa sozinho para a próxima página, salva enquanto você digita e guarda versões anteriores para você voltar atrás.
- **Personagens e universo**: fichas de personagens, lugares, objetos e regras do mundo, que ficam à mão ao lado da folha.
- **Planejamento em quadro**: cada capítulo é uma coluna e cada cena é um cartão, que você arrasta para mudar a ordem.
- **Fios narrativos**: mistérios, promessas e conflitos que a história abriu. O Lirismo lembra o que ainda está em aberto e avisa quando um fio ficou esquecido.
- **Exportar em PDF** o livro inteiro, com as mesmas páginas que você vê no editor.
- **Lixeira**: uma história apagada espera 7 dias antes de sumir de vez.
- **Conta opcional**: sem conta, tudo fica no seu navegador. Com conta, as histórias ficam guardadas na nuvem e abrem em qualquer aparelho, mesmo que você escreva sem internet.

## Para quem vai mexer no código

Precisa de Node 20 ou mais recente.

```bash
npm install
npm run dev
```

Para as contas, copie `.env.example` para `.env.local` e preencha com os dados do projeto no Supabase. O banco é criado com `supabase/schema.sql`. Sem essas variáveis, o app funciona só no navegador.

`npm run build` gera o site em `dist/`.

Feito com React, TypeScript e Vite; os dados ficam no navegador (Dexie) e, com conta, no Supabase.

## Limitações conhecidas

- Um parágrafo nunca é dividido entre duas páginas: se não cabe, vai inteiro para a seguinte.
- No celular, a letra fica maior e as quebras de página são aproximadas.
