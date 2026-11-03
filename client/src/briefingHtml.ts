import type { Alteracao, Estimativa } from "./types";

/**
 * Briefing "de leitura": um .html único (CSS e prints embutidos), sem servidor e
 * sem edição. É uma FOTO datada do briefing: se entrar mais alteração depois,
 * gera-se outra versão (outra rodada), e fica visível o que cresceu.
 */

export type OpcoesHtml = {
  cliente: string;
  urlBase: string;
  alteracoes: Alteracao[];
  /** ordem da alteração -> prints já em data URI */
  prints: Record<number, string[]>;
  estimativas: Record<number, Estimativa>;
  rodada: number;
  comHoras: boolean;
  geradoEm: Date;
};

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** só http(s) vira link clicável: nunca javascript: ou data: */
function linkSeguro(url: string): string {
  const u = url.trim();
  return /^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u);
}

const dataBR = (d: Date) =>
  `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

export function nomeDoHtml(cliente: string, rodada: number, d: Date): string {
  const slug =
    cliente
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "cliente";
  return `briefing-${slug}-rodada-${rodada}-${d.toISOString().slice(0, 10)}.html`;
}

function campo(rotulo: string, html: string): string {
  return html ? `<div class="campo"><span class="rot">${rotulo}</span><div>${html}</div></div>` : "";
}

export function montarBriefingHtml(o: OpcoesHtml): string {
  const ordenadas = [...o.alteracoes].sort((a, b) => a.ordem - b.ordem);
  const totalHoras = ordenadas.reduce((s, a) => s + (o.estimativas[a.ordem]?.horas ?? 0), 0);

  let grupoAtual = "";
  const cartoes = ordenadas
    .map((a) => {
      const grupo = a.grupo.trim();
      const cabecalhoGrupo = grupo && grupo !== grupoAtual ? `<h2 class="grupo">${esc(grupo)}</h2>` : "";
      grupoAtual = grupo;

      const links = a.link_conteudo.map((l) => l.trim()).filter(Boolean).map((l) => `<div>${linkSeguro(l)}</div>`).join("");
      const imgs = (o.prints[a.ordem] ?? [])
        .map((src) => `<img src="${src}" alt="Print da alteração ${a.ordem}" />`)
        .join("");
      const est = o.comHoras ? o.estimativas[a.ordem] : undefined;

      return `${cabecalhoGrupo}
<article class="cartao">
  <header><span class="num">${a.ordem}</span>${est ? `<span class="est">~${est.horas}h · nível ${est.nivel}</span>` : ""}</header>
  <p class="fazer">${esc(a.solicitacao.trim())}</p>
  ${campo("Página", a.url_pagina.trim() ? linkSeguro(a.url_pagina) : "")}
  ${campo("Seção", esc(a.secao.trim()).replace(/\n/g, " › "))}
  ${campo("Links do conteúdo", links)}
  ${campo("Observações para a implementação", esc(a.obs_implementacao.trim()).replace(/\n/g, "<br>"))}
  ${campo("Observações de produção", esc(a.obs_producao.trim()).replace(/\n/g, "<br>"))}
  ${imgs ? `<div class="prints">${imgs}</div>` : ""}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Briefing — ${esc(o.cliente || "Cliente")} — rodada ${o.rodada}</title>
<style>
  :root { color-scheme: light; --tinta:#183153; --suave:#5b6b8c; --linha:#dbe3f2; --fundo:#f4f6fb; --azul:#1f6feb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fundo); color:var(--tinta); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 28px 18px 60px; }
  .topo { background:#fff; border:1px solid var(--linha); border-radius:14px; padding:22px 24px; margin-bottom:22px; }
  .topo h1 { margin:0 0 4px; font-size:1.6rem; }
  .topo .sub { color:var(--suave); margin:0; }
  .resumo { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
  .pilula { background:var(--fundo); border:1px solid var(--linha); border-radius:999px; padding:4px 14px; font-weight:700; font-size:.9rem; }
  .aviso { margin-top:16px; background:#fff8e1; border:1px solid #f3dc8a; border-radius:10px; padding:10px 14px; font-size:.9rem; }
  h2.grupo { margin:30px 0 10px; font-size:1.05rem; text-transform:uppercase; letter-spacing:.04em; color:var(--suave); }
  .cartao { background:#fff; border:1px solid var(--linha); border-radius:14px; padding:18px 22px; margin-bottom:14px; break-inside:avoid; }
  .cartao header { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .num { background:var(--tinta); color:#fff; border-radius:8px; min-width:30px; text-align:center; padding:2px 8px; font-weight:800; }
  .est { color:var(--suave); font-size:.85rem; font-weight:700; }
  .fazer { margin:0 0 10px; font-size:1.08rem; font-weight:700; white-space:pre-wrap; }
  .campo { display:grid; grid-template-columns:190px 1fr; gap:10px; padding:6px 0; border-top:1px solid var(--linha); font-size:.93rem; }
  .rot { color:var(--suave); font-weight:700; }
  a { color:var(--azul); word-break:break-all; }
  .prints { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; }
  .prints img { max-width:100%; max-height:340px; border:1px solid var(--linha); border-radius:8px; }
  footer { color:var(--suave); font-size:.85rem; margin-top:30px; text-align:center; }
  @media (max-width:600px) { .campo { grid-template-columns:1fr; gap:2px; } }
  @media print { body { background:#fff; } main { padding:0; } .topo,.cartao { border-color:#bbb; } }
</style>
</head>
<body>
<main>
  <section class="topo">
    <h1>${esc(o.cliente || "Briefing")}</h1>
    <p class="sub">${o.urlBase.trim() ? linkSeguro(o.urlBase) + " · " : ""}Rodada ${o.rodada} · versão gerada em ${dataBR(o.geradoEm)}</p>
    <div class="resumo">
      <span class="pilula">${ordenadas.length} ${ordenadas.length === 1 ? "alteração" : "alterações"}</span>
      ${o.comHoras ? `<span class="pilula">Estimativa ~${totalHoras}h</span>` : ""}
    </div>
    ${o.comHoras ? `<div class="aviso">As horas são uma <strong>estimativa</strong> por tipo de tarefa, não um prazo nem um compromisso.</div>` : ""}
  </section>
${cartoes}
  <footer>Documento de leitura gerado pelo EasyBriefing — não editável. Qualquer alteração nova gera outra versão (rodada).</footer>
</main>
</body>
</html>
`;
}
