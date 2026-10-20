import { RAIZ } from "./env.js"; // carrega o .env — tem que ser o primeiro import
import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import { BriefingSchema } from "./schema.js";
import { lintBriefing, temErro, type Contexto } from "./lint.js";
import {
  abaAlteracao,
  abrir,
  acrescentarAlteracoes,
  gerarPlanilha,
  linhasOcupadas,
  nomeDoArquivo,
  possiveisDuplicadas,
  primeiraLinhaLivre,
  type Print,
} from "./xlsx.js";
import {
  ChaveNecessariaError,
  iaAtiva,
  modoIA,
  provedorPadraoProprio,
  MODELO,
  type ChaveCliente,
} from "./anthropic.js";
import { sugerir, MAX_CARACTERES } from "./ia.js";
import { revisar } from "./revisor.js";
import { montarPerguntas } from "./perguntas.js";
import { OrigemPedidoSchema, ULTIMA_LINHA_DADOS, VereditoSchema } from "./schema.js";
import { extrair } from "./conversa.js";
import { ErroDeArquivo, textoDoArquivo } from "./arquivo.js";
import { manipuladorDeErros, rotaApiDesconhecida } from "./erros.js";

const TEMPLATE =
  process.env.TEMPLATE_PATH ??
  path.join(RAIZ, "templates", "briefing-modelo.xlsx");

const PORTA = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 100 },
});

const EXTENSOES: Record<string, Print["extensao"]> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
};

app.get("/api/health", (_req, res) => {
  const modo = modoIA();
  res.json({
    ok: true,
    template: TEMPLATE,
    ia: {
      ativa: modo !== "desligada",
      modo,
      // so ha um "modelo ativo" fixo no modo servidor — no "proprio" cada
      // visitante escolhe provedor/chave, entao nao existe um unico nome aqui
      modelo: modo === "servidor" ? MODELO : null,
      // dica de qual provedor pre-selecionar no formulario de "colar sua chave"
      provedorPadrao: modo === "proprio" ? provedorPadraoProprio() : null,
      maxCaracteres: MAX_CARACTERES,
    },
  });
});

/**
 * A chave que o PROPRIO VISITANTE colou no navegador, se houver.
 *
 * So importa no modo "proprio" (servidor sem chave configurada) — nos outros
 * modos e ignorada (ver o comentario em gerarEstruturado). Nunca e logada nem
 * guardada: vive so pelo tempo da chamada.
 */
function chaveClienteDoRequest(req: express.Request): ChaveCliente | undefined {
  const chave = req.get("X-IA-Chave")?.trim();
  const provedorHeader = req.get("X-IA-Provedor")?.trim().toLowerCase();
  if (!chave || (provedorHeader !== "anthropic" && provedorHeader !== "gemini")) return undefined;
  return { provedor: provedorHeader, chave };
}

/**
 * Fase 2 — a IA separa o texto do cliente em alteracoes.
 *
 * Fica atras de flag: com IA_ATIVA=false a rota responde 503 e o app inteiro
 * continua funcionando sem IA. Sem chave no servidor (modo "proprio"), a rota
 * segue adiante e pede a chave do visitante — so da 401 se ela nao vier.
 */
app.post("/api/sugerir", async (req, res) => {
  if (!iaAtiva()) {
    return res.status(503).json({
      erro: "A sugestão por IA está desligada. Preencha as alterações à mão.",
      ia_ativa: false,
    });
  }
  const texto = typeof req.body?.texto === "string" ? req.body.texto : "";
  const origem = OrigemPedidoSchema.safeParse(req.body?.origem);
  try {
    const r = await sugerir(
      texto,
      origem.success ? origem.data : "mensagem",
      chaveClienteDoRequest(req),
    );
    console.log(
      `[sugerir:${r.origem}] ${r.alteracoes.length} alterações` +
        (r.decisoes_revertidas.length
          ? `, ${r.decisoes_revertidas.length} decisão(ões) revertida(s)`
          : "") +
        ` | entrada ${r.uso.entrada} saída ${r.uso.saida} ` +
        `cache_lido ${r.uso.cache_lido} | ${r.uso.modelo}`,
    );
    res.json(r);
  } catch (e) {
    if (e instanceof ChaveNecessariaError) {
      return res.status(401).json({ erro: e.message, precisa_chave: true });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sugerir]", msg);
    res.status(502).json({ erro: msg });
  }
});

/**
 * Importa uma conversa (PDF/DOCX/TXT/VTT do Teams) e a le POR REGRA, sem IA: devolve
 * as tarefas que parecem pedidos, o que ficou de fora e por que, e de onde cada
 * tarefa saiu. Funciona com ou sem chave de IA.
 */
app.post("/api/importar", upload.single("arquivo"), async (req, res) => {
  try {
    const arquivo = req.file;
    if (!arquivo) return res.status(400).json({ erro: "Envie o arquivo no campo 'arquivo'." });

    let clientes: string[] | undefined;
    try {
      const bruto = typeof req.body?.clientes === "string" ? JSON.parse(req.body.clientes) : null;
      if (Array.isArray(bruto)) clientes = bruto.filter((x): x is string => typeof x === "string");
    } catch {
      /* campo malformado: segue com o palpite automático */
    }

    // o multer entrega o nome em latin1: "Reunião.pdf" chegaria como "ReuniÃ£o.pdf"
    const nome = nomeDoUpload(arquivo.originalname);
    const texto = await textoDoArquivo(nome, arquivo.buffer);
    if (!texto.trim()) {
      return res.status(422).json({ erro: "O arquivo está vazio: não achei nenhum texto nele." });
    }
    const resultado = extrair(texto, { clientes });
    console.log(
      `[importar] ${nome} | ${resultado.formato} | ${resultado.resumo.turnos} falas, ` +
        `${resultado.tarefas.length} tarefas, ${resultado.descartados.length} descartados`,
    );
    res.json({ arquivo: nome, ...resultado });
  } catch (e) {
    if (e instanceof ErroDeArquivo) return res.status(e.status).json({ erro: e.message });
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[importar]", e instanceof Error ? (e.stack ?? msg) : msg);
    res.status(422).json({ erro: `Não consegui ler o arquivo: ${msg}` });
  }
});

/**
 * Fase 3 — revisor semantico.
 *
 * Acao EXPLICITA, nunca no debounce: /api/revisar roda a cada 400ms e chamar a
 * IA ali seria o maior desperdicio de token do projeto. O front manda so as
 * alteracoes que mudaram desde a ultima revisao.
 */
app.post("/api/revisar-ia", async (req, res) => {
  if (!iaAtiva()) {
    return res.status(503).json({
      erro: "A revisão por IA está desligada.",
      ia_ativa: false,
    });
  }
  const parsed = BriefingSchema.safeParse(req.body?.briefing ?? req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Briefing inválido", detalhes: parsed.error.issues });
  }
  try {
    const r = await revisar(parsed.data.alteracoes, chaveClienteDoRequest(req));
    const reprovadas = r.vereditos.filter((v) => !v.executavel).length;
    console.log(
      `[revisar-ia] ${r.vereditos.length} vereditos (${reprovadas} com pergunta) | ` +
        `entrada ${r.uso.entrada} saída ${r.uso.saida} cache_lido ${r.uso.cache_lido}`,
    );
    if (r.faltantes.length) console.warn("[revisar-ia] sem veredito:", r.faltantes);
    res.json(r);
  } catch (e) {
    if (e instanceof ChaveNecessariaError) {
      return res.status(401).json({ erro: e.message, precisa_chave: true });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[revisar-ia]", msg);
    res.status(502).json({ erro: msg });
  }
});

/**
 * Monta as perguntas a mandar ao cliente. Deterministico — nao chama IA.
 * Os vereditos sao opcionais: sem eles a lista sai so com lint + duvidas.
 */
app.post("/api/perguntas", (req, res) => {
  const parsed = BriefingSchema.safeParse(req.body?.briefing ?? req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Briefing inválido", detalhes: parsed.error.issues });
  }
  const vereditos = VereditoSchema.array().safeParse(req.body?.vereditos ?? []);
  const contextos = contextosDeBody(req.body?.prints);
  res.json(
    montarPerguntas(parsed.data, vereditos.success ? vereditos.data : [], contextos),
  );
});

/**
 * Fase 1: o lint deterministico. Roda no debounce do front, entao precisa ser
 * barato — o revisor semantico mora em /api/revisar-ia, sob acao explicita.
 */
app.post("/api/revisar", (req, res) => {
  const parsed = BriefingSchema.safeParse(req.body?.briefing ?? req.body);
  if (!parsed.success) {
    return res.status(400).json({ erro: "Briefing inválido", detalhes: parsed.error.issues });
  }
  const contextos = contextosDeBody(req.body?.prints);
  const achados = lintBriefing(parsed.data, contextos);
  res.json({ achados, bloqueado: temErro(achados) });
});

/**
 * Gera o .xlsx. Os prints chegam como arquivos cujo fieldname e `print_<ordem>`.
 */
app.post("/api/gerar", upload.any(), async (req, res) => {
  try {
    const bruto = typeof req.body?.briefing === "string"
      ? JSON.parse(req.body.briefing)
      : req.body?.briefing;

    const parsed = BriefingSchema.safeParse(bruto);
    if (!parsed.success) {
      return res.status(400).json({ erro: "Briefing inválido", detalhes: parsed.error.issues });
    }
    const briefing = parsed.data;

    const prints = printsDoRequest((req.files as Express.Multer.File[] | undefined) ?? []);
    const achados = lintBriefing(briefing, contextosDePrints(briefing, prints));
    if (temErro(achados)) {
      return res.status(422).json({
        erro: "Há alterações incompletas. Corrija antes de gerar.",
        achados: achados.filter((a) => a.severidade === "erro"),
      });
    }

    const buffer = await gerarPlanilha({ templatePath: TEMPLATE, briefing, prints });
    const nome = nomeDoArquivo(briefing.cliente);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.setHeader("X-Nome-Arquivo", nome);
    res.send(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[gerar]", msg);
    res.status(500).json({ erro: msg });
  }
});

/**
 * Fase 4 — inspeciona uma planilha JA EM EXECUCAO antes de mexer nela.
 *
 * Etapa separada de proposito: o analista precisa ver o que ja esta la e onde
 * as novas linhas vao cair ANTES de confirmar. A planilha tem estado de outras
 * pessoas nas colunas G/H/I.
 */
app.post("/api/inspecionar", upload.any(), async (req, res) => {
  try {
    const arquivo = (req.files as Express.Multer.File[] | undefined)?.find(
      (f) => f.fieldname === "planilha",
    );
    if (!arquivo) return res.status(400).json({ erro: "Envie a planilha no campo 'planilha'." });

    const wb = await abrir(arquivo.buffer);
    const ws = abaAlteracao(wb);
    const existentes = linhasOcupadas(ws);
    const proxima = primeiraLinhaLivre(ws);

    const bruto =
      typeof req.body?.briefing === "string" ? JSON.parse(req.body.briefing) : null;
    const parsed = bruto ? BriefingSchema.safeParse(bruto) : null;
    const duplicadas =
      parsed?.success ? possiveisDuplicadas(existentes, parsed.data.alteracoes) : [];

    res.json({
      jaExistiam: existentes.length,
      primeiraLinhaLivre: proxima,
      capacidadeRestante: Math.max(0, ULTIMA_LINHA_DADOS - proxima + 1),
      emExecucao: existentes.filter((e) => e.val_producao && e.val_producao !== "Aguardando")
        .length,
      existentes,
      duplicadas,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[inspecionar]", msg);
    res.status(422).json({ erro: msg });
  }
});

/**
 * Acrescenta as alteracoes novas ao fim da planilha enviada e devolve o MESMO
 * arquivo atualizado — nunca um arquivo novo. O link que ja esta no Salesforce
 * continua valendo e o estado de G/H/I e preservado.
 */
app.post("/api/acrescentar", upload.any(), async (req, res) => {
  try {
    const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
    const planilha = arquivos.find((f) => f.fieldname === "planilha");
    if (!planilha) return res.status(400).json({ erro: "Envie a planilha no campo 'planilha'." });

    const bruto =
      typeof req.body?.briefing === "string" ? JSON.parse(req.body.briefing) : req.body?.briefing;
    const parsed = BriefingSchema.safeParse(bruto);
    if (!parsed.success) {
      return res.status(400).json({ erro: "Briefing inválido", detalhes: parsed.error.issues });
    }
    const briefing = parsed.data;

    const prints = printsDoRequest(arquivos);
    const achados = lintBriefing(briefing, contextosDePrints(briefing, prints));
    if (temErro(achados)) {
      return res.status(422).json({
        erro: "Há alterações incompletas. Corrija antes de acrescentar.",
        achados: achados.filter((a) => a.severidade === "erro"),
      });
    }

    const r = await acrescentarAlteracoes({ arquivo: planilha.buffer, briefing, prints });
    const nome = planilha.originalname || nomeDoArquivo(briefing.cliente);

    console.log(
      `[acrescentar] ${briefing.alteracoes.length} alterações nas linhas ` +
        `${r.primeiraLinha}–${r.ultimaLinha} (a planilha já tinha ${r.jaExistiam})`,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    res.setHeader("X-Nome-Arquivo", nome);
    res.setHeader("X-Linhas", `${r.primeiraLinha}-${r.ultimaLinha}`);
    res.send(r.arquivo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[acrescentar]", msg);
    res.status(422).json({ erro: msg });
  }
});

/** O multer lê o nome do arquivo como latin1; se o original era UTF-8, desfaz a troca. */
function nomeDoUpload(original: string): string {
  const corrigido = Buffer.from(original, "latin1").toString("utf8");
  return corrigido.includes("�") ? original : corrigido;
}

function printsDoRequest(arquivos: Express.Multer.File[]): Print[] {
  const prints: Print[] = [];
  for (const f of arquivos) {
    const m = /^print_(\d+)$/.exec(f.fieldname);
    const extensao = EXTENSOES[f.mimetype];
    if (!m || !extensao) continue;
    prints.push({ ordem: Number(m[1]), buffer: f.buffer, extensao });
  }
  return prints;
}

function contextosDePrints(
  briefing: { alteracoes: { ordem: number }[] },
  prints: Print[],
): Map<number, Contexto> {
  const mapa = new Map<number, Contexto>();
  for (const alt of briefing.alteracoes) {
    mapa.set(alt.ordem, { prints: prints.filter((p) => p.ordem === alt.ordem).length });
  }
  return mapa;
}

function contextosDeBody(prints: unknown): Map<number, Contexto> {
  const mapa = new Map<number, Contexto>();
  if (prints && typeof prints === "object") {
    for (const [ordem, qtd] of Object.entries(prints as Record<string, number>)) {
      mapa.set(Number(ordem), { prints: Number(qtd) || 0 });
    }
  }
  return mapa;
}

/**
 * Produção: o mesmo processo entrega o front já compilado (client/dist), então
 * hospedar é subir UM serviço Node — sem banco, sem segundo servidor. Em
 * desenvolvimento a pasta não existe e o Vite (porta 5173) serve o front.
 */
// /api/... que não existe responde JSON (e não a página HTML do Express nem o index do front)
app.use("/api", rotaApiDesconhecida);

const DIST = path.join(RAIZ, "client", "dist");
if (fs.existsSync(path.join(DIST, "index.html"))) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

// tem que ser o ÚLTIMO: erros do multer e do body-parser também viram JSON
app.use(manipuladorDeErros);

// Na Vercel quem sobe o processo HTTP é a plataforma (ver api/index.js, que
// so importa `app` e deixa o runtime serverless chamar `app(req, res)`) —
// chamar .listen() ali daria erro de porta já em uso a cada invocação fria.
if (!process.env.VERCEL) {
  app.listen(PORTA, () => {
    console.log(`servidor em http://localhost:${PORTA}`);
    console.log(`template: ${TEMPLATE}`);
  });
}

export default app;
