/**
 * Leitura de uma conversa (transcrição do Teams) SEM IA.
 *
 * Faz três coisas, todas por regra, todas auditáveis:
 *   1. separa o texto em falas (quem falou, quando, o quê);
 *   2. decide, frase a frase, o que parece PEDIDO e o que não é;
 *   3. guarda de onde cada tarefa saiu (fala, horário, posição no texto), para o
 *      analista conferir no original.
 *
 * Não entende significado. Reconhece padrões: um verbo de ação ("trocar",
 * "remover"...) perto de um elemento de site ("telefone", "vídeos"...), dito pelo
 * cliente. Por isso o resultado é um RASCUNHO, e o que ficou de fora é devolvido
 * com o motivo, para o analista poder trazer de volta.
 */

export type Papel = "cliente" | "equipe";
export type Confianca = "alta" | "media";

export type Turno = { ordem: number; quem: string; tempo: string; texto: string; inicio: number };

export type Fonte = {
  quem: string;
  tempo: string;
  trecho: string;
  /** posição do trecho dentro de `texto`, para destacar no original */
  inicio: number;
};

export type Tarefa = {
  /** o que o cliente disse, nas palavras dele */
  solicitacao: string;
  /** elemento do site detectado (telefone, vídeos...) */
  assunto: string;
  confianca: Confianca;
  /** por que virou tarefa, em linguagem de gente */
  motivo: string;
  fontes: Fonte[];
  duvidas: string[];
};

export type MotivoDescarte =
  | "ja_resolvido"
  | "pergunta"
  | "sem_objeto"
  | "sugestao_sem_acordo"
  | "processo";

export type Descartado = {
  motivo: MotivoDescarte;
  detalhe: string;
  quem: string;
  tempo: string;
  trecho: string;
  inicio: number;
};

export type Falante = { nome: string; turnos: number; palavras: number; papel: Papel };

export type Resultado = {
  /** texto normalizado (falas inteiras, sem quebras de página): é nele que `inicio` vale */
  texto: string;
  formato: "teams" | "vtt" | "texto";
  falantes: Falante[];
  tarefas: Tarefa[];
  descartados: Descartado[];
  alertas: string[];
  resumo: { turnos: number; frases: number; ruido: number };
};

// ============================================================================ texto

/** minúsculas, sem acento: só para COMPARAR; nunca para exibir */
export function plano(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const NOME = "[\\p{Lu}][\\p{L}.'’-]*";
const PARTICULA = "(?:da|de|do|das|dos|e|van|von|di)";
const RE_FALANTE = new RegExp(
  `^(?<nome>${NOME}(?:\\s+(?:${NOME}|${PARTICULA})){0,5})\\s+(?<tempo>\\d{1,2}:\\d{2}(?::\\d{2})?)$`,
  "u",
);
const RE_META = /^.+\s(?:começou|parou)\sa\stranscri[çc][ãa]o\s*$/iu;
/** alguns gravadores (ex.: Fireflies) carimbam um ID numérico longo no fim de cada linha da fala */
const RE_ID_GRAVADOR = /\s+\d{9,}\s*$/;

function segundos(tempo: string): number {
  return tempo.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Teams exportado como texto/PDF: "Nome 0:04" numa linha, a fala nas seguintes. */
function turnosTeams(bruto: string): Turno[] {
  const linhas = bruto.replace(/\r/g, "").split("\n");
  const turnos: Turno[] = [];
  let atual: { quem: string; tempo: string; partes: string[] } | null = null;

  const fechar = () => {
    if (!atual) return;
    const texto = atual.partes.join(" ").replace(/\s+/g, " ").trim();
    if (texto) turnos.push({ ordem: turnos.length + 1, quem: atual.quem, tempo: atual.tempo, texto, inicio: 0 });
    atual = null;
  };

  for (const crua of linhas) {
    const linha = crua.trim();
    if (!linha) continue;
    if (RE_META.test(linha)) {
      fechar();
      continue;
    }
    const m = RE_FALANTE.exec(linha);
    if (m?.groups) {
      fechar();
      atual = { quem: m.groups.nome.trim(), tempo: m.groups.tempo, partes: [] };
      continue;
    }
    if (atual) {
      const semId = linha.replace(RE_ID_GRAVADOR, "").trim();
      if (semId) atual.partes.push(semId);
    }
    // linhas antes da primeira fala são o cabeçalho (título, data): ignoradas
  }
  fechar();
  return turnos;
}

/** WebVTT: "00:00:04.000 --> ..." e "<v Nome>fala". Falas seguidas do mesmo falante viram uma. */
function turnosVtt(bruto: string): Turno[] {
  const blocos = bruto.replace(/\r/g, "").split(/\n{2,}/);
  const turnos: Turno[] = [];
  for (const bloco of blocos) {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
    const i = linhas.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const ini = /(\d{1,2}:)?(\d{2}):(\d{2})/.exec(linhas[i]);
    const tempo = ini ? `${Number(ini[1]?.replace(":", "") ?? 0) * 60 + Number(ini[2])}:${ini[3]}` : "0:00";
    const corpo = linhas.slice(i + 1).join(" ");
    const v = /<v\s+([^>]+)>/i.exec(corpo);
    const quem = (v?.[1] ?? "Falante").trim();
    const texto = corpo.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!texto) continue;
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.quem === quem) ultimo.texto += " " + texto;
    else turnos.push({ ordem: turnos.length + 1, quem, tempo, texto, inicio: 0 });
  }
  return turnos;
}

/**
 * E-mail e mensagem têm linhas cortadas no meio da frase (junta) e itens de lista
 * sem ponto final (separa). Marcadores como "início de ..." e "fim" ficam sozinhos.
 */
export function normalizarTextoCorrido(bruto: string): string {
  const itemDeLista = /^\s*(?:[-•*–]|\d+[.)])\s+/;
  const marcador = /^\s*(?:in[ií]cio de .+|fim)\s*$/i;
  const fimDeFrase = /[.!?:;"”)]\s*$/;
  const saida: string[] = [];
  let anterior = "";
  for (const crua of bruto.replace(/\r/g, "").split("\n")) {
    const linha = crua.trim();
    if (!linha) {
      anterior = "";
      if (saida.length && saida[saida.length - 1] !== "") saida.push("");
      continue;
    }
    const novaLinha = !saida.length || anterior === "" || itemDeLista.test(linha) || marcador.test(linha) || marcador.test(anterior) || fimDeFrase.test(anterior);
    if (novaLinha) saida.push(linha.replace(itemDeLista, ""));
    else saida[saida.length - 1] += " " + linha;
    anterior = linha;
  }
  return saida.filter((l, i) => l !== "" || (i > 0 && i < saida.length - 1)).join("\n").trim();
}

type Lido = { turnos: Turno[]; texto: string; formato: Resultado["formato"] };

export function lerTurnos(bruto: string): Lido {
  const ehVtt = /^\s*WEBVTT/i.test(bruto) || /\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->/.test(bruto);
  let turnos = ehVtt ? turnosVtt(bruto) : turnosTeams(bruto);
  let formato: Resultado["formato"] = ehVtt ? "vtt" : "teams";

  if (turnos.length === 0) {
    // texto corrido (mensagem de cliente, e-mail): um único falante
    const limpo = normalizarTextoCorrido(bruto);
    return {
      turnos: limpo ? [{ ordem: 1, quem: "Cliente", tempo: "0:00", texto: limpo, inicio: 0 }] : [],
      texto: limpo,
      formato: "texto",
    };
  }

  // texto normalizado: "Nome 0:04\nfala\n\n" — as posições (inicio) valem nele
  let texto = "";
  turnos = turnos.map((t) => {
    const cabeca = `${t.quem} ${t.tempo}\n`;
    const inicio = texto.length + cabeca.length;
    texto += cabeca + t.texto + "\n\n";
    return { ...t, inicio };
  });
  return { turnos, texto, formato };
}

// ================================================================== frases

type Frase = { texto: string; inicio: number };

/** divide em frases mantendo a posição de cada uma dentro da fala (quebra de linha também separa) */
export function dividirFrases(fala: string): Frase[] {
  const frases: Frase[] = [];
  let base = 0;
  for (const linha of fala.split("\n")) {
    for (const f of dividirLinha(linha)) frases.push({ texto: f.texto, inicio: base + f.inicio });
    base += linha.length + 1;
  }
  return frases;
}

function dividirLinha(fala: string): Frase[] {
  const frases: Frase[] = [];
  const fim = /[.!?…]+["”)]*(?=\s|$)/g;
  let ini = 0;
  let m: RegExpExecArray | null;
  const empurra = (de: number, ate: number) => {
    const bruto = fala.slice(de, ate);
    const texto = bruto.trim();
    if (texto) frases.push({ texto, inicio: de + (bruto.length - bruto.trimStart().length) });
  };
  while ((m = fim.exec(fala))) {
    empurra(ini, m.index + m[0].length);
    ini = m.index + m[0].length;
  }
  empurra(ini, fala.length);
  return frases;
}

// ============================================================== vocabulário
// Tudo escrito sem acento: o texto é passado por plano() antes de comparar.

const ACAO = new RegExp(
  "\\b(" +
    [
      "troc(?:ar|a|e|ue|am|ado|ada|ando)",
      "alter(?:ar|a|e|am|ado|ada|acao|acoes)",
      "modific(?:ar|a|e|asse|ado|acao)",
      "remov(?:er|e|a|am|ido|ida)",
      "retir(?:ar|a|e|am|ado)",
      "tir(?:ar|a|e|am)",
      "atualiz(?:ar|a|e|am|ado|acao|acoes)",
      "coloc(?:ar|a|ue|uem|ado)",
      "adicion(?:ar|a|e)",
      "inclu(?:ir|i|a)",
      "mud(?:ar|a|e|am|ado)",
      "public(?:ar|a|e|am|acao)",
      "substitu(?:ir|i|a)",
      "corrig(?:ir|e|a)",
      "ajust(?:ar|a|e)",
      "inser(?:ir|e)",
      "apag(?:ar|a|e)",
      "exclu(?:ir|i|a)",
      "padroniz\\w+",
      "separ(?:ar|a|e)",
      "dividir",
      "renomear",
      "aument(?:ar|a|e)",
      "diminu(?:ir|i|a)",
      "traz(?:er|)",
      "sub(?:ir|a)",
      "deixar",
    ].join("|") +
    ")\\b",
);

const OBRIGACAO = /\b(precisa(?:m)?|tem que|temos que|tenho que|preciso|quero|gostaria|necessario|urgencia|tem de)\b/;
const PEDIDO_EM_PERGUNTA = /\b(consegue|conseguem|pode|podem|poderia|poderiam)\b/;
const PENDENTE = /\b(aguardando|faltando|falta|faltam|pendente|ainda nao (?:foi|foram|esta))\b/;
const FEITO = new RegExp(
  "(\\bja (?:foi|foram|esta|estao|havia sido|haviam sido|constou|colocaram|alteraram|fizeram|fizemos|trocaram)\\b" +
    "|\\bfoi (?:feito|alterado|removido|modificado|colocado|trocado|corrigido|atualizado)\\b" +
    "|\\besta (?:atualizado|correto|certo)\\b|\\bta (?:tudo )?certo\\b|\\bja alterado\\b)",
);
const NEGACAO = /\b(?:nao|nunca|ainda nao)\s+(?:foi|foram|esta|estao|ficou|fizeram|alteraram|colocaram)\b/;
const SOLICITADO = /\b(solicitou|solicitaram|pediu|pediram|tinha solicitado|tinha pedido|ja solicitamos|ja solicitei)\b/;
const NOTA_DA_EQUIPE = /\b(anotar aqui|anotando|vou anotar|anotar tambem)\b/;
const SUPORTE = /\b(suporte)\b/;
/** o cliente aponta o defeito sem dizer o que fazer: "o texto da home está errado" */
const PROBLEMA = /\b(errad[oa]s?|incorret[oa]s?|quebrad[oa]s?|desatualizad[oa]s?|antig[oa]s?|velh[oa]s?|sumiu|nao (?:aparece|funciona|abre|carrega)|esta ruim|horrivel)\b/;
const PROCESSO = new RegExp(
  "\\b(compartilh\\w+|transmiss\\w+|transmitir|tela|baixando|arquivo|documento|pasta|internet|achando|gravacao|reuniao|" +
    "ambiente temporario|link temporario|cache|ctrl|navegador|guia anonima|producao|prioridade|terca|devolutiva|" +
    "area tecnica|desenvolvedores|gestor|me chamou|te chamar|mensagem)\\b",
);
const ACORDO_FORTE = /(\bpode (?:fazer|colocar|ser|sim)\b|\bentao (?:deixa|pode)\b|\bconcordo\b|\beu tambem acho\b|\bperfeito\b|\bcombinado\b)/;
const ACORDO_FRACO = /^(?:sim|isso|isso mesmo|e|ah|ta|ta bom|certo|ok|okay|aham|claro|beleza)\b/;
const VALIDAR_COM_TIME = /\b(confer\w+|vemos|ver|verific\w+) (?:aqui )?com (?:eles|o time|a equipe|nosso time|a area tecnica|minha area tecnica)\b|\barea tecnica\b|\bdesenvolvedores\b/;
const DOCUMENTO = /\b(documento|arquivo|planilha|print|anexo|apresentacao|pdf)\b/;
const VOU_ENVIAR = /\b(vou (?:estar )?(?:te |lhe |ja )?(?:mandar|encaminhar|passar|enviar)|eu fiz um|mandando|encaminhando|vou estar encaminhando)\b/;
const INGLES = /\b(the|you|and|going|yeah|yes|well|sure|thing|double|game|show|said|stop|town|mean|see|done|don't|i'm|oh|what|say|it|cable|they|me|doing|a)\b/;
const PORTUGUES = /\b(de|que|o|os|as|e|nao|para|com|um|uma|se|em|do|da|no|na|ja|ta|ai|entao|isso|voce|voces|aqui|esse|essa|mais)\b/;
const RODAPE_SOCIAL = /^(?:mm+|mhm|hmm|uh-huh|aham|ahn|sim|isso|e|ta|ok|okay|certo|perfeito|claro|tranquilo|beleza|yeah|oh|obrigad[oa]s?|tchau)[,. !]*$/;

type Objeto = { chave: string; rotulo: string; re: RegExp; exige?: RegExp };
/** do mais específico ao mais geral: numa frase viram tarefa os dois primeiros; o resto vira pergunta */
const OBJETOS: Objeto[] = [
  { chave: "whatsapp", rotulo: "ícone/botão do WhatsApp", re: /\b(?:icone|botao|link|numero)\s+(?:do\s+)?whatsapp\b/ },
  { chave: "telefone", rotulo: "telefone", re: /\btelefones?\b/ },
  { chave: "endereco", rotulo: "endereço", re: /\b(endereco|mapa|localizacao)\b/ },
  { chave: "email", rotulo: "e-mail", re: /\be-?mails?\b/ },
  { chave: "logo", rotulo: "logo", re: /\blogo(?:tipo|marca)?\b/ },
  { chave: "imagens", rotulo: "imagens", re: /\b(imagens?|fotos?|banners?|slides?)\b/ },
  { chave: "videos", rotulo: "vídeos", re: /\b(videos?|galeria)\b/ },
  { chave: "menu", rotulo: "menu / categorias", re: /\b(menu|categorias?|submenu)\b/ },
  { chave: "capa", rotulo: "capa", re: /\bcapas?\b/ },
  { chave: "publicacao", rotulo: "publicação do site", re: /\b(?:novo )?layout\b|\bsite\b/, exige: /\bpublic\w+/ },
  { chave: "texto", rotulo: "texto", re: /\b(textos?|titulos?|subtitulos?|descricao|paragrafos?|frases?|slogan)\b/ },
  { chave: "icone", rotulo: "ícone", re: /\bicones?\b/ },
  { chave: "cor", rotulo: "cor / fonte", re: /\b(cor|cores|fontes?|tipografia)\b/ },
  { chave: "formulario", rotulo: "formulário", re: /\bformularios?\b/ },
  { chave: "rodape", rotulo: "rodapé / cabeçalho", re: /\b(rodape|cabecalho)\b/ },
];

function objetosDe(planoFrase: string): Objeto[] {
  const achados = OBJETOS.filter((o) => o.re.test(planoFrase) && (!o.exige || o.exige.test(planoFrase)));
  // "ícone do WhatsApp" já é o WhatsApp: não contar de novo como "ícone"
  return achados.some((o) => o.chave === "whatsapp") ? achados.filter((o) => o.chave !== "icone") : achados;
}

function tiraEnchimento(frase: string): string {
  let f = frase.trim();
  for (let i = 0; i < 3; i++) f = f.replace(/^(?:t[áa]|é|aí|ai|então|e|bom|olha|oh|ah|oi|né),?\s+/iu, "");
  return f.charAt(0).toUpperCase() + f.slice(1);
}

// ============================================================== papéis

const VOCAB_EQUIPE = /\b(producao|time tecnico|area tecnica|desenvolvedor\w*|suporte|link temporario|gestor\w*|nosso time|compartilh\w+|devolutiva|publicacao|ambiente temporario|a gente (?:vai|ve|avalia|confere))\b/g;
const VOCAB_CLIENTE = /\b(nosso site|o site nosso|nossa empresa|pedido de orcamento|nossos clientes|a gente (?:mudou|perdeu))\b/g;

function adivinharPapeis(turnos: Turno[]): Map<string, Papel> {
  const stats = new Map<string, { turnos: number; palavras: number; equipe: number; cliente: number }>();
  for (const t of turnos) {
    const s = stats.get(t.quem) ?? { turnos: 0, palavras: 0, equipe: 0, cliente: 0 };
    const p = plano(t.texto);
    s.turnos++;
    s.palavras += p.split(/\s+/).length;
    s.equipe += (p.match(VOCAB_EQUIPE) ?? []).length;
    s.cliente += (p.match(VOCAB_CLIENTE) ?? []).length;
    stats.set(t.quem, s);
  }
  // pontuação: quanto mais "linguagem de equipe" por palavra, menos cliente
  const nota = (n: string) => {
    const s = stats.get(n)!;
    return (s.equipe - s.cliente * 2) / Math.max(1, s.palavras);
  };
  const nomes = [...stats.keys()];
  const papeis = new Map<string, Papel>();
  if (nomes.length === 1) return new Map([[nomes[0], "cliente"]]);
  // quem quase não falou (o "Willian." solto do Teams) não entra no palpite; mas o critério é
  // quantidade de PALAVRAS, não de falas: um cliente que fala uma vez, longamente, continua valendo
  const maisPalavras = Math.max(...nomes.map((n) => stats.get(n)!.palavras));
  const minimo = Math.max(10, Math.floor(maisPalavras * 0.1));
  const elegiveis = nomes.filter((n) => stats.get(n)!.palavras >= minimo);
  const base = elegiveis.length ? elegiveis : nomes;
  const cliente = [...base].sort((a, b) => nota(a) - nota(b))[0];
  for (const n of nomes) papeis.set(n, n === cliente ? "cliente" : "equipe");
  return papeis;
}

// ============================================================ extração

type Candidato = {
  chave: string;
  rotulo: string;
  frase: string;
  fonte: Fonte;
  confianca: Confianca;
  motivo: string;
  duvidas: string[];
  ordem: number;
  doCliente: boolean;
  completo: boolean;
};

const MAX_DESCARTADOS = 150;

export function extrair(bruto: string, opcoes: { clientes?: string[] } = {}): Resultado {
  const { turnos, texto, formato } = lerTurnos(bruto);

  const palpite = adivinharPapeis(turnos);
  const papel = (nome: string): Papel =>
    opcoes.clientes && opcoes.clientes.length
      ? opcoes.clientes.includes(nome)
        ? "cliente"
        : "equipe"
      : (palpite.get(nome) ?? "equipe");

  const falantes: Falante[] = [...new Set(turnos.map((t) => t.quem))].map((nome) => ({
    nome,
    turnos: turnos.filter((t) => t.quem === nome).length,
    palavras: turnos.filter((t) => t.quem === nome).reduce((a, t) => a + t.texto.split(/\s+/).length, 0),
    papel: papel(nome),
  }));

  const candidatos: Candidato[] = [];
  const descartados: Descartado[] = [];
  const alertas: string[] = [];

  // Parece transcrição (muitos horários) mas não achei "Nome 0:04": tudo foi lido como UM falante,
  // o cliente. Sem este aviso, o que a equipe disse seria atribuído a ele em silêncio.
  if (formato === "texto" && (bruto.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? []).length >= 5) {
    alertas.push(
      'Não reconheci o padrão de transcrição (nome do falante e horário em linha própria, como "Maria Souza 0:04"). ' +
        "Li tudo como um falante só, o cliente. Se este arquivo é uma transcrição, confira quem falou cada trecho " +
        "antes de confiar nas tarefas.",
    );
  }
  let totalFrases = 0;
  let ruido = 0;
  let ordem = 0;

  const descarta = (motivo: MotivoDescarte, detalhe: string, t: Turno, f: Frase) => {
    if (f.texto.split(/\s+/).length < 5) return;
    descartados.push({ motivo, detalhe, quem: t.quem, tempo: t.tempo, trecho: f.texto, inicio: t.inicio + f.inicio });
  };

  /** o cliente concordou com o que a equipe sugeriu? olha as próximas falas dele */
  const acordoDoCliente = (de: number): { quem: string; tempo: string; trecho: string } | null => {
    let vistas = 0;
    for (let k = de + 1; k < turnos.length && vistas < 4; k++) {
      const t = turnos[k];
      if (papel(t.quem) !== "cliente") continue;
      vistas++;
      const p = plano(t.texto);
      if (ACORDO_FORTE.test(p) || (vistas === 1 && ACORDO_FRACO.test(p))) {
        return { quem: t.quem, tempo: t.tempo, trecho: t.texto.slice(0, 90) };
      }
    }
    return null;
  };

  turnos.forEach((turno, ti) => {
    const doCliente = papel(turno.quem) === "cliente";
    const frases = dividirFrases(turno.texto);

    frases.forEach((frase, fi) => {
      totalFrases++;
      const p = plano(frase.texto);
      const palavras = p.split(/\s+/).filter(Boolean);
      const fonte: Fonte = { quem: turno.quem, tempo: turno.tempo, trecho: frase.texto, inicio: turno.inicio + frase.inicio };

      // 1. ruído de transcrição e interjeição
      const soIngles = INGLES.test(p) && !PORTUGUES.test(p);
      if (palavras.length <= 3 || RODAPE_SOCIAL.test(p) || soIngles) {
        ruido++;
        return;
      }

      // documento que o cliente vai mandar por fora: avisa, não vira tarefa
      if (doCliente && DOCUMENTO.test(p) && VOU_ENVIAR.test(p)) {
        alertas.push(
          `${turno.quem} (${turno.tempo}) cita um documento que seria enviado fora da conversa ("${frase.texto.slice(0, 90)}…"). ` +
            "Os itens dele não estão neste texto: peça o arquivo.",
        );
      }

      const temAcao = ACAO.test(p);
      const temObrigacao = OBRIGACAO.test(p);
      const pedidoEmPergunta = frase.texto.trim().endsWith("?") && PEDIDO_EM_PERGUNTA.test(p) && temAcao;
      const ehPergunta = frase.texto.trim().endsWith("?");
      const todosObjetos = objetosDe(p);
      const objetos = todosObjetos.slice(0, 2);
      const extras = todosObjetos.slice(2);
      const irmas = (o: Objeto) =>
        objetos
          .filter((x) => x !== o)
          .map((x) => `Esta mesma frase também gerou a tarefa "${x.rotulo}": se for um pedido só, apague uma das duas.`);
      const duvidaExtras = extras.length
        ? [`A mesma frase cita também ${extras.map((o) => o.rotulo).join(", ")}: confira se são tarefas separadas.`]
        : [];
      const nota = NOTA_DA_EQUIPE.test(p);
      const pendente = PENDENTE.test(p);
      const apontaProblema = PROBLEMA.test(p);

      // 2. já resolvido (na própria frase ou nas duas seguintes da mesma fala)
      const seguintes = frases.slice(fi + 1, fi + 3).map((x) => plano(x.texto));
      const jaFeito =
        !NEGACAO.test(p) &&
        (FEITO.test(p) ||
          ((SOLICITADO.test(p) || temAcao) && seguintes.some((s) => FEITO.test(s) && !NEGACAO.test(s)) && !OBRIGACAO.test(p)));
      if (jaFeito && !nota) {
        descarta("ja_resolvido", "Foi dito que isso já está feito.", turno, frase);
        return;
      }

      // 3. quando for a equipe explicando o suporte, não é pedido
      if (!doCliente && SUPORTE.test(p)) {
        descarta("processo", "A equipe explicando como o suporte funciona.", turno, frase);
        return;
      }

      // 4. notas da equipe ("deixa eu anotar aqui tcl aguardando imagens ... e home atualizar ...")
      if (nota) {
        const resto = frase.texto.split(/anotar aqui|anotando|vou anotar|anotar tamb[ée]m/i).pop() ?? "";
        const pedacos = resto.split(/\s+e\s+(?=\S+\s+(?:atualizar|aguardando|trocar|remover|alterar))/i);
        for (const pedaco of pedacos) {
          const pp = plano(pedaco);
          const objs = objetosDe(pp);
          if (!objs.length || !(ACAO.test(pp) || PENDENTE.test(pp))) continue;
          const trecho = pedaco.trim().replace(/^[,\s]+|[.\s]+$/g, "");
          for (const o of objs) {
            candidatos.push({
              chave: o.chave,
              rotulo: o.rotulo,
              frase: tiraEnchimento(trecho),
              fonte: { ...fonte, trecho: frase.texto },
              confianca: "alta",
              motivo: "A equipe anotou este item na própria reunião, com o cliente presente.",
              duvidas: PENDENTE.test(pp) ? ["Aguardando material do cliente: quais arquivos devem ser usados?"] : [],
              ordem: ordem++,
              doCliente: false,
              completo: true,
            });
          }
        }
        return;
      }

      // 4b. "Quantos itens cabem no menu?" pergunta capacidade; não pede nada
      if (ehPergunta && !pedidoEmPergunta && !temObrigacao) {
        if (doCliente) descarta("pergunta", "Pergunta do cliente, não um pedido.", turno, frase);
        return;
      }

      // 5. candidato: ação ou obrigação perto de um elemento do site
      const ehPedido = (temAcao || temObrigacao || pedidoEmPergunta || pendente || apontaProblema) && objetos.length > 0;
      if (ehPedido) {
        const completo = temAcao || pedidoEmPergunta;
        if (doCliente) {
          for (const o of objetos) {
            candidatos.push({
              chave: o.chave,
              rotulo: o.rotulo,
              frase: tiraEnchimento(frase.texto),
              fonte,
              confianca: !pedidoEmPergunta && (completo || temObrigacao) ? "alta" : "media",
              motivo: pedidoEmPergunta
                ? "O cliente pediu em forma de pergunta."
                : pendente && !completo
                  ? "O cliente apontou algo que falta."
                  : apontaProblema && !completo && !temObrigacao
                  ? "O cliente apontou um problema neste elemento, sem dizer o que fazer."
                  : "O cliente pediu uma ação sobre este elemento do site.",
              duvidas: [
                ...(SOLICITADO.test(p) ? ["O cliente citou algo pedido antes: confirmar se ainda está pendente."] : []),
                ...duvidaExtras,
                ...irmas(o),
              ],
              ordem: ordem++,
              doCliente: true,
              completo,
            });
          }
          return;
        }
        // fala da equipe: só vale se o cliente concordou depois
        const acordo = acordoDoCliente(ti);
        if (acordo) {
          for (const o of objetos) {
            candidatos.push({
              chave: o.chave,
              rotulo: o.rotulo,
              frase: tiraEnchimento(frase.texto),
              fonte,
              confianca: "media",
              motivo: `Sugestão da equipe; o cliente respondeu "${acordo.trecho}" (${acordo.tempo}).`,
              duvidas: [
                VALIDAR_COM_TIME.test(p) || VALIDAR_COM_TIME.test(plano(turno.texto))
                  ? "A equipe disse que vai validar com a área técnica: confirmar se é viável."
                  : "Sugestão da equipe aceita pelo cliente: confirmar o que ficou combinado.",
                ...duvidaExtras,
                ...irmas(o),
              ],
              ordem: ordem++,
              doCliente: false,
              completo,
            });
          }
          return;
        }
        descarta("sugestao_sem_acordo", "Fala da equipe; não encontrei o cliente concordando.", turno, frase);
        return;
      }

      // 6. o que sobrou: ação sem elemento claro, pergunta, bastidor da reunião
      if (temAcao || temObrigacao) {
        descarta(
          "sem_objeto",
          "Parece pedir uma ação, mas não diz sobre qual elemento do site (provavelmente depende do que foi dito antes).",
          turno,
          frase,
        );
      } else if (doCliente && ehPergunta) {
        descarta("pergunta", "Pergunta do cliente, não um pedido.", turno, frase);
      } else if (PROCESSO.test(p) && palavras.length >= 6) {
        descarta("processo", "Conversa sobre como a reunião ou o trabalho acontece.", turno, frase);
      }
    });
  });

  // ------------------------------------------------------------ juntar por assunto
  const grupos = new Map<string, Candidato[]>();
  for (const c of candidatos) grupos.set(c.chave, [...(grupos.get(c.chave) ?? []), c]);

  const numeros = [...texto.matchAll(/\b\d{4}[ -]?\d{4}\b/g)].map((m) => ({
    numero: m[0],
    perdido: /\b(perdi|perdeu|perdemos|antigo|antiga)\b/.test(plano(texto.slice(Math.max(0, (m.index ?? 0) - 120), m.index))),
  }));

  const tarefas: Tarefa[] = [...grupos.values()]
    .map((lista) => {
      const melhor = [...lista].sort((a, b) => {
        const pa = (a.confianca === "alta" ? 0 : 2) + (a.doCliente ? 0 : 1) + (a.completo ? 0 : 1);
        const pb = (b.confianca === "alta" ? 0 : 2) + (b.doCliente ? 0 : 1) + (b.completo ? 0 : 1);
        return pa - pb || a.ordem - b.ordem;
      })[0];

      const fontes: Fonte[] = [];
      for (const c of [melhor, ...lista.filter((x) => x !== melhor)]) {
        if (!fontes.some((f) => f.inicio === c.fonte.inicio)) fontes.push(c.fonte);
      }
      fontes.sort((a, b) => a.inicio - b.inicio);

      const duvidas = new Set(melhor.duvidas);
      const temDoCliente = lista.some((c) => c.doCliente);
      for (const c of lista) {
        if (temDoCliente && !c.doCliente) continue;
        c.duvidas.forEach((d) => duvidas.add(d));
      }
      if (melhor.chave === "telefone" || melhor.chave === "whatsapp") {
        const novos = numeros.filter((n) => !n.perdido);
        const antigo = numeros.find((n) => n.perdido);
        if (novos.length === 0) {
          duvidas.add(
            "Qual é o número novo do telefone (com DDD)?" +
              (antigo ? ` Na conversa só aparece o número antigo (${antigo.numero}), que deixou de valer.` : ""),
          );
        }
      }

      return {
        solicitacao: melhor.frase,
        assunto: melhor.rotulo,
        confianca: lista.some((c) => c.confianca === "alta") ? "alta" : "media",
        motivo: melhor.motivo + (lista.length > 1 ? ` Mencionado ${lista.length} vezes na conversa.` : ""),
        fontes: fontes.slice(0, 6),
        duvidas: [...duvidas],
        _ordem: Math.min(...lista.map((c) => c.ordem)),
      };
    })
    .sort((a, b) => a._ordem - b._ordem)
    .map(({ _ordem, ...t }) => t as Tarefa);

  // não repetir como "descartado" o que virou tarefa
  const usados = new Set(tarefas.flatMap((t) => t.fontes.map((f) => f.inicio)));
  const sobra = descartados.filter((d) => !usados.has(d.inicio)).slice(0, MAX_DESCARTADOS);

  return {
    texto,
    formato,
    falantes,
    tarefas,
    descartados: sobra,
    alertas: [...new Set(alertas)],
    resumo: { turnos: turnos.length, frases: totalFrases, ruido },
  };
}
