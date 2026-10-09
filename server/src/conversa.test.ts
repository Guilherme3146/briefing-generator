import { test } from "node:test";
import assert from "node:assert/strict";
import { dividirFrases, extrair, lerTurnos } from "./conversa.js";

/**
 * Nada aqui chama IA nem rede: o motor é só regra. A conversa é inventada, no
 * formato que o Teams exporta ("Nome 0:04" numa linha, a fala nas seguintes).
 */
const CONVERSA = `Reunião de alinhamento
9 de outubro de 2026
Ana Souza começou a transcrição

Ana Souza 0:04
Bom dia, Carlos. Vamos ver o link temporário e anotar o que falta.

Carlos Lima 0:20
Bom dia. O telefone da empresa mudou, então precisa alterar isso no site
com urgência, senão a gente perde os orçamentos.

Ana Souza 0:41
Tranquilo.
Oh, I cable.

Carlos Lima 0:50
Eu fiz um documento com o resto dos itens e vou te encaminhar pelo WhatsApp.

Ana Souza 1:10
Ah, e o endereço já foi alterado hoje de manhã.

Carlos Lima 1:20
Então você consegue remover os vídeos antigos da home?

Ana Souza 1:40
Para o menu, pode ser que o mais simples seja separar por categorias, aí a gente confere com o time técnico.

Carlos Lima 2:00
Sim, então pode fazer assim.

Ana Souza 2:10
Quantos itens o menu aguenta? A gente vê com o time.

Carlos Lima 2:30
Eu perdi essa linha 2669 1631 e o resto ainda não foi feito.

Ana Souza 2:40
Para o suporte, precisa atualizar o logo e a imagem, o suporte resolve.
`;

test("separa as falas por quem falou, juntando as linhas quebradas", () => {
  const { turnos, formato } = lerTurnos(CONVERSA);
  assert.equal(formato, "teams");
  assert.equal(turnos[0].quem, "Ana Souza");
  assert.equal(turnos[0].tempo, "0:04");
  // a fala do Carlos tinha uma quebra de linha no meio da frase
  assert.match(turnos[1].texto, /alterar isso no site com urgência/);
  assert.ok(!turnos[1].texto.includes("\n"));
});

test("o cabeçalho e as marcas de início da transcrição não viram fala", () => {
  const { turnos } = lerTurnos(CONVERSA);
  assert.ok(turnos.every((t) => !/transcri/i.test(t.texto)));
  assert.ok(turnos.every((t) => !/Reunião de alinhamento/.test(t.texto)));
});

test("adivinha quem é o cliente pela linguagem da equipe", () => {
  const r = extrair(CONVERSA);
  const carlos = r.falantes.find((f) => f.nome === "Carlos Lima");
  const ana = r.falantes.find((f) => f.nome === "Ana Souza");
  assert.equal(carlos?.papel, "cliente");
  assert.equal(ana?.papel, "equipe");
});

test("dá para corrigir quem é o cliente", () => {
  const r = extrair(CONVERSA, { clientes: ["Ana Souza"] });
  assert.equal(r.falantes.find((f) => f.nome === "Ana Souza")?.papel, "cliente");
});

test("pedido do cliente (ação + elemento do site) vira tarefa", () => {
  const r = extrair(CONVERSA);
  const tel = r.tarefas.find((t) => t.assunto === "telefone");
  assert.ok(tel, "tarefa do telefone");
  assert.equal(tel!.confianca, "alta");
  assert.match(tel!.solicitacao, /telefone da empresa mudou/i);
  assert.equal(tel!.fontes[0].quem, "Carlos Lima");
});

test("pedido em forma de pergunta ('você consegue remover...') é tarefa, com confiança média", () => {
  const r = extrair(CONVERSA);
  const v = r.tarefas.find((t) => t.assunto === "vídeos");
  assert.ok(v, "tarefa dos vídeos");
  assert.equal(v!.confianca, "media");
});

test("o que já foi feito não vira tarefa, mas aparece como descartado", () => {
  const r = extrair(CONVERSA);
  assert.ok(!r.tarefas.some((t) => t.assunto === "endereço"));
  assert.ok(r.descartados.some((d) => d.motivo === "ja_resolvido" && /endere/i.test(d.trecho)));
});

test('"ainda não foi feito" NÃO conta como já resolvido', () => {
  const r = extrair(CONVERSA);
  assert.ok(!r.descartados.some((d) => d.motivo === "ja_resolvido" && /ainda não foi feito/i.test(d.trecho)));
});

test("sugestão da equipe só vira tarefa se o cliente concordar, e vem com dúvida de viabilidade", () => {
  const r = extrair(CONVERSA);
  const menu = r.tarefas.find((t) => t.assunto.startsWith("menu"));
  assert.ok(menu, "tarefa do menu");
  assert.equal(menu!.confianca, "media");
  assert.match(menu!.motivo, /Sim, então pode fazer assim/);
  assert.ok(menu!.duvidas.some((d) => /área técnica|viável/i.test(d)));
});

test("pergunta de capacidade não vira tarefa", () => {
  const r = extrair(CONVERSA);
  assert.ok(!r.tarefas.some((t) => /aguenta/.test(t.solicitacao)));
});

test("a equipe explicando o suporte não vira tarefa", () => {
  const r = extrair(CONVERSA);
  assert.ok(!r.tarefas.some((t) => t.assunto === "logo"));
});

test("ruído de transcrição em inglês some, sem virar tarefa nem lista", () => {
  const r = extrair(CONVERSA);
  assert.ok(r.resumo.ruido > 0);
  assert.ok(!r.descartados.some((d) => /cable/i.test(d.trecho)));
});

test("avisa quando o cliente cita um documento que será enviado por fora", () => {
  const r = extrair(CONVERSA);
  assert.equal(r.alertas.length, 1);
  assert.match(r.alertas[0], /documento/i);
});

test("telefone: se só aparece o número ANTIGO, pergunta o novo e cita o antigo", () => {
  const r = extrair(CONVERSA);
  const tel = r.tarefas.find((t) => t.assunto === "telefone")!;
  assert.ok(tel.duvidas.some((d) => /número novo/i.test(d) && /2669 1631/.test(d)));
});

test("cada trecho de origem aponta a posição certa no texto devolvido", () => {
  const r = extrair(CONVERSA);
  assert.ok(r.tarefas.length > 0);
  for (const t of r.tarefas) {
    for (const f of t.fontes) {
      assert.equal(r.texto.slice(f.inicio, f.inicio + f.trecho.length), f.trecho);
    }
  }
  for (const d of r.descartados) {
    assert.equal(r.texto.slice(d.inicio, d.inicio + d.trecho.length), d.trecho);
  }
});

test("divide frases sem perder a posição de cada uma", () => {
  const fala = "Primeira frase. Segunda? Terceira!";
  const frases = dividirFrases(fala);
  assert.deepEqual(frases.map((f) => f.texto), ["Primeira frase.", "Segunda?", "Terceira!"]);
  for (const f of frases) assert.equal(fala.slice(f.inicio, f.inicio + f.texto.length), f.texto);
});

test("lê legenda WebVTT, juntando falas seguidas do mesmo falante", () => {
  const vtt = `WEBVTT

00:00:04.000 --> 00:00:08.000
<v Carlos Lima>O telefone da empresa mudou,</v>

00:00:08.500 --> 00:00:12.000
<v Carlos Lima>precisa alterar isso no site.</v>

00:00:13.000 --> 00:00:15.000
<v Ana Souza>Claro, vamos anotar o link temporário.</v>
`;
  const { turnos, formato } = lerTurnos(vtt);
  assert.equal(formato, "vtt");
  assert.equal(turnos.length, 2);
  assert.equal(turnos[0].quem, "Carlos Lima");
  assert.match(turnos[0].texto, /mudou, precisa alterar/);
});

test("texto corrido (sem falantes) é lido como um falante só, o cliente", () => {
  const r = extrair("Preciso trocar o logo do site. Também quero remover o banner antigo da home.");
  assert.equal(r.formato, "texto");
  assert.equal(r.falantes.length, 1);
  assert.equal(r.falantes[0].papel, "cliente");
  assert.ok(r.tarefas.some((t) => t.assunto === "logo"));
});

test("defeito apontado sem verbo de ação ('o texto está errado') vira tarefa de confiança média, não some", () => {
  const r = extrair(`Ana Souza 0:04
Vamos revisar o link temporário com a produção.

Carlos Lima 0:20
O texto da home está errado e o menu está quebrado no celular.
`);
  const texto = r.tarefas.find((t) => t.assunto === "texto");
  assert.ok(texto, "tarefa do texto");
  assert.equal(texto!.confianca, "media");
  assert.match(texto!.motivo, /problema/i);
  assert.ok(r.tarefas.some((t) => t.assunto.startsWith("menu")));
});

test('"no celular" significa aparelho, não o telefone da empresa', () => {
  const r = extrair(`Ana Souza 0:04
Vamos olhar o link temporário com a produção.

Carlos Lima 0:20
O menu precisa ficar melhor no celular.
`);
  assert.ok(!r.tarefas.some((t) => t.assunto === "telefone"));
  assert.ok(r.tarefas.some((t) => t.assunto.startsWith("menu")));
});

test("frase com mais de dois elementos não perde o terceiro em silêncio: vira pergunta", () => {
  const r = extrair(`Ana Souza 0:04
Vamos olhar o link temporário com a produção.

Carlos Lima 0:20
Preciso trocar o logo, a imagem, o texto e o menu da home.
`);
  const t = r.tarefas.find((x) => x.assunto === "logo");
  assert.ok(t, "tarefa do logo");
  assert.ok(t!.duvidas.some((d) => /cita também/i.test(d)));
});

test("e-mail: itens de lista viram frases separadas e linhas cortadas se juntam", () => {
  const r = extrair(`Na página de máquinas:
- Remover essa máquina aqui da página /maquinas/prima
- Trocar o telefone para (11) 3456-7890 e colocar um ícone do
  WhatsApp do lado
fim
Obrigado!`);
  assert.equal(r.formato, "texto");
  // a linha cortada no meio da frase foi emendada
  assert.ok(r.texto.split("\n").some((l) => /ícone do WhatsApp do lado/.test(l)));
  // o item sem elemento conhecido NÃO some nem contamina o vizinho: vai para "de fora"
  assert.ok(r.descartados.some((d) => d.motivo === "sem_objeto" && /máquina/.test(d.trecho)));
  const tel = r.tarefas.find((x) => x.assunto === "telefone");
  assert.ok(tel && !/máquina/.test(tel.solicitacao));
  assert.ok(r.tarefas.some((x) => x.assunto.includes("WhatsApp")));
});

test("parece transcrição (muitos horários) mas sem 'Nome 0:04': avisa que leu tudo como um falante só", () => {
  const r = extrair(`00:04 preciso trocar o logo do site
00:20 e o telefone mudou, precisa alterar isso no site
00:41 tranquilo
01:10 vamos atualizar o menu
01:40 combinado, o menu também
02:05 obrigado`);
  assert.equal(r.formato, "texto");
  assert.ok(r.alertas.some((a) => /não reconheci o padrão de transcrição/i.test(a)));
});

test("e-mail comum (poucos horários) NÃO dispara o aviso de transcrição", () => {
  const r = extrair("Preciso trocar o logo do site. A reunião é às 14:30.");
  assert.ok(!r.alertas.some((a) => /padrão de transcrição/i.test(a)));
});

test("cliente que fala UMA vez só continua sendo o cliente (o palpite pesa palavras, não falas)", () => {
  const r = extrair(`Ana Souza 0:04
Vamos olhar o link temporário com a produção.

Carlos Lima 0:20
O telefone da empresa mudou, então precisa alterar isso no site com urgência.

Ana Souza 0:41
Tranquilo, vamos anotar.
`);
  assert.equal(r.falantes.find((f) => f.nome === "Carlos Lima")?.papel, "cliente");
  assert.ok(r.tarefas.some((t) => t.assunto === "telefone"), "o pedido dele precisa virar tarefa");
});

test("quem só solta uma interjeição ('Willian.') nunca é adivinhado como cliente", () => {
  const r = extrair(`Ana Souza 0:04
Vamos olhar o link temporário com a produção e a área técnica, e anotar tudo.

Willian 0:10
Oi.

Carlos Lima 0:20
O telefone da empresa mudou, então precisa alterar isso no site com urgência.

Ana Souza 0:41
Tranquilo, a gente vai anotar e falar com o suporte.
`);
  assert.equal(r.falantes.find((f) => f.nome === "Willian")?.papel, "equipe");
  assert.equal(r.falantes.find((f) => f.nome === "Carlos Lima")?.papel, "cliente");
});

test("entrada vazia não quebra", () => {
  const r = extrair("   ");
  assert.equal(r.tarefas.length, 0);
  assert.equal(r.falantes.length, 0);
});
