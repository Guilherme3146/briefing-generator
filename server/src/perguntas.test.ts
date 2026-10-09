import { test } from "node:test";
import assert from "node:assert/strict";
import { montarPerguntas } from "./perguntas.js";
import { AlteracaoSchema, BriefingSchema, type Veredito } from "./schema.js";

function briefing(alteracoes: Record<string, unknown>[], cliente = "Cliente X") {
  return BriefingSchema.parse({
    cliente,
    url_base: "",
    alteracoes: alteracoes.map((a, i) =>
      AlteracaoSchema.parse({ ordem: i + 1, url_pagina: "https://exemplo.com.br/", ...a }),
    ),
  });
}

const veredito = (p: Partial<Veredito>): Veredito => ({
  ordem: 1,
  executavel: false,
  motivo: "não dá para saber qual",
  pergunta: "Na página de máquinas Prima, qual máquina devemos remover?",
  ...p,
});

// ------------------------------------------------------------------- origens

test("dúvida do extrator vira pergunta", () => {
  // solicitacao que nao dispara regra nenhuma, para isolar a origem "duvida"
  const r = montarPerguntas(
    briefing([
      {
        solicitacao: 'remover o produto "personalização de veículos"',
        secao: "produtos",
        duvidas: ["Você envia a imagem nova?"],
      },
    ]),
  );
  assert.deepEqual(
    r.itens.map((i) => i.origem),
    ["duvida"],
  );
  assert.equal(r.itens[0].texto, "Você envia a imagem nova?");
});

test("regra do FAQ vira pergunta escrita para o cliente, não a mensagem do lint", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: "deixar o fundo do rodapé azul", secao: "rodapé" }]),
  );
  const cor = r.itens.find((i) => i.regra === "COR_SEM_HEX");
  assert.ok(cor, "deveria perguntar sobre a cor");
  assert.match(cor.texto, /código exato da cor/);
  // a mensagem do lint fala com o analista; nao pode vazar para o cliente
  assert.doesNotMatch(cor.texto, /FAQ|hexadecimal não basta/i);
});

test("veredito do revisor vira pergunta", () => {
  const r = montarPerguntas(briefing([{ solicitacao: "remover essa máquina" }]), [veredito({})]);
  const rev = r.itens.find((i) => i.origem === "revisor");
  assert.match(rev!.texto, /qual máquina devemos remover/i);
});

// --------------------------------------------------------- lacunas internas

test("lacuna interna não vira pergunta ao cliente", () => {
  // sem URL e sem seção: é problema do analista, não do cliente
  const r = montarPerguntas(
    briefing([
      { solicitacao: 'remover o produto "personalização de veículos"', url_pagina: "", secao: "" },
    ]),
  );
  assert.equal(r.itens.length, 0);
  assert.equal(r.texto, "");
});

test("card não confirmado não vira pergunta ao cliente", () => {
  const r = montarPerguntas(
    briefing([
      {
        solicitacao: 'remover o produto "personalização de veículos"',
        secao: "produtos",
        confirmado: false,
        origem: "ia",
      },
    ]),
  );
  assert.ok(!r.itens.some((i) => i.regra === "NAO_CONFIRMADO"));
});

// ------------------------------------------------------------------ dedupe

test("o revisor substitui a pergunta genérica de referência vaga", () => {
  const alt = { solicitacao: "remover essa máquina", secao: "prima" };
  const sem = montarPerguntas(briefing([alt]));
  const com = montarPerguntas(briefing([alt]), [veredito({})]);

  assert.ok(
    sem.itens.some((i) => i.regra === "REFERENCIA_VAGA"),
    "sem revisor, a heurística pergunta",
  );
  assert.ok(
    !com.itens.some((i) => i.regra === "REFERENCIA_VAGA"),
    "com revisor, não repete a mesma dúvida em outras palavras",
  );
  assert.equal(com.itens.filter((i) => i.ordem === 1).length, 1);
});

test("não repete pergunta idêntica na mesma alteração", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: "trocar o banner", duvidas: ["Você envia a imagem?", "Você envia a imagem?"] }]),
  );
  assert.equal(r.itens.filter((i) => i.origem === "duvida").length, 1);
});

test("alteração executável não gera pergunta do revisor", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: 'remover o produto "personalização de veículos"' }]),
    [veredito({ executavel: true, pergunta: "", motivo: "" })],
  );
  assert.ok(!r.itens.some((i) => i.origem === "revisor"));
});

// ------------------------------------------------------------------- formato

test("o texto sai numerado, agrupado e com o nome do cliente", () => {
  const r = montarPerguntas(
    briefing(
      [
        { solicitacao: "remover essa máquina", secao: "prima" },
        { solicitacao: "deixar o rodapé azul", secao: "rodapé" },
      ],
      "Amorim Letreiros",
    ),
    [veredito({ ordem: 1 })],
  );
  assert.match(r.texto, /Amorim Letreiros/);
  assert.match(r.texto, /^1\. /m);
  assert.match(r.texto, /^2\. /m);
  assert.match(r.texto, /Sobre "remover essa máquina"/);
  assert.match(r.texto, /seção prima/);
});

test("sem perguntas, o texto fica vazio", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: 'remover o produto "personalização de veículos"', secao: "produtos" }]),
  );
  assert.equal(r.itens.length, 0);
  assert.equal(r.texto, "");
});

test("não repete a localização dentro da pergunta quando o cabeçalho já diz", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: "deixar o fundo do rodapé azul", secao: "rodapé" }]),
  );
  // o item da API continua autocontido...
  assert.match(r.itens[0].texto, /^Na página .*: qual o código exato/);
  // ...mas o bloco formatado não repete o local logo abaixo do cabeçalho
  assert.match(r.texto, /^1\. Qual o código exato da cor/m);
  assert.equal(r.texto.match(/na página exemplo\.com\.br/gi)?.length, 1);
});

test("a seção multi-linha vira caminho legível", () => {
  const r = montarPerguntas(
    briefing([{ solicitacao: "deixar o fundo azul", secao: "home\nbanner" }]),
  );
  assert.match(r.itens[0].texto, /seção home > banner/);
});
