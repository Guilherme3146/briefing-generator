import { test } from "node:test";
import assert from "node:assert/strict";
import { paraAlteracoes, sugerir, PROMPT_SISTEMA, PROMPT_REUNIAO, MAX_CARACTERES } from "./ia.js";
import { iaAtiva, provedor, schemaParaGemini } from "./anthropic.js";
import { lintAlteracao } from "./lint.js";
import { AlteracaoSchema, SugestaoSchema } from "./schema.js";

/**
 * Nada aqui chama a API. O que se testa e a fronteira: converter a saida da IA
 * em cards, e a trava de confirmacao. A qualidade do prompt se mede com o
 * conjunto de pares reais, nao com teste unitario.
 */

const SEM_PRINT = { prints: 0 };

function sugestao(parcial: Record<string, unknown>) {
  return SugestaoSchema.parse({
    alteracoes: [],
    trechos_ignorados: [],
    ...parcial,
  });
}

const base = {
  ordem: 1,
  grupo: "",
  solicitacao: "trocar o banner",
  url_pagina: "https://exemplo.com.br/",
  secao: "home",
  link_conteudo: [],
  obs_implementacao: "",
  obs_producao: "",
  duvidas: [],
};

// ------------------------------------------------------------- conversao IA

test("card vindo da IA nasce nao confirmado e com origem 'ia'", () => {
  const [a] = paraAlteracoes(sugestao({ alteracoes: [base] }));
  assert.equal(a.origem, "ia");
  assert.equal(a.confirmado, false);
});

test("renumera a ordem quando o modelo pula numero", () => {
  const r = paraAlteracoes(
    sugestao({
      alteracoes: [
        { ...base, ordem: 5, solicitacao: "primeira" },
        { ...base, ordem: 9, solicitacao: "segunda" },
      ],
    }),
  );
  assert.deepEqual(r.map((a) => a.ordem), [1, 2]);
  assert.equal(r[0].solicitacao, "primeira");
});

test("limpa link e duvida em branco", () => {
  const [a] = paraAlteracoes(
    sugestao({
      alteracoes: [{ ...base, link_conteudo: [" https://x ", "", "   "], duvidas: ["", " Qual? "] }],
    }),
  );
  assert.deepEqual(a.link_conteudo, ["https://x"]);
  assert.deepEqual(a.duvidas, ["Qual?"]);
});

// ------------------------------------------------------- trava de confirmacao

test("card nao confirmado bloqueia a geracao", () => {
  const [a] = paraAlteracoes(sugestao({ alteracoes: [base] }));
  const achados = lintAlteracao(a, SEM_PRINT);
  const trava = achados.find((x) => x.regra === "NAO_CONFIRMADO");
  assert.equal(trava?.severidade, "erro");
});

test("confirmar libera a geracao", () => {
  const [a] = paraAlteracoes(sugestao({ alteracoes: [base] }));
  const achados = lintAlteracao({ ...a, confirmado: true }, SEM_PRINT);
  assert.ok(!achados.some((x) => x.severidade === "erro"));
});

test("card criado a mao ja nasce confirmado", () => {
  const a = AlteracaoSchema.parse({ ordem: 1, solicitacao: "x", url_pagina: "https://x" });
  assert.equal(a.confirmado, true);
  assert.equal(a.origem, "analista");
});

// -------------------------------------------------------------------- duvidas

test("cada duvida da IA vira um aviso proprio", () => {
  const [a] = paraAlteracoes(
    sugestao({
      alteracoes: [{ ...base, duvidas: ["Qual máquina remover?", "O cliente envia a imagem?"] }],
    }),
  );
  const duvidas = lintAlteracao({ ...a, confirmado: true }, SEM_PRINT).filter(
    (x) => x.regra === "DUVIDA_DA_IA",
  );
  assert.equal(duvidas.length, 2);
  assert.ok(duvidas.every((d) => d.severidade === "aviso"));
  assert.equal(duvidas[0].mensagem, "Qual máquina remover?");
});

// ----------------------------------------------------------------------- flag

const VARS_IA = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "IA_ATIVA", "IA_PROVEDOR"];

/** Roda `fn` com as variaveis de IA controladas e restaura o ambiente depois. */
async function comAmbiente(vars: Record<string, string>, fn: () => unknown | Promise<unknown>) {
  const antes = Object.fromEntries(VARS_IA.map((k) => [k, process.env[k]]));
  for (const k of VARS_IA) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    await fn();
  } finally {
    for (const k of VARS_IA) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}

test("a IA fica desligada sem chave", async () => {
  await comAmbiente({}, () => assert.equal(iaAtiva(), false));
});

test("IA_ATIVA=false desliga mesmo com chave presente", async () => {
  await comAmbiente({ ANTHROPIC_API_KEY: "sk-teste", IA_ATIVA: "false" }, () =>
    assert.equal(iaAtiva(), false),
  );
  await comAmbiente({ ANTHROPIC_API_KEY: "sk-teste", IA_ATIVA: "true" }, () =>
    assert.equal(iaAtiva(), true),
  );
});

// ------------------------------------------------------------------- provedor

test("so a chave do Gemini liga a IA, no provedor gemini", async () => {
  await comAmbiente({ GEMINI_API_KEY: "g-teste" }, () => {
    assert.equal(iaAtiva(), true);
    assert.equal(provedor(), "gemini");
  });
});

test("com as duas chaves, a Anthropic ganha, a menos que IA_PROVEDOR force o Gemini", async () => {
  const chaves = { ANTHROPIC_API_KEY: "sk-teste", GEMINI_API_KEY: "g-teste" };
  await comAmbiente(chaves, () => assert.equal(provedor(), "anthropic"));
  await comAmbiente({ ...chaves, IA_PROVEDOR: "gemini" }, () =>
    assert.equal(provedor(), "gemini"),
  );
});

test("forcar um provedor sem a chave dele desliga a IA", async () => {
  await comAmbiente({ ANTHROPIC_API_KEY: "sk-teste", IA_PROVEDOR: "gemini" }, () =>
    assert.equal(iaAtiva(), false),
  );
});

// --------------------------------------------------------------------- Gemini

/** Troca o fetch global por um falso que devolve `corpo` e registra a chamada. */
async function comGeminiFalso(
  corpo: unknown,
  fn: (chamadas: { url: string; init: RequestInit }[]) => Promise<void>,
  status = 200,
) {
  const original = globalThis.fetch;
  const chamadas: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return new Response(JSON.stringify(corpo), { status });
  }) as typeof fetch;
  try {
    await comAmbiente({ GEMINI_API_KEY: "g-teste" }, () => fn(chamadas));
  } finally {
    globalThis.fetch = original;
  }
}

const respostaGemini = (obj: unknown) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 10 },
  modelVersion: "gemini-teste",
});

test("Gemini: devolve cards nao confirmados e conta o uso", async () => {
  await comGeminiFalso(
    respostaGemini({ alteracoes: [base], trechos_ignorados: ["pergunta sobre velocidade"] }),
    async (chamadas) => {
      const r = await sugerir("trocar o banner da home", "mensagem");
      assert.equal(r.alteracoes.length, 1);
      assert.equal(r.alteracoes[0].confirmado, false);
      assert.equal(r.alteracoes[0].origem, "ia");
      assert.deepEqual(r.trechos_ignorados, ["pergunta sobre velocidade"]);
      assert.equal(r.uso.entrada, 120);
      assert.equal(r.uso.saida, 40); // saida + raciocinio
      assert.equal(chamadas.length, 1);
    },
  );
});

test("Gemini: a chave vai no cabecalho, nunca na URL, e o schema pede JSON", async () => {
  await comGeminiFalso(respostaGemini({ alteracoes: [], trechos_ignorados: [] }), async (chamadas) => {
    await sugerir("qualquer pedido", "mensagem");
    const { url, init } = chamadas[0];
    assert.ok(!url.includes("g-teste"));
    assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], "g-teste");
    const corpo = JSON.parse(String(init.body));
    assert.equal(corpo.generationConfig.responseMimeType, "application/json");
    assert.ok(corpo.generationConfig.responseJsonSchema.properties.alteracoes);
    assert.equal(corpo.generationConfig.responseJsonSchema.$schema, undefined);
    assert.match(corpo.systemInstruction.parts[0].text, /NUNCA invente/);
  });
});

test("Gemini: resposta fora do schema vira erro legivel, nao card quebrado", async () => {
  await comGeminiFalso(respostaGemini({ alteracoes: "nao e lista" }), async () => {
    await assert.rejects(() => sugerir("pedido", "mensagem"), /fora do formato esperado/);
  });
});

test("Gemini: limite gratuito (429) explica o que fazer", async () => {
  await comGeminiFalso(
    { error: { message: "quota" } },
    async () => {
      await assert.rejects(() => sugerir("pedido", "mensagem"), /limite gratuito/);
    },
    429,
  );
});

test("Gemini: 503 passageiro e repetido e acaba funcionando", async () => {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    if (n < 3) return new Response(JSON.stringify({ error: { message: "demanda" } }), { status: 503 });
    return new Response(
      JSON.stringify(respostaGemini({ alteracoes: [base], trechos_ignorados: [] })),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    await comAmbiente({ GEMINI_API_KEY: "g-teste" }, async () => {
      const r = await sugerir("pedido", "mensagem");
      assert.equal(r.alteracoes.length, 1);
      assert.equal(n, 3);
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Gemini: limite DIARIO (429) avisa que so volta em horas e sugere trocar de modelo", async () => {
  await comGeminiFalso(
    {
      error: {
        message: "quota",
        details: [
          { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22074s" },
        ],
      },
    },
    async () => {
      await assert.rejects(
        () => sugerir("pedido", "mensagem"),
        (e: Error) => /limite diário/.test(e.message) && /6h/.test(e.message) && /GEMINI_MODEL/.test(e.message),
      );
    },
    429,
  );
});

test("Gemini: texto bloqueado pelo filtro vira erro, nao lista vazia", async () => {
  await comGeminiFalso({ promptFeedback: { blockReason: "SAFETY" } }, async () => {
    await assert.rejects(() => sugerir("pedido", "mensagem"), /bloqueou/);
  });
});

test("o schema enviado ao Gemini nao carrega limites de inteiro seguro", () => {
  const json = JSON.stringify(schemaParaGemini(SugestaoSchema));
  assert.ok(!json.includes("9007199254740991"));
});

// ---------------------------------------------------------------------- prompt

test("o prompt de sistema carrega e traz as regras que seguram invencao", () => {
  assert.ok(PROMPT_SISTEMA.length > 500);
  assert.match(PROMPT_SISTEMA, /NUNCA invente/);
  assert.match(PROMPT_SISTEMA, /trechos_ignorados/);
  assert.match(PROMPT_SISTEMA, /LITERALMENTE/);
});

test("ha limite de tamanho por origem", () => {
  assert.ok(MAX_CARACTERES.mensagem > 0);
  assert.ok(
    MAX_CARACTERES.reuniao > MAX_CARACTERES.mensagem,
    "transcrição rende ~50 mil caracteres por hora de reunião — precisa caber mais que mensagem",
  );
});

// ------------------------------------------------- Fase 5: reunião

test("o prompt de reunião proíbe tratar fala como texto final", () => {
  assert.match(PROMPT_REUNIAO, /NADA DE REUNIÃO É TEXTO FINAL/);
  assert.match(PROMPT_REUNIAO, /redação exata por escrito/);
});

test("o prompt de reunião manda rastrear decisão revertida", () => {
  assert.match(PROMPT_REUNIAO, /A ÚLTIMA DECISÃO É A QUE VALE/);
  assert.match(PROMPT_REUNIAO, /decisoes_revertidas/);
});

test("o prompt de reunião manda marcar o que a transcrição corrompeu", () => {
  assert.match(PROMPT_REUNIAO, /mal transcrito|corrompeu/i);
});

test("os dois prompts são diferentes", () => {
  assert.notEqual(PROMPT_SISTEMA, PROMPT_REUNIAO);
  // a regra que vale para mensagem é justamente a que não pode valer para reunião
  assert.match(PROMPT_SISTEMA, /copie esse texto LITERALMENTE/);
  assert.doesNotMatch(PROMPT_REUNIAO, /copie esse texto LITERALMENTE/);
});

test("transcrição vazia é recusada antes de gastar chamada", async () => {
  await assert.rejects(() => sugerir("   ", "reuniao"), /transcrição está vazia/i);
});

test("texto acima do limite é recusado antes de gastar chamada", async () => {
  await assert.rejects(
    () => sugerir("x".repeat(MAX_CARACTERES.mensagem + 1), "mensagem"),
    /limite para mensagem/,
  );
});
