# Gerador de Briefing

Transforma o pedido de alteração em um `.xlsx` no template que a produção já lê.

- **Fase 1** — formulário + checagem de lacunas + geração da planilha. Sem IA.
- **Fase 2** — a IA lê o pedido do cliente e sugere as alterações.
- **Fase 3** — revisor semântico + perguntas prontas para mandar ao cliente.
- **Fase 4** — acrescentar a uma planilha que já está em execução.
- **Fase 5** — extração a partir de transcrição de reunião.
- **Fase 6** — importar a conversa (PDF/TXT/VTT do Teams) e ler **por regras, sem IA**.

As fases 2 e 3 são **opcionais por desenho**: sem `ANTHROPIC_API_KEY` o app roda
inteiro no modo Fase 1 — as rotas de IA respondem 503, os botões somem da tela e
nada mais muda. O botão de perguntas continua funcionando, porque a montagem da
lista é determinística. Isso existe para o projeto não depender de aprovação
para ter valor.

## Rodar

```bash
npm install
npm run dev
```

- front: http://localhost:5173
- api: http://localhost:3001 (o Vite já faz proxy de `/api`)

```bash
npm test     # 72 testes: lint, .xlsx, acréscimo, camada de IA e perguntas
npm run build
npm start    # produção: um único processo na porta 3001, API + tela
```

Para ligar as fases 2 e 3:

```bash
cp .env.example .env    # e preencha GEMINI_API_KEY ou ANTHROPIC_API_KEY
```

Dois provedores, escolhidos pela chave que estiver preenchida:

- **Gemini** (`GEMINI_API_KEY`, modelo `GEMINI_MODEL`, padrão `gemini-flash-latest`) — tem
  faixa gratuita; a chave sai em https://aistudio.google.com/apikey.
- **Anthropic** (`ANTHROPIC_API_KEY`) — pago por uso.

Com as duas, a Anthropic ganha; `IA_PROVEDOR=gemini` força o Gemini. O resto do app
só conhece `gerarEstruturado()`, em `server/src/anthropic.ts`.

## O que ele faz

1. O analista preenche um card por alteração: o que fazer, URL da página, seção,
   Link Conteúdo, observações, e anexa os prints.
2. A cada mudança, o backend roda a **checagem de lacunas** e devolve pendências
   (bloqueiam) e avisos (não bloqueiam).
3. O botão **Gerar planilha** devolve o `.xlsx` pronto para subir no Drive/
   SharePoint e linkar no Salesforce.

O rascunho fica em `localStorage`. Não há banco, não há login — o app não guarda
estado entre sessões nem entre usuários.

## O template

`templates/briefing-modelo.xlsx` tem as 5 abas do modelo da casa: `Site`,
`Alteração`, `Complemento de Mockup` (oculta), `Prints` e `FAQ`.

> **Substitua por um modelo oficial assim que a equipe passar um.** O que está
> aqui foi derivado de uma planilha real já entregue, com todo o conteúdo de
> cliente removido e conferido (varredura por nome de cliente, URLs de projeto e
> links de SharePoint/Drive — só sobraram os links de documentação do próprio
> FAQ). Ainda assim, um `.xltx` oficial é mais confiável que um derivado.

### Como o app escreve nele

| Coluna | Campo | Quem preenche |
|---|---|---|
| A | Alteração / Solicitação | o app |
| B | URL Página | o app |
| C | Seção | o app |
| D | Link Conteúdo (um link por linha) | o app |
| E | Obs. Implementação + os prints ancorados | o app |
| F | Obs. Produção | o app |
| G | Val. Produção | **ninguém — fica `Aguardando`** |
| H | Val. Implementação | **ninguém** |
| I | Val. Design | **ninguém** |

Dados começam na **linha 3**. O limite é **96 alterações** (linhas 3–98), porque
é o alcance da fórmula de progresso em `A1`.

As colunas G, H e I pertencem a quem executa a tarefa, depois. O app nunca toca
nelas — por isso a planilha gerada já entra no fluxo normal de validação.

## Decisões técnicas que valem saber

**Carrega o template e preenche; nunca gera do zero.** É o que preserva as abas,
as células mescladas, as validações de lista, os prints fixos da aba `Prints` e
— o mais frágil — a fórmula de matriz em `A1`:

```
="Progresso: " & TEXT(IFERROR(SUM(IF(A3:A98<>"", IF(G3:G98<>"Aguardando",1,0))) / COUNTA(A3:A98), 0), "0.00%")
```

Há teste cobrindo cada um desses itens.

**Use ExcelJS de ponta a ponta. Não misture com openpyxl.** Um `.xlsx` salvo
pelo openpyxl quebra na leitura do ExcelJS:

```
TypeError: Cannot read properties of undefined (reading 'anchors')
```

O template deste repositório foi gerado com ExcelJS justamente por isso.

**Os prints vão ancorados na coluna E da linha da própria alteração** — igual ao
que a equipe faz hoje colando direto no Excel. É o que torna possível escrever
"remover o trecho que deixei circulado no print" e a produção entender.

**Agrupamento vira marcador de texto na coluna A.** Alterações seguidas com o
mesmo `grupo` recebem `**** / início de <grupo>` na primeira e
`fim de <grupo> / ***` na última, que é a convenção já usada nas planilhas.

## A checagem de lacunas

As regras saem da aba **FAQ do próprio template** — não são opinião, são o
procedimento da casa. Isso importa numa discussão: a resposta é "é o FAQ de
vocês", não "eu acho".

| FAQ | Regra | Severidade |
|---|---|---|
| A7 | Sem descrição ("o que fazer") | pendência |
| A7 | Sem URL da página ("onde") | pendência |
| A7 | Sem seção | aviso |
| A7 | Pede troca de texto sem trazer o texto novo | aviso |
| A7 | Referência vaga ("essa máquina") sem print nem link | aviso |
| A7 | Cita print mas não anexou nenhum | aviso |
| A13 | Cor sem código hexadecimal | aviso |
| A14 | Troca de fonte sem nome de fonte do Google Fonts | aviso |
| A15 | Ícone sem referência do Font Awesome | aviso |
| A16 | Pede imagem sem Link Conteúdo nem print | aviso |

**Quase tudo é aviso, de propósito.** Regra ingênua gera falso positivo — isso
foi medido nas três planilhas reais e está travado em teste:

- `deixar o logo na header com largura de 122px` **não** acusa "imagem sem link"
  (é mudança de tamanho, não precisa de imagem);
- `...com atenção à fonte que deve ficar escura` **não** acusa "fonte sem nome"
  (a frase fala de cor).

E o caso que justifica o revisor semântico da Fase 3:

```
A: remover essa máquina
B: .../maquinas/prima
C: prima
```

Nenhuma coluna vazia, passa por toda regra estrutural, e é inexecutável sem
perguntar *qual* máquina. A regra `REFERENCIA_VAGA` é uma heurística que pega
esse caso, mas o problema é de referência e não de estrutura — lint nenhum
resolve isso de forma confiável.

## A camada de IA (Fase 2)

Ela faz **uma coisa**: pegar o texto corrido do cliente e devolver a lista de
alterações separadas. Não calcula status, não valida lacuna (isso é o lint,
determinístico), não escolhe imagem, não decide nada.

### Três modos, não um `true/false` (Fase 7)

A primeira versão tinha só ligado/desligado — mas isso não sustenta uma
plataforma **sem cadastro e login**: se o `.env` tem uma chave, ela é usada por
**qualquer visitante anônimo** que abrir o link, na sua conta. Por isso são três
modos, decididos só pelo que está no `.env`:

| O que está no `.env` | Modo | O que o visitante vê |
|---|---|---|
| `IA_ATIVA=false` | `desligada` | A aba de IA some inteira. Nem o formulário de chave aparece. |
| `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY` preenchida | `servidor` | A IA funciona sozinha, sem pedir nada — você banca o uso. |
| nada preenchido | `proprio` | A aba de IA aparece, mas com um formulário "Configurar IA": cada visitante cola a **própria** chave antes de usar. |

No modo `proprio`, a chave:

- fica só no `localStorage` do navegador de quem colou (chave própria,
  `briefing-ia-chave-v1` — **fora** do rascunho, então "Limpar" não a apaga);
- nunca é logada nem persistida no servidor — vive só pelos milissegundos da
  chamada, como um header (`X-IA-Chave` / `X-IA-Provedor`) em `/api/sugerir` e
  `/api/revisar-ia`;
- é **ignorada** se o `.env` já tiver uma chave — em modo `servidor` o header do
  cliente não tem efeito nenhum, de propósito: ninguém redireciona a conta de
  outra pessoa só mandando um header diferente.

Uma chave recusada pelo provedor (errada, revogada, sem permissão) vira **401**
com uma mensagem que aponta de volta para "Configurar IA" — nunca o 502 genérico
de "a chamada falhou", que faria o visitante achar que é bug do app.

`/api/health` informa o modo atual (`ia.modo`) e, em modo `proprio`, uma dica de
qual provedor pré-selecionar (`ia.provedorPadrao` — Gemini por padrão, tem faixa
gratuita e não pede cartão; força outro via `IA_PROVEDOR`).

Isso não é invenção nossa — é o procedimento da casa. O FAQ do template,
pergunta 9: *"todo documento enviado pelo cliente deve ser transcrito pelo
analista de implementação e separado em tópicos"*, porque documentos de cliente
costumam conter pedidos que não podem ser executados.

### A trava de confirmação

Card vindo da IA nasce com `confirmado: false` e **bloqueia a geração**. Não é só
visual: `/api/gerar` devolve 422 enquanto houver card não confirmado.

Isso existe porque "a IA só sugere, você confirma" sem mecanismo vira um clique
único sobre um formulário pré-preenchido — e a ancoragem faz o analista aceitar
o rascunho, que é exatamente o risco que a decisão queria evitar.

### Contra invenção

| Campo | Para quê |
|---|---|
| `duvidas` | o que a IA não entendeu, escrito como a pergunta a fazer ao cliente. Vira aviso no card. |
| `trechos_ignorados` | pedaços do pedido que não viraram alteração nenhuma. Se o cliente pediu 8 coisas e saíram 5, as 3 aparecem no painel em vez de sumirem caladas. |

A saída é **structured output** com schema Zod (`output_config.format`), não
"peça JSON no prompt" — a validação acontece na camada da API e o modelo refaz
sozinho se não casar. Não há parser de JSON escrito à mão.

O prompt de sistema fica em `server/src/prompts/extrator.md`, versionado e fora
do código. O build copia para `dist/prompts/` (`scripts/copiar-prompts.mjs`) —
sem esse passo a Fase 2 quebra em produção com `ENOENT`.

### Custo

Padrões: `claude-opus-5`, `effort: medium`, prompt de sistema com
`cache_control`. O `console.log` de cada chamada mostra entrada, saída e
`cache_lido`, e a tela mostra o mesmo — é assim que se mede antes de mexer.

Em ordem de impacto real:

1. **Uma chamada por colagem, nunca a cada tecla.** O botão é manual e explícito.
   É de longe o maior desperdício possível, e é decisão de desenho.
2. **`effort: medium`** — extração estruturada não precisa de `high`.
3. **Cache do prompt de sistema** — com a ressalva de que o TTL padrão é de 5
   minutos; com briefings espaçados o cache quase não pega e a economia é de
   centavos. Não arquitete em torno disso.

Configurável por `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `MAX_CARACTERES_PEDIDO`.

## O revisor semântico (Fase 3)

O lint determinístico pega lacuna **estrutural**: campo vazio, link faltando,
cor sem hex. O que ele não pega é esta linha, real, do Brasil Vending:

```
A: remover essa máquina
B: .../maquinas/prima
C: prima
```

Nenhuma coluna vazia. Passa por toda regra. E é impossível executar sem
perguntar qual máquina — o problema é de **referência**, não de estrutura.

O revisor responde uma pergunta por alteração: *um dev que nunca falou com este
cliente conseguiria executar isto sozinho?* Devolve `executavel`, um `motivo`
para o analista e a `pergunta` para o cliente.

Três decisões que valem saber:

**Ele não roda no debounce.** `/api/revisar` roda a cada 400 ms enquanto o
analista digita; chamar a IA ali seria o maior desperdício de token do projeto.
A revisão é botão explícito, e o front só manda as alterações cujo conteúdo
mudou desde a última vez (cache por hash, em `hashRevisao`).

**Vai em lotes de 12, não uma chamada por alteração.** Uma chamada por alteração
reenviaria o prompt de sistema N vezes — com 26 alterações é cerca de 4× mais
token de entrada. O servidor confere se todos os vereditos voltaram e refaz só o
que faltou.

**Ele é instruído a ser conservador.** Na dúvida, marca como executável. Alarme
falso faz o analista perder tempo e o cliente receber pergunta boba — custa mais
caro que deixar passar uma linha que a produção resolveria com um olhar.

O revisor também não vê o texto cru do cliente: recebe só a alteração já
estruturada, que é o que o desenvolvedor veria. Dos links, só a contagem.

## As perguntas para o cliente

Botão que junta três fontes numa mensagem pronta para colar:

| origem | de onde vem |
|---|---|
| `revisor` | veredito reprovado da Fase 3 — o mais específico |
| `duvida` | o que o extrator da Fase 2 não entendeu |
| `regra` | regras do FAQ que o cliente pode responder |

É **determinístico** — não chama IA — então funciona mesmo com as fases 2 e 3
desligadas.

Duas regras de montagem que importam:

- **Lacuna interna não vira pergunta.** Falta de URL ou de seção é problema do
  analista, não do cliente. Só as regras com template próprio saem da empresa — a
  mensagem do lint é escrita para o analista e não serve para mandar pra fora.
- **O revisor substitui a pergunta genérica.** Quando ele reprova uma alteração
  que também disparou `REFERENCIA_VAGA`, só a pergunta dele entra. Senão o
  cliente receberia a mesma dúvida duas vezes com palavras diferentes.

Isto é o que ataca o gargalo que o briefing original descreve — *"o cliente manda
pedidos que às vezes nem a equipe entende"*. Acelerar a digitação não resolve
isso; encurtar a ida e volta resolve.

## A segunda rodada (Fase 4)

O briefing original tratava a planilha como documento entregue e esquecido. Ela
não é: continua sendo escrita por produção, implementação e design nas colunas
G/H/I, e alimenta o `Progresso: X%` em `A1`. O link dela já está registrado no
Salesforce.

Então, para acrescentar alterações, **gerar arquivo novo é a opção errada** — ela
quebra o link e descarta o estado de execução de outras pessoas. O app recebe a
planilha atual, escreve no fim e devolve **o mesmo arquivo, com o mesmo nome**.

São duas etapas de propósito:

**1. `POST /api/inspecionar`** — lê a planilha e responde o que o analista
precisa ver *antes* de confirmar: quantas alterações já existem, quantas a
produção já começou, em que linha as novas vão cair, quanto ainda cabe, e quais
das alterações atuais parecem já estar lá.

**2. `POST /api/acrescentar`** — escreve e devolve o arquivo.

### As travas

**Nunca sobrescreve.** Antes de escrever cada linha, confere se a coluna A está
vazia; se não estiver, lança erro e nada é gravado. É cinto e suspensório — o
cálculo da linha inicial já deveria impedir isso.

**Não preenche buraco no meio.** A linha inicial é *depois da última ocupada*,
não "a primeira vazia". Se alguém apagou o texto da linha 4 mas a 5 continua
preenchida, escrever na 4 inseriria uma alteração no meio de uma sequência que a
produção está executando de cima para baixo. Tem teste travando isso.

**Nunca toca em G, H e I.** As linhas novas nascem com o `Aguardando` padrão do
template; as antigas mantêm o que a produção marcou.

**Avisa sobre duplicata, sem bloquear.** O caso real é o analista reabrir o
rascunho (que fica em `localStorage`) e mandar de novo o mesmo lote da manhã. A
comparação ignora acento, caixa e os marcadores `**** início de ...` que o
próprio gerador acrescenta — senão a duplicata passaria escondida.

A coluna A é o marcador canônico de linha ocupada, porque é o que a própria
fórmula de progresso usa (`COUNTA(A3:A98)`). G/H/I vêm preenchidas de fábrica no
template e por isso não servem para dizer se a linha tem conteúdo.

## Reunião não é mensagem (Fase 5)

Boa parte dos briefings não nasce de texto que o cliente escreveu: nasce de
reunião, e o que chega é a **transcrição automática do Teams** — que erra.

São dois prompts, não um com remendo, porque a regra central de um é proibida no
outro.

### A regra que se inverte

No extrator de **mensagem**, o que o cliente digitou entre aspas vai direto para
o site:

> Quando o cliente escrever o texto final entre aspas, copie esse texto
> LITERALMENTE.

Em **reunião isso seria um defeito**, não um recurso. A transcrição é um chute da
máquina sobre o que foi dito, e ela erra exatamente onde não pode: nome de
empresa, nome de produto, endereço, telefone, URL, código de cor. Copiar literal
de transcrição ruim publica texto errado no site do cliente.

Então o prompt de reunião abre com a regra oposta — **nada dali é texto final**:

```
solicitacao: trocar o título principal da home; o cliente ditou o novo texto na reunião
duvidas: ["Pode nos enviar por escrito o texto exato do novo título da home?
          Na reunião entendemos algo como '…', mas precisamos da grafia exata."]
```

Há teste garantindo que a regra do `LITERALMENTE` existe num prompt e **não**
existe no outro.

### Decisão que o cliente desfez no meio da conversa

Numa reunião o assunto volta. Decide-se uma coisa aos 10 minutos e desfaz-se aos
40. Um extrator que lê em linha reta gera alteração de algo que foi cancelado — e
a produção executa.

O prompt manda varrer a transcrição inteira antes de fechar qualquer alteração, e
a saída ganhou um campo que mensagem não tem:

```
decisoes_revertidas: [
  "Primeiro foi decidido remover a seção de depoimentos; mais adiante voltaram
   atrás e decidiram só trocar as fotos dela."
]
```

Isso aparece num painel próprio acima dos cards. Serve para o analista conferir
que a IA acompanhou a conversa — e perceber quando ela errou o rumo.

### O resto

- **Conversa social não vira nada**, nem `trechos_ignorados` (encheria a lista e
  o analista pararia de ler). Só vai para lá o que *pode* ser pedido e não ficou
  claro.
- **Trecho corrompido pela transcrição** vira dúvida apontando o trecho, em vez
  de palpite.
- **Quem falou importa**: pedido do cliente vale; sugestão da nossa equipe só
  vira alteração se o cliente concordou. Se a transcrição não identificar quem
  fala, o prompt proíbe inventar.
- **Limite de entrada maior**: fala rende ~50 mil caracteres por hora, então 60
  mil cortaria uma reunião de 90 minutos no meio. Reunião vai a 150 mil
  (`MAX_CARACTERES_REUNIAO`).

Uma reunião produz **intenções**, não especificações. É esperado que a maioria
das alterações saia daqui com pelo menos uma dúvida — e é por isso que as
perguntas da Fase 3 valem ainda mais neste caminho.

## Importar uma conversa, sem IA (Fase 6)

Na aba **Pedido**, o analista envia a transcrição de uma reunião (PDF exportado
do Teams, TXT ou VTT). O programa lê **por regras** e devolve:

- **Tarefas** — frases em que alguém pede uma ação sobre um elemento do site;
- **O que ficou de fora**, com o motivo (já resolvido, pergunta, parece pedido
  mas não diz sobre o quê, sugestão da equipe sem acordo, bastidores);
- **Alertas** — por exemplo, um documento que o cliente disse que mandaria por
  fora e que não está no texto.

Funciona com ou sem chave de IA, não chama nenhum serviço externo e o PDF é
lido localmente (`pdfjs-dist`).

### Como ele decide o que é pedido

| Regra | Efeito |
|---|---|
| verbo de ação (trocar, remover, atualizar, publicar...) + elemento do site (telefone, vídeos, menu, logo...) dito pelo **cliente** | tarefa, confiança **alta** |
| o cliente aponta um defeito sem dizer o que fazer ("o texto está errado") | tarefa, confiança **média** |
| pedido em forma de pergunta ("você consegue retirar os vídeos?") | tarefa, confiança **média** |
| sugestão da **equipe** | só vira tarefa se o cliente concordou nas falas seguintes |
| "deixa eu anotar aqui X e Y", dito pela equipe | uma tarefa para cada item anotado |
| "já foi alterado", "isso já foi feito" (e não "ainda não foi feito") | vai para "já resolvido" |
| ruído do Teams ("Oh, I cable", "Mm.") | ignorado, só entra na contagem |
| várias menções ao mesmo elemento | uma tarefa só, com todos os trechos como evidência |

O cliente é **adivinhado** pelo jeito de falar (quem usa menos "produção",
"link temporário", "área técnica"). Se errar, o analista marca quem é o cliente
e clica em *Reprocessar*.

### Validar a leitura

Os cards criados nascem **não confirmados** (travam a geração, como os da IA) e
com a origem "lido da conversa". Na aba **Alterações**, cada card mostra *de onde
veio*: quem falou, em que minuto e a frase, e o pedido ao lado destaca esse
trecho e rola até ele. O analista confere, corrige e confirma. Do que ficou de
fora, qualquer trecho pode virar tarefa com um clique.

### O que ele NÃO faz

É reconhecimento de padrão, não compreensão. Portanto:

- **Referências** ("essa máquina", "isso") dependem do que foi dito antes: vão
  para "parece pedido, mas não diz sobre o quê".
- **Elementos fora do vocabulário** (`OBJETOS`, em `conversa.ts`) só aparecem
  nessa mesma lista.
- **Decisão revertida** ("vamos remover X... não, deixa") não é detectada.
- **O texto da tarefa é a frase do cliente**, sem reescrever. Vindo de
  transcrição, costuma ser comprido e truncado: o analista edita.
- Uma frase com dois elementos gera duas tarefas com o mesmo texto; cada uma
  avisa a outra para o analista apagar a repetida.

As regras foram ajustadas olhando **uma** transcrição real. O resultado nela é
bom, mas só outras reuniões dizem a taxa de acerto de verdade. Os testes
(`conversa.test.ts`) usam uma conversa inventada.

## A tela

Quatro abas numeradas, na ordem em que o trabalho acontece, mais uma quinta que
só existe quando a IA está ligada:

1. **Pedido** — cliente, URL base, importação da conversa (PDF/TXT/VTT) e o
   texto colado do cliente.
2. **Alterações** — três colunas: lista compacta, editor da alteração
   selecionada e o pedido original ao lado, para responder sem trocar de janela.
3. **Conferência** — o que falta resolver, agrupado por alteração, e as
   perguntas para o cliente (montadas sem IA).
4. **Planilha** — checklist do que bloqueia, nova ou acrescentar numa existente.
5. **IA** — *só aparece com chave configurada* (`/api/health` → `ia.ativa`):
   ler o pedido, resultado da extração e revisão. Sem chave, a aba e os botões
   nem existem na tela, e o resto funciona igual, preenchido à mão.

Decisões de interface que resolvem problemas concretos:

- **Uma alteração por vez, com todos os campos à vista.** Antes eram cards
  empilhados com campos escondidos; com 26 alterações a rolagem era o problema.
  A lista da esquerda mostra um ponto de cor por alteração (pronta, aviso,
  pendência, rascunho da IA, trava), então o estado do todo cabe numa olhada.
- **O pedido original fica visível ao lado do editor** (recolhe numa aba
  vertical), porque responder uma dúvida exige reler o que o cliente escreveu.
- **Dúvida da IA tem botão "Resolvida"**, que a tira da lista. "Confirmar e ir
  para a próxima" encurta a conferência dos rascunhos.
- **Rascunho da IA não conta como pendência.** Ele trava a geração, mas já tem o
  contador próprio ("a confirmar"); contar nos dois lugares dobrava o número.
- **"Gerar planilha" no topo sempre responde.** Se faltar algo, leva para a aba
  Planilha, que mostra o que falta em vez de um botão cinza mudo.
- **Contadores clicáveis no topo.** "3 pendências" leva direto para a primeira.
- **Reordenar e remover levam os prints junto.** Os prints são indexados pela
  ordem da alteração; antes de mexer na ordem eles ficavam para trás.

## Estrutura

```
templates/briefing-modelo.xlsx   o modelo (substituir pelo oficial)
server/src/schema.ts             tipos Zod; o mapa campo -> coluna
server/src/lint.ts               as regras do FAQ
server/src/xlsx.ts               escrita no .xlsx: gerar e acrescentar
server/src/anthropic.ts          cliente e config compartilhados da IA
server/src/ia.ts                 extrator: texto do cliente -> cards
server/src/revisor.ts            revisor semântico, em lotes
server/src/perguntas.ts          monta a lista de perguntas (sem IA)
server/src/conversa.ts           lê a conversa por regras (sem IA): tarefas, descartados, alertas
server/src/arquivo.ts            texto de PDF/TXT/VTT enviado pelo analista
server/src/prompts/*.md          os prompts de sistema, versionados
client/src/App.tsx               estado, chamadas à API e as abas
client/src/Aba*.tsx              uma por aba (Pedido, Alterações, Conferência, Planilha, IA)
client/src/Editor.tsx            o editor de uma alteração
server/src/env.ts                carrega o .env antes de qualquer leitura
server/src/index.ts              9 rotas, nenhuma com estado
client/src/PainelConversa.tsx    painel de importação e conferência da conversa
```

### API

| Rota | Entrada | Saída |
|---|---|---|
| `GET /api/health` | — | `{ ok, template, ia: { ativa, modelo } }` |
| `POST /api/importar` | multipart: `arquivo` (PDF/TXT/VTT) + `clientes` opcional (JSON com os nomes a tratar como cliente) | `{ arquivo, texto, formato, falantes[], tarefas[], descartados[], alertas[], resumo }` — sem IA; 400 sem arquivo, 422 se não achar texto ou o PDF estiver corrompido |
| `POST /api/sugerir` | `{ texto, origem: "mensagem" \| "reuniao" }` | `{ alteracoes[], trechos_ignorados[], decisoes_revertidas[], origem, uso }` — 503 se a IA estiver desligada |
| `POST /api/revisar-ia` | `{ briefing }` | `{ vereditos[], uso, faltantes[] }` — 503 se a IA estiver desligada |
| `POST /api/perguntas` | `{ briefing, vereditos?, prints? }` | `{ itens[], texto }` — determinístico, sem IA |
| `POST /api/revisar` | `{ briefing, prints: { [ordem]: qtd } }` | `{ achados[], bloqueado }` |
| `POST /api/gerar` | multipart: `briefing` (JSON) + arquivos `print_<ordem>` | o `.xlsx` |
| `POST /api/inspecionar` | multipart: `planilha` + `briefing` opcional | `{ jaExistiam, primeiraLinhaLivre, capacidadeRestante, emExecucao, existentes[], duplicadas[] }` |
| `POST /api/acrescentar` | multipart: `planilha` + `briefing` + `print_<ordem>` | o mesmo `.xlsx`, com as linhas novas no fim |

`TEMPLATE_PATH`, `PORT`, `MAX_CARACTERES_PEDIDO` e `MAX_CARACTERES_REUNIAO` são
configuráveis por variável de ambiente.

## Hospedar

Não há banco: o servidor não guarda nada entre requisições, e o rascunho fica no
`localStorage` de cada navegador. Hospedar é subir **um processo Node**:

```bash
npm install
npm run build
npm start          # API + tela, na porta 3001 (PORT para mudar)
```

Depois do `build`, o próprio servidor entrega `client/dist`. Precisa de Node 22+
(usa `process.loadEnvFile`) e do `templates/briefing-modelo.xlsx`.

Pontos de atenção:

- **Não há login — e por isso a chave de IA tem duas formas de hospedar.**
  Deixe **sem chave no `.env`** (modo `proprio`, Fase 7 acima) para publicar o
  link livremente: cada visitante cola a própria chave, e ninguém gasta a sua.
  Só coloque `ANTHROPIC_API_KEY`/`GEMINI_API_KEY` no `.env` (modo `servidor`)
  atrás de VPN/rede interna ou de um proxy com senha — nesse modo, qualquer um
  que alcance a URL usa a IA de graça, na sua cota.
- **Hospedagem só de PHP (XAMPP, cPanel comum) não serve** — precisa rodar Node.
- **O rascunho é por navegador.** Outro computador começa vazio; é o preço de não
  ter banco, e o que o torna simples de hospedar.

Ver `SYSTEM-DESIGN-briefing.md` para o desenho completo.
