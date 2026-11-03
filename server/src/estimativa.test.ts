import { test } from "node:test";
import assert from "node:assert/strict";
import { estimar, estimarPorRegra } from "./estimativa.js";

const alt = (solicitacao: string, extra: Partial<{ secao: string; url_pagina: string; nivel: number }> = {}) => ({
  solicitacao,
  secao: "",
  url_pagina: "",
  ...extra,
});

test("trocar telefone é nível 1 (1h)", () => {
  const e = estimarPorRegra(alt("Trocar o telefone do rodapé para (11) 98765-4321"));
  assert.equal(e.nivel, 1, "o lugar (rodapé) não aumenta o esforço: o que pesa é o elemento");
  assert.equal(e.horas, 1);
});

test("imagem, cor e fonte são nível 2 (2h)", () => {
  assert.equal(estimarPorRegra(alt("Trocar o banner da home")).nivel, 2);
  assert.equal(estimarPorRegra(alt("Alterar a cor do botão para #FF0000")).nivel, 2);
});

test("menu e categoria são nível 3 (3h); página nova é 4 (6h); funcionalidade é 5 (10h)", () => {
  assert.deepEqual(
    [
      estimarPorRegra(alt("Adicionar a categoria Luminosos no menu")).horas,
      estimarPorRegra(alt("Criar uma página nova de Orçamento")).horas,
      estimarPorRegra(alt("Implementar um carrinho de compras")).horas,
    ],
    [3, 6, 10],
  );
});

test("quantidade alta sobe o nível, sem passar de 5", () => {
  assert.equal(estimarPorRegra(alt("Trocar 8 imagens da galeria")).nivel, 3);
  assert.equal(estimarPorRegra(alt("Trocar 20 imagens dos produtos")).nivel, 4);
  assert.equal(estimarPorRegra(alt("Implementar login e trocar 30 imagens")).nivel, 5);
});

test("várias páginas sobem um nível", () => {
  const e = estimarPorRegra(alt("Trocar o telefone", { url_pagina: "a.com/1\na.com/2\na.com/3" }));
  assert.equal(e.nivel, 2);
  assert.ok(e.motivos.some((m) => /3 páginas/.test(m)));
});

test("tarefa que não reconhece cai no nível 2 e avisa para conferir", () => {
  const e = estimarPorRegra(alt("Deixar tudo mais bonito"));
  assert.equal(e.nivel, 2);
  assert.match(e.motivos[0], /confira/);
});

test("o nível que a analista escolheu vale mais que a regra", () => {
  const e = estimar(alt("Trocar o telefone do site", { nivel: 4 }));
  assert.equal(e.nivel, 4);
  assert.equal(e.horas, 6);
  assert.equal(e.manual, true);
  assert.match(e.motivos[0], /sugeria nível 1/);
});

test("cadastrar produto novo é nível 3; só trocar a imagem de um produto continua sendo 2", () => {
  assert.equal(estimarPorRegra(alt("Adicionar um novo produto no catálogo")).nivel, 3);
  assert.equal(estimarPorRegra(alt("Trocar a imagem do produto Corrediça")).nivel, 2);
});
