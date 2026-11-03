import { test } from "node:test";
import assert from "node:assert/strict";
import { montarBriefingHtml, nomeDoHtml } from "../../client/src/briefingHtml.ts";

const base = {
  ordem: 1,
  grupo: "",
  solicitacao: "Trocar o telefone",
  url_pagina: "https://x.com.br/",
  secao: "home\nrodapé",
  link_conteudo: [] as string[],
  obs_implementacao: "",
  obs_producao: "",
  origem: "analista" as const,
  confirmado: true,
  duvidas: [] as string[],
};

const opcoes = (alteracoes = [base], extra = {}) => ({
  cliente: "Vert Portas",
  urlBase: "https://x.com.br/",
  alteracoes,
  prints: {},
  estimativas: { 1: { nivel: 1, horas: 1, motivos: [], manual: false } },
  rodada: 2,
  comHoras: false,
  geradoEm: new Date("2026-11-05T14:30:00"),
  ...extra,
});

test("html de leitura: cliente, rodada, alterações e seção com separador", () => {
  const h = montarBriefingHtml(opcoes());
  assert.match(h, /<title>Briefing — Vert Portas — rodada 2<\/title>/);
  assert.match(h, /Rodada 2/);
  assert.match(h, /1 alteração/);
  assert.match(h, /home › rodapé/);
  assert.match(h, /não editável/);
});

test("horas ficam DESLIGADAS por padrão e, ligadas, vêm rotuladas como estimativa", () => {
  assert.doesNotMatch(montarBriefingHtml(opcoes()), /~1h|Estimativa/);
  const h = montarBriefingHtml(opcoes([base], { comHoras: true }));
  assert.match(h, /Estimativa ~1h/);
  assert.match(h, /não um prazo/);
});

test("texto do cliente é escapado: nada vira tag nem script", () => {
  const h = montarBriefingHtml(
    opcoes([{ ...base, solicitacao: '<script>alert(1)</script> "x"', obs_implementacao: "<img src=x onerror=alert(1)>" }]),
  );
  assert.doesNotMatch(h, /<script>alert/);
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;script&gt;/);
});

test("só http(s) vira link; javascript: fica texto", () => {
  const h = montarBriefingHtml(
    opcoes([{ ...base, link_conteudo: ["https://drive.com/a", "javascript:alert(1)"] }]),
  );
  assert.match(h, /<a href="https:\/\/drive.com\/a"/);
  assert.doesNotMatch(h, /href="javascript:/);
});

test("grupo vira título uma vez só; prints entram embutidos", () => {
  const alts = [
    { ...base, ordem: 1, grupo: "Ficha técnica" },
    { ...base, ordem: 2, grupo: "Ficha técnica", solicitacao: "Outra" },
  ];
  const h = montarBriefingHtml(opcoes(alts, { prints: { 1: ["data:image/png;base64,AAAA"] } }));
  assert.equal((h.match(/class="grupo"/g) ?? []).length, 1);
  assert.match(h, /<img src="data:image\/png;base64,AAAA"/);
});

test("nome do arquivo: sem acento, com rodada e data", () => {
  assert.equal(nomeDoHtml("Vert Portas & Esquadrias", 3, new Date("2026-11-05T12:00:00")), "briefing-vert-portas-esquadrias-rodada-3-2026-11-05.html");
});
