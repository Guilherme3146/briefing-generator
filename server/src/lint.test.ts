import { test } from "node:test";
import assert from "node:assert/strict";
import { lintAlteracao, type Contexto } from "./lint.js";
import { AlteracaoSchema, type Alteracao } from "./schema.js";

/**
 * Os casos abaixo sao textos REAIS das planilhas da Amorim Letreiros,
 * Brasil Vending e IMUNUTEK. Os que comecam com "nao acusa" existem para
 * travar falso positivo — foram medidos e corrigidos.
 */

const SEM_PRINT: Contexto = { prints: 0 };

/** passa pelo schema real para herdar os defaults (origem, confirmado, duvidas) */
function alt(p: Partial<Alteracao>): Alteracao {
  return AlteracaoSchema.parse({
    ordem: 1,
    solicitacao: "",
    url_pagina: "https://exemplo.com.br/",
    secao: "home",
    ...p,
  });
}

const regras = (a: Alteracao, c = SEM_PRINT) => lintAlteracao(a, c).map((x) => x.regra);

// ---------------------------------------------------------------- obrigatorios

test("sem descricao e erro", () => {
  assert.ok(regras(alt({ solicitacao: "" })).includes("O_QUE_FAZER_AUSENTE"));
});

test("sem URL da pagina e erro", () => {
  const r = regras(alt({ solicitacao: "trocar o banner", url_pagina: "" }));
  assert.ok(r.includes("ONDE_AUSENTE"));
});

test("sem secao e so aviso", () => {
  const achados = lintAlteracao(
    alt({ solicitacao: "trocar o banner", secao: "" }),
    SEM_PRINT,
  );
  const secao = achados.find((a) => a.regra === "SECAO_AUSENTE");
  assert.equal(secao?.severidade, "aviso");
});

// ------------------------------------------------------------ referencia vaga

test("'remover essa maquina' é pego — passa por toda regra estrutural", () => {
  // Brasil Vending, linha 11: nenhuma coluna vazia, e inexecutavel.
  const r = regras(
    alt({
      solicitacao: "remover essa máquina",
      url_pagina: "https://www.producao.mpitemporario.com.br/brasilvending.com.br/maquinas/prima",
      secao: "prima",
    }),
  );
  assert.ok(r.includes("REFERENCIA_VAGA"));
});

test("referencia vaga nao acusa quando ha print anexado", () => {
  const r = regras(
    alt({ solicitacao: "remover essa máquina" }),
    { prints: 1 },
  );
  assert.ok(!r.includes("REFERENCIA_VAGA"));
});

// ------------------------------------------------------------------- imagens

test("pedir imagem sem link nem print acusa", () => {
  const r = regras(alt({ solicitacao: "inserir o logo da latam em clientes" }));
  assert.ok(r.includes("IMAGEM_SEM_FONTE"));
});

test("pedir imagem com Link Conteudo nao acusa", () => {
  const r = regras(
    alt({
      solicitacao: "inserir o logo da latam em clientes",
      link_conteudo: ["https://drive.google.com/file/d/abc/view"],
    }),
  );
  assert.ok(!r.includes("IMAGEM_SEM_FONTE"));
});

test("nao acusa imagem quando o pedido e de tamanho", () => {
  // Brasil Vending, linha 3 — falso positivo medido na primeira versao
  const r = regras(alt({ solicitacao: "deixar o logo na header com largura de 122px" }));
  assert.ok(!r.includes("IMAGEM_SEM_FONTE"));
});

// ---------------------------------------------------------------------- cores

test("cor sem hex acusa", () => {
  const r = regras(alt({ solicitacao: "deixar o fundo do rodapé azul" }));
  assert.ok(r.includes("COR_SEM_HEX"));
});

test("cor com hex nao acusa", () => {
  // Amorim, linha 25 — o jeito certo, conforme FAQ A13
  const r = regras(
    alt({
      solicitacao:
        "substituir a imagem do cta por um degradê azul e laranja, as mesmas cores do logo\n\nazul - #0d215c\nlaranja - #f38323",
      link_conteudo: ["https://exemplo/x"],
    }),
  );
  assert.ok(!r.includes("COR_SEM_HEX"));
});

// --------------------------------------------------------------------- fontes

test("nao acusa fonte quando a frase fala de cor", () => {
  // Amorim, linha 27 — falso positivo medido na primeira versao
  const r = regras(
    alt({
      solicitacao:
        "deixar o fundo do rodapé claro (#edf0fc) para dar destaque ao logo, com atenção à fonte que deve ficar escura para criar contraste",
      link_conteudo: ["https://exemplo/x"],
    }),
  );
  assert.ok(!r.includes("FONTE_SEM_NOME"));
});

test("troca de fonte sem nome acusa", () => {
  const r = regras(alt({ solicitacao: "trocar a fonte do site inteiro" }));
  assert.ok(r.includes("FONTE_SEM_NOME"));
});

test("troca de fonte citando Google Fonts nao acusa", () => {
  const r = regras(alt({ solicitacao: "trocar a fonte para Poppins, do Google Fonts" }));
  assert.ok(!r.includes("FONTE_SEM_NOME"));
});

// ---------------------------------------------------------------------- texto

test("pedir troca de texto sem o texto novo acusa", () => {
  const r = regras(alt({ solicitacao: "o texto da home está errado, corrigir" }));
  assert.ok(r.includes("TEXTO_SEM_DESTINO"));
});

test("texto novo entre aspas nao acusa", () => {
  // Amorim, linha 8 — traz o paragrafo final entre aspas
  const r = regras(
    alt({
      solicitacao:
        'o segundo parágrafo deverá ser reconstruído para:\n"Fomos crescendo e expandindo nosso leque de serviços..."',
    }),
  );
  assert.ok(!r.includes("TEXTO_SEM_DESTINO"));
});

// --------------------------------------------------------------------- prints

test("citar print sem anexar acusa", () => {
  const r = regras(
    alt({ solicitacao: "remover o trecho que deixei circulado no print em obs implementação" }),
  );
  assert.ok(r.includes("PRINT_CITADO_SEM_ANEXO"));
});

test("citar print com anexo nao acusa", () => {
  const r = regras(
    alt({ solicitacao: "remover o trecho que deixei circulado no print" }),
    { prints: 1 },
  );
  assert.ok(!r.includes("PRINT_CITADO_SEM_ANEXO"));
});
