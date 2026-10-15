import { test } from "node:test";
import assert from "node:assert/strict";
import { paraRevisao, revisar, PROMPT_REVISOR, TAMANHO_LOTE } from "./revisor.js";
import { AlteracaoSchema } from "./schema.js";

/** Nada aqui chama a API — testa a fronteira e o que vai no prompt. */

const alt = (p: Record<string, unknown>) =>
  AlteracaoSchema.parse({ ordem: 1, url_pagina: "https://exemplo.com.br/maquinas/prima", ...p });

test("o revisor vê só o que o dev veria", () => {
  const texto = paraRevisao(
    alt({
      solicitacao: "remover essa máquina",
      secao: "prima",
      obs_implementacao: "ver print",
      link_conteudo: ["https://exemplo/pasta"],
    }),
  );
  assert.match(texto, /remover essa máquina/);
  assert.match(texto, /maquinas\/prima/);
  assert.match(texto, /Seção: prima/);
  assert.match(texto, /Obs\. Implementação: ver print/);
});

test("manda a contagem de links, não os links em si", () => {
  // o conteudo do link nao ajuda o julgamento e so gastaria token
  const texto = paraRevisao(
    alt({ solicitacao: "trocar o banner", link_conteudo: ["https://sharepoint/secreto"] }),
  );
  assert.doesNotMatch(texto, /secreto/);
  assert.match(texto, /1 link/);
});

test("campo vazio aparece como não informado, não some", () => {
  const texto = paraRevisao(alt({ solicitacao: "trocar o banner", secao: "" }));
  assert.match(texto, /Seção: \(não informada\)/);
});

test("não gasta chamada quando não há o que revisar", async () => {
  const r = await revisar([]);
  assert.deepEqual(r.vereditos, []);
  assert.equal(r.uso.entrada, 0);
});

test("alteração sem descrição é ignorada — já é pendência do lint", async () => {
  // se chamasse a API aqui, estouraria por falta de chave; passar significa
  // que o filtro funcionou antes de qualquer requisicao
  const r = await revisar([alt({ solicitacao: "   " })]);
  assert.deepEqual(r.vereditos, []);
  assert.equal(r.uso.saida, 0);
});

test("o lote tem tamanho sensato", () => {
  assert.ok(TAMANHO_LOTE >= 5 && TAMANHO_LOTE <= 30);
});

// ------------------------------------------------------- modo "proprio": bring your own key

test("modo 'proprio' sem chave do visitante recusa de cara, sem lote nenhum", async () => {
  const antes = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, IA_ATIVA: process.env.IA_ATIVA };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.IA_ATIVA;
  const original = globalThis.fetch;
  let chamou = false;
  globalThis.fetch = (async () => {
    chamou = true;
    throw new Error("não deveria ter chamado a rede");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => revisar([alt({ solicitacao: "remover essa máquina" })]),
      /Configurar IA/,
    );
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.equal(chamou, false);
});

test("o prompt manda ser conservador e não repetir o lint", () => {
  assert.match(PROMPT_REVISOR, /SEJA CONSERVADOR/);
  assert.match(PROMPT_REVISOR, /escolha \*\*executável\*\*/);
  assert.match(PROMPT_REVISOR, /não checa campo vazio/);
  // a pergunta e para o cliente, nao para o analista
  assert.match(PROMPT_REVISOR, /ao cliente/);
});
