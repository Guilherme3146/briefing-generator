import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AbaAlteracoes from "./AbaAlteracoes";
import AbaConferencia from "./AbaConferencia";
import AbaIA from "./AbaIA";
import AbaPedido from "./AbaPedido";
import AbaPlanilha from "./AbaPlanilha";
import { useToast } from "./Toast";
import {
  contarAvisos,
  contarPendencias,
  hashRevisao,
  novaAlteracao,
  temConteudo,
  type Aba,
  type Achado,
  type Alteracao,
  type Briefing,
  type DescartadoConversa,
  type FonteAlteracao,
  type Importacao,
  type Inspecao,
  type ModoIA,
  type OrigemPedido,
  type ProvedorIA,
  type RespostaPerguntas,
  type RespostaRevisao,
  type RespostaSugestao,
  type Uso,
  type Veredito,
} from "./types";

const CHAVE = "briefing-rascunho-v1";
// chave propria, FORA do rascunho: nao deve ser apagada por "Limpar", nem
// viajar junto se o rascunho for exportado/importado por engano
const CHAVE_IA = "briefing-ia-chave-v1";
const PROVEDOR_IA = "briefing-ia-provedor-v1";

const VAZIO: Briefing = { cliente: "", url_base: "", alteracoes: [novaAlteracao(1)] };

/** A API responde JSON até no erro. Quando não responde assim, o motivo quase sempre é um destes. */
function explicarFalhaDaApi(status: number, corpo: string): string {
  if (status === 404) {
    return "O servidor não conhece esta operação: provavelmente está rodando uma versão antiga. Reinicie o servidor (npm run dev) e tente de novo.";
  }
  if (status === 0 || status === 502 || status === 503 || status === 504 || (status === 500 && !corpo.trim())) {
    return "A API não respondeu. Confira se o servidor está rodando (npm run dev) e tente de novo.";
  }
  return `O servidor respondeu com um erro inesperado (HTTP ${status}).`;
}

export default function App() {
  const { mostrar: toast } = useToast();

  const [briefing, setBriefing] = useState<Briefing>(() => {
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo) return JSON.parse(salvo) as Briefing;
    } catch {
      /* rascunho corrompido: comeca limpo */
    }
    return VAZIO;
  });
  const [pedido, setPedido] = useState(() => localStorage.getItem(CHAVE + "-pedido") ?? "");
  const [origem, setOrigem] = useState<OrigemPedido>(
    () => (localStorage.getItem(CHAVE + "-origem") as OrigemPedido) || "mensagem",
  );
  const [aba, setAba] = useState<Aba>(() =>
    briefing.alteracoes.some(temConteudo) ? "alteracoes" : "pedido",
  );
  const [selecionada, setSelecionada] = useState(1);

  const [prints, setPrints] = useState<Record<number, File[]>>({});
  const [achados, setAchados] = useState<Achado[]>([]);
  const [gerando, setGerando] = useState(false);
  const [sugerindo, setSugerindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [iaAtiva, setIaAtiva] = useState(false);
  const [iaModo, setIaModo] = useState<ModoIA>("desligada");
  const [provedorPadrao, setProvedorPadrao] = useState<ProvedorIA>("gemini");
  // a chave que o PROPRIO VISITANTE colou — so existe no navegador dele. So
  // importa (e so e enviada) quando iaModo === "proprio"; nos outros modos o
  // servidor ja resolve sozinho e esse campo fica sem uso.
  const [iaChave, setIaChave] = useState(() => localStorage.getItem(CHAVE_IA) ?? "");
  const [iaProvedorEscolhido, setIaProvedorEscolhido] = useState<ProvedorIA>(
    () => (localStorage.getItem(PROVEDOR_IA) as ProvedorIA | null) ?? "gemini",
  );
  const [ignorados, setIgnorados] = useState<string[]>([]);
  const [revertidas, setRevertidas] = useState<string[]>([]);
  const [uso, setUso] = useState<Uso | null>(null);

  const [cacheRevisao, setCacheRevisao] = useState<Record<string, Veredito>>({});
  const [revisando, setRevisando] = useState(false);
  const [perguntas, setPerguntas] = useState<RespostaPerguntas | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [planilha, setPlanilha] = useState<File | null>(null);
  const [inspecao, setInspecao] = useState<Inspecao | null>(null);
  const [inspecionando, setInspecionando] = useState(false);
  const [desatualizada, setDesatualizada] = useState(false);

  const [importacao, setImportacao] = useState<Importacao | null>(null);
  const [importando, setImportando] = useState(false);
  const [arquivoConversa, setArquivoConversa] = useState<File | null>(null);
  const [promovidos, setPromovidos] = useState<Set<number>>(new Set());
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);

  // A API pode cair sem a tela perceber (o app segue "utilizável"): confere de tempos em tempos
  // e avisa com uma faixa fixa, em vez de deixar cada operação falhar sem explicação.
  const [apiOnline, setApiOnline] = useState(true);
  const verificarApi = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const d = await r.json();
      setApiOnline(r.ok && d?.ok === true);
      setIaAtiva(Boolean(d?.ia?.ativa));
      setIaModo((d?.ia?.modo as ModoIA | undefined) ?? "desligada");
      if (d?.ia?.provedorPadrao) {
        setProvedorPadrao(d.ia.provedorPadrao as ProvedorIA);
        // so adota a dica do servidor se o visitante nunca escolheu nada aqui
        if (!localStorage.getItem(PROVEDOR_IA)) {
          setIaProvedorEscolhido(d.ia.provedorPadrao as ProvedorIA);
        }
      }
    } catch {
      setApiOnline(false);
    }
  }, []);

  // persistidos a parte do rascunho — ver o comentario em CHAVE_IA
  useEffect(() => {
    try {
      if (iaChave) localStorage.setItem(CHAVE_IA, iaChave);
      else localStorage.removeItem(CHAVE_IA);
    } catch {
      /* quota cheia ou storage bloqueado: a chave so vive nesta sessao */
    }
  }, [iaChave]);
  useEffect(() => {
    try {
      localStorage.setItem(PROVEDOR_IA, iaProvedorEscolhido);
    } catch {
      /* idem */
    }
  }, [iaProvedorEscolhido]);

  /**
   * Headers da chave do visitante — so vao quando o modo e "proprio". Nos
   * outros modos o servidor resolve tudo sozinho e mandar isto seria ignorado
   * (ver anthropic.ts: em modo "servidor" o header nunca e usado).
   */
  const headersIA = useCallback((): Record<string, string> => {
    if (iaModo !== "proprio" || !iaChave.trim()) return {};
    return { "X-IA-Chave": iaChave.trim(), "X-IA-Provedor": iaProvedorEscolhido };
  }, [iaModo, iaChave, iaProvedorEscolhido]);

  /** true quando um clique num botao de IA realmente dispara uma chamada. */
  const iaPronta = iaModo === "servidor" || (iaModo === "proprio" && iaChave.trim().length > 0);

  useEffect(() => {
    void verificarApi();
    const t = window.setInterval(() => void verificarApi(), 15_000);
    return () => window.clearInterval(t);
  }, [verificarApi]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(briefing));
      localStorage.setItem(CHAVE + "-pedido", pedido);
      localStorage.setItem(CHAVE + "-origem", origem);
    } catch {
      /* quota cheia: segue sem rascunho */
    }
  }, [briefing, pedido, origem]);

  const contagemPrints = useMemo(() => {
    const m: Record<number, number> = {};
    for (const [ordem, arquivos] of Object.entries(prints)) m[Number(ordem)] = arquivos.length;
    return m;
  }, [prints]);

  // lint no servidor (fonte da verdade), com debounce
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch("/api/revisar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefing, prints: contagemPrints }),
        });
        if (!r.ok) return;
        setAchados((await r.json()).achados ?? []);
      } catch {
        /* servidor fora do ar: a tela continua utilizavel */
      }
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [briefing, contagemPrints]);

  // a inspeção é uma foto do momento: se os cards mudaram, as duplicatas e a
  // contagem podem não valer mais
  const assinatura = briefing.alteracoes.map((a) => a.solicitacao).join("|");
  const assinaturaNaInspecao = useRef<string | null>(null);
  useEffect(() => {
    if (!inspecao) {
      assinaturaNaInspecao.current = null;
      return;
    }
    if (assinaturaNaInspecao.current === null) {
      assinaturaNaInspecao.current = assinatura;
      return;
    }
    if (assinaturaNaInspecao.current !== assinatura) setDesatualizada(true);
  }, [assinatura, inspecao]);

  // "Copiado ✓" some sozinho
  useEffect(() => {
    if (!copiado) return;
    const t = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(t);
  }, [copiado]);

  const atualizar = useCallback((ordem: number, campo: keyof Alteracao, valor: unknown) => {
    setBriefing((b) => ({
      ...b,
      alteracoes: b.alteracoes.map((a) =>
        a.ordem === ordem
          ? {
              ...a,
              [campo]: valor,
              // editar uma sugestão marca a procedência, mas não confirma por você
              origem: a.origem === "ia" ? "ia_editada" : a.origem === "regra" ? "regra_editada" : a.origem,
            }
          : a,
      ),
    }));
  }, []);

  const confirmar = useCallback(
    (ordem: number) => {
      setBriefing((b) => ({
        ...b,
        alteracoes: b.alteracoes.map((a) => (a.ordem === ordem ? { ...a, confirmado: true } : a)),
      }));
      toast(`Alteração ${ordem} confirmada`);
    },
    [toast],
  );

  function confirmarTodas() {
    let qtd = 0;
    setBriefing((b) => {
      qtd = b.alteracoes.filter((a) => !a.confirmado).length;
      return { ...b, alteracoes: b.alteracoes.map((a) => ({ ...a, confirmado: true })) };
    });
    toast(`${qtd} ${qtd === 1 ? "alteração confirmada" : "alterações confirmadas"}`);
  }

  /** Tira uma dúvida da IA da lista (já respondida ou não se aplica). */
  function resolverDuvida(ordem: number, texto: string) {
    setBriefing((b) => ({
      ...b,
      alteracoes: b.alteracoes.map((a) =>
        a.ordem === ordem ? { ...a, duvidas: a.duvidas.filter((d) => d.trim() !== texto.trim()) } : a,
      ),
    }));
  }

  function adicionar() {
    const proxima = Math.max(0, ...briefing.alteracoes.map((a) => a.ordem)) + 1;
    setBriefing((b) => ({
      ...b,
      alteracoes: [...b.alteracoes, novaAlteracao(proxima, b.url_base)],
    }));
    setSelecionada(proxima);
    setAba("alteracoes");
  }

  function remover(ordem: number) {
    const a = briefing.alteracoes.find((x) => x.ordem === ordem);
    if (a && temConteudo(a) && !confirm(`Remover a alteração ${ordem}?`)) return;

    const restantes = briefing.alteracoes.length - 1;
    setBriefing((b) => ({
      ...b,
      alteracoes: b.alteracoes.filter((x) => x.ordem !== ordem).map((x, i) => ({ ...x, ordem: i + 1 })),
    }));
    setPrints((p) => {
      // os prints seguem a renumeração: o que estava em N+1 passa a N
      const novo: Record<number, File[]> = {};
      for (const [k, v] of Object.entries(p)) {
        const n = Number(k);
        if (n === ordem) continue;
        novo[n > ordem ? n - 1 : n] = v;
      }
      return novo;
    });
    setSelecionada(Math.max(1, Math.min(ordem, restantes)));
  }

  function mover(ordem: number, direcao: -1 | 1) {
    const destino = ordem + direcao;
    if (destino < 1 || destino > briefing.alteracoes.length) return;
    setBriefing((b) => {
      const lista = [...b.alteracoes].sort((x, y) => x.ordem - y.ordem);
      const i = lista.findIndex((a) => a.ordem === ordem);
      const j = i + direcao;
      if (i < 0 || j < 0 || j >= lista.length) return b;
      [lista[i], lista[j]] = [lista[j], lista[i]];
      return { ...b, alteracoes: lista.map((a, k) => ({ ...a, ordem: k + 1 })) };
    });
    // os prints trocam de lugar junto com as alterações
    setPrints((p) => {
      const novo = { ...p };
      const a = p[ordem];
      const b = p[destino];
      if (a) novo[destino] = a;
      else delete novo[destino];
      if (b) novo[ordem] = b;
      else delete novo[ordem];
      return novo;
    });
    setSelecionada(destino);
  }

  /** Lê uma conversa (PDF/TXT/VTT do Teams) por regras, sem IA. */
  async function importar(arquivo: File, clientes?: string[]) {
    setImportando(true);
    setErroImportacao(null);
    setArquivoConversa(arquivo); // guardado já agora: é ele que o "Tentar de novo" reenvia
    const controle = new AbortController();
    const limite = window.setTimeout(() => controle.abort(), 90_000);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      if (clientes) form.append("clientes", JSON.stringify(clientes));
      const r = await fetch("/api/importar", { method: "POST", body: form, signal: controle.signal });

      // a API responde JSON até no erro; se não responder, o servidor é antigo ou está fora do ar
      const corpo = await r.text();
      let data: (Importacao & { erro?: string }) | null = null;
      try {
        data = JSON.parse(corpo);
      } catch {
        data = null;
      }
      if (!r.ok || !data) {
        setErroImportacao(data?.erro ?? explicarFalhaDaApi(r.status, corpo));
        if (r.status === 404 || r.status >= 500) void verificarApi();
        return;
      }
      if (
        typeof data.texto !== "string" ||
        !Array.isArray(data.tarefas) ||
        !Array.isArray(data.descartados) ||
        !Array.isArray(data.falantes)
      ) {
        setErroImportacao("A resposta do servidor veio incompleta. Reinicie o servidor (npm run dev) e tente de novo.");
        return;
      }
      setImportacao(data);
      setPromovidos(new Set());
      toast(
        `${data.tarefas.length} ${data.tarefas.length === 1 ? "tarefa encontrada" : "tarefas encontradas"} em "${arquivo.name}"`,
      );
      // o texto normalizado é a base dos destaques: sem ele os trechos não se acham
      if (
        !clientes &&
        (!pedido.trim() ||
          confirm(
            "Colocar o texto da conversa no campo \"Pedido do cliente\"? É ele que aparece ao lado das alterações, com os trechos destacados.",
          ))
      ) {
        setPedido(data.texto);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setErroImportacao(
          "A leitura demorou mais de 90 segundos e foi interrompida. Tente um arquivo menor ou exporte a conversa como TXT.",
        );
      } else {
        setErroImportacao("Não consegui falar com o servidor. Confira se ele está rodando (npm run dev) e tente de novo.");
        setApiOnline(false);
      }
    } finally {
      window.clearTimeout(limite);
      setImportando(false);
    }
  }

  /** Cards da conversa nascem NÃO confirmados: o analista confere cada um com o trecho original. */
  function criarCards(itens: { solicitacao: string; duvidas: string[]; fonte: FonteAlteracao }[]) {
    if (itens.length === 0) return;
    const vazio = briefing.alteracoes.length === 1 && !temConteudo(briefing.alteracoes[0]);
    const base = vazio ? [] : briefing.alteracoes;
    let ordem = Math.max(0, ...base.map((x) => x.ordem));
    const primeira = ordem + 1;
    const novas = itens.map((i) => ({
      ...novaAlteracao(++ordem, briefing.url_base),
      solicitacao: i.solicitacao,
      duvidas: i.duvidas,
      origem: "regra" as const,
      confirmado: false,
      fonte: i.fonte,
    }));
    setBriefing({ ...briefing, alteracoes: [...base, ...novas] });
    setSelecionada(primeira);
  }

  function adicionarTarefas(indices: number[]) {
    if (!importacao) return;
    criarCards(
      indices.map((i) => {
        const t = importacao.tarefas[i];
        return { solicitacao: t.solicitacao, duvidas: t.duvidas, fonte: { confianca: t.confianca, motivo: t.motivo, itens: t.fontes } };
      }),
    );
    setAba("alteracoes");
  }

  function promoverDescartado(d: DescartadoConversa) {
    criarCards([
      {
        solicitacao: d.trecho,
        duvidas: [],
        fonte: {
          confianca: "manual",
          motivo: "Você trouxe este trecho dos que o programa deixou de fora.",
          itens: [{ quem: d.quem, tempo: d.tempo, trecho: d.trecho, inicio: d.inicio }],
        },
      },
    ]);
    setPromovidos((s) => new Set(s).add(d.inicio));
  }

  function limpar() {
    if (!confirm("Apagar o rascunho e começar do zero?")) return;
    setImportacao(null);
    setErroImportacao(null);
    setArquivoConversa(null);
    setPromovidos(new Set());
    setBriefing(VAZIO);
    setPedido("");
    setPrints({});
    setIgnorados([]);
    setRevertidas([]);
    setUso(null);
    setPerguntas(null);
    setCacheRevisao({});
    setSelecionada(1);
    descartarPlanilha();
    setAba("pedido");
    toast("Tudo limpo — pronto para um novo briefing", "info");
  }

  async function sugerir() {
    if (!pedido.trim()) return;
    if (!iaPronta) {
      setErro("Cole sua chave de IA em Configurar IA antes de usar — fica só neste navegador.");
      return;
    }
    const preenchidas = briefing.alteracoes.filter(temConteudo).length;
    if (
      preenchidas > 0 &&
      !confirm(
        `Isso substitui as ${preenchidas} ${preenchidas === 1 ? "alteração preenchida" : "alterações preenchidas"} pelo rascunho da IA. Continuar?`,
      )
    ) {
      return;
    }

    setSugerindo(true);
    setErro(null);
    try {
      const r = await fetch("/api/sugerir", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersIA() },
        body: JSON.stringify({ texto: pedido, origem }),
      });
      const data = (await r.json()) as RespostaSugestao & { erro?: string };
      if (!r.ok) {
        setErro(data.erro ?? `Erro ${r.status}`);
        return;
      }
      if (data.alteracoes.length === 0) {
        setErro(
          origem === "reuniao"
            ? "A IA não encontrou nenhuma alteração decidida nessa transcrição."
            : "A IA não encontrou nenhuma alteração nesse texto.",
        );
        return;
      }
      setBriefing((b) => ({
        ...b,
        alteracoes: data.alteracoes.map((a) => ({ ...a, url_pagina: a.url_pagina || b.url_base })),
      }));
      setPrints({});
      setSelecionada(1);
      setIgnorados(data.trechos_ignorados ?? []);
      setRevertidas(data.decisoes_revertidas ?? []);
      setUso(data.uso ?? null);
      setCacheRevisao({});
      setPerguntas(null);
      toast(
        `${data.alteracoes.length} ${data.alteracoes.length === 1 ? "alteração sugerida" : "alterações sugeridas"} pela IA — confira antes de gerar`,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSugerindo(false);
    }
  }

  async function revisarIA() {
    if (!iaPronta) {
      setErro("Cole sua chave de IA em Configurar IA antes de usar — fica só neste navegador.");
      return;
    }
    const pendentes = briefing.alteracoes.filter(
      (a) => a.solicitacao.trim() && !cacheRevisao[hashRevisao(a)],
    );
    if (pendentes.length === 0) {
      setErro("Tudo que está na tela já foi revisado. Edite algo para revisar de novo.");
      return;
    }

    setRevisando(true);
    setErro(null);
    try {
      const r = await fetch("/api/revisar-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersIA() },
        body: JSON.stringify({ briefing: { ...briefing, alteracoes: pendentes } }),
      });
      const data = (await r.json()) as RespostaRevisao & { erro?: string };
      if (!r.ok) {
        setErro(data.erro ?? `Erro ${r.status}`);
        return;
      }
      const porOrdem = new Map(pendentes.map((a) => [a.ordem, a]));
      setCacheRevisao((c) => {
        const novo = { ...c };
        for (const v of data.vereditos) {
          const alt = porOrdem.get(v.ordem);
          if (alt) novo[hashRevisao(alt)] = v;
        }
        return novo;
      });
      setUso(data.uso ?? null);
      if (data.faltantes?.length) {
        setErro(
          `A IA não devolveu veredito para ${data.faltantes.length} alteração(ões). Revise de novo se quiser.`,
        );
      } else {
        const reprovadas = data.vereditos.filter((v) => !v.executavel).length;
        toast(
          reprovadas > 0
            ? `Revisão concluída — ${reprovadas} ${reprovadas === 1 ? "alteração travaria" : "alterações travariam"} a produção`
            : "Revisão concluída — tudo executável",
        );
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setRevisando(false);
    }
  }

  async function montarPerguntas() {
    setErro(null);
    try {
      const vereditos = briefing.alteracoes
        .map((a) => {
          const v = cacheRevisao[hashRevisao(a)];
          return v ? { ...v, ordem: a.ordem } : null;
        })
        .filter(Boolean);

      const r = await fetch("/api/perguntas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefing, vereditos, prints: contagemPrints }),
      });
      const data = (await r.json()) as RespostaPerguntas & { erro?: string };
      if (!r.ok) {
        setErro(data.erro ?? `Erro ${r.status}`);
        return;
      }
      setPerguntas(data);
      setCopiado(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function copiarPerguntas() {
    if (!perguntas?.texto) return;
    try {
      await navigator.clipboard.writeText(perguntas.texto);
      setCopiado(true);
      toast("Perguntas copiadas");
    } catch {
      toast("Não consegui copiar automaticamente — selecione o texto na tela e copie à mão", "erro");
    }
  }

  async function inspecionar(arquivo: File) {
    setInspecionando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("planilha", arquivo);
      form.append("briefing", JSON.stringify(briefing));
      const r = await fetch("/api/inspecionar", { method: "POST", body: form });
      const data = (await r.json()) as Inspecao & { erro?: string };
      if (!r.ok) {
        setErro(data.erro ?? `Erro ${r.status}`);
        setPlanilha(null);
        setInspecao(null);
        return;
      }
      setPlanilha(arquivo);
      setInspecao(data);
      setDesatualizada(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setInspecionando(false);
    }
  }

  function descartarPlanilha() {
    setPlanilha(null);
    setInspecao(null);
    setDesatualizada(false);
  }

  function baixar(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportar() {
    setGerando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("briefing", JSON.stringify(briefing));
      for (const [ordem, arquivos] of Object.entries(prints)) {
        for (const arquivo of arquivos) form.append(`print_${ordem}`, arquivo);
      }
      if (planilha) form.append("planilha", planilha);

      const r = await fetch(planilha ? "/api/acrescentar" : "/api/gerar", {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({ erro: `Erro ${r.status}` }));
        const msg = data.erro ?? `Erro ${r.status}`;
        setErro(msg);
        toast(msg, "erro");
        return;
      }
      const nome = r.headers.get("X-Nome-Arquivo") ?? planilha?.name ?? "briefing.xlsx";
      baixar(await r.blob(), nome);
      toast(`${planilha ? "Planilha atualizada" : "Planilha gerada"}: ${nome}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg);
      toast(msg, "erro");
    } finally {
      setGerando(false);
    }
  }

  // ------------------------------------------------------------------ derivados

  // `erros` inclui o rascunho da IA sem confirmar (é ele que trava a geração);
  // `pendencias` é só o que o analista precisa corrigir, sem contar duas vezes
  // o que já aparece em "a confirmar".
  const erros = achados.filter((a) => a.severidade === "erro");
  const pendencias = erros.filter((a) => a.regra !== "NAO_CONFIRMADO");
  const avisos = achados.filter((a) => a.severidade === "aviso");
  // contagem por ALTERAÇÃO, não por regra: uma linha sem "onde" e sem "o que
  // fazer" ao mesmo tempo dispara 2 achados de erro mas é 1 linha quebrada só
  // na lista "O que falta resolver" — contar achados.length mostraria 9 onde
  // só existem 8 alterações com problema.
  const qtdPendencias = contarPendencias(achados);
  const qtdAvisos = contarAvisos(achados);
  const naoConfirmadas = briefing.alteracoes.filter((a) => !a.confirmado).length;
  const ordenadas = [...briefing.alteracoes].sort((a, b) => a.ordem - b.ordem);
  const vereditoDe = (a: Alteracao): Veredito | undefined => cacheRevisao[hashRevisao(a)];
  const aRevisar = briefing.alteracoes.filter((a) => a.solicitacao.trim() && !vereditoDe(a)).length;
  const semCapacidade = Boolean(inspecao && briefing.alteracoes.length > inspecao.capacidadeRestante);
  const bloqueado = erros.length > 0 || briefing.alteracoes.length === 0 || semCapacidade;

  // a aba da IA só existe com a IA ligada; se ela sumir, não deixa a tela vazia
  const abaAtiva: Aba = aba === "ia" && !iaAtiva ? "pedido" : aba;

  function abrirAlteracao(ordem: number) {
    setSelecionada(ordem);
    setAba("alteracoes");
  }

  function irParaPrimeiroProblema() {
    const alvo = pendencias[0]?.ordem ?? briefing.alteracoes.find((a) => !a.confirmado)?.ordem;
    if (alvo) abrirAlteracao(alvo);
  }

  const abas: { id: Aba; rotulo: string; contagem?: number; alerta?: boolean }[] = [
    { id: "pedido", rotulo: "Pedido" },
    { id: "alteracoes", rotulo: "Alterações", contagem: ordenadas.length },
    {
      id: "conferencia",
      rotulo: "Conferência",
      contagem: qtdPendencias + qtdAvisos,
      alerta: qtdPendencias > 0,
    },
    { id: "planilha", rotulo: "Planilha" },
  ];

  return (
    <div className="app">
      {!apiOnline && (
        <div className="api-fora" role="alert">
          <div>
            <strong>O servidor (API) não está respondendo.</strong>
            <span>
              Importar conversa, as checagens e gerar a planilha dependem dele. Se você usa{" "}
              <code>npm run dev</code>, olhe o terminal: o servidor pode ter caído. Reinicie com{" "}
              <code>npm run dev</code>.
            </span>
          </div>
          <button onClick={() => void verificarApi()}>Tentar de novo</button>
        </div>
      )}

      <header className="topo">
        <div className="topo-esq">
          <div className="logo" aria-hidden="true">B</div>
          <div>
            <h1>Gerador de Briefing</h1>
            <p className="sub">
              {briefing.cliente.trim() || "sem cliente definido"}
              {" · "}
              {ordenadas.length} {ordenadas.length === 1 ? "alteração" : "alterações"}
            </p>
          </div>
        </div>

        <div className="topo-dir">
          <div className="indicadores">
            <Indicador
              valor={qtdPendencias}
              rotulo={qtdPendencias === 1 ? "pendência" : "pendências"}
              tom={qtdPendencias ? "erro" : "ok"}
              onClick={qtdPendencias ? irParaPrimeiroProblema : undefined}
            />
            <Indicador valor={qtdAvisos} rotulo="avisos" tom={qtdAvisos ? "aviso" : "neutro"} />
            {naoConfirmadas > 0 && (
              <Indicador valor={naoConfirmadas} rotulo="a confirmar" tom="ia" />
            )}
          </div>
          {(pedido.trim() || briefing.cliente.trim() || ordenadas.some(temConteudo) || importacao) && (
            <button
              className="icone perigo"
              onClick={limpar}
              title="Apaga o rascunho inteiro (pedido, alterações e conversa importada) para começar outro briefing do zero"
            >
              Novo briefing
            </button>
          )}
          {naoConfirmadas > 1 && (
            <button className="secundario" onClick={confirmarTodas}>
              Confirmar todas
            </button>
          )}
          <button
            className={`primario ${bloqueado ? "pendente" : ""}`}
            onClick={bloqueado ? () => setAba("planilha") : exportar}
            disabled={gerando}
            title={bloqueado ? "Faltam itens — clique para ver o que falta" : undefined}
          >
            {gerando ? "Gerando…" : planilha ? "Acrescentar na planilha" : "Gerar planilha"}
          </button>
        </div>
      </header>

      <nav className="abas" role="tablist" aria-label="Etapas do briefing">
        {abas.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={abaAtiva === t.id}
            className={`aba ${abaAtiva === t.id ? "ativa" : ""}`}
            onClick={() => setAba(t.id)}
          >
            <span className="aba-num">{i + 1}</span>
            {t.rotulo}
            {t.contagem !== undefined && t.contagem > 0 && (
              <span className={`aba-badge ${t.alerta ? "alerta" : ""}`}>{t.contagem}</span>
            )}
          </button>
        ))}
        {iaAtiva && (
          <button
            role="tab"
            aria-selected={abaAtiva === "ia"}
            className={`aba ia ${abaAtiva === "ia" ? "ativa" : ""}`}
            onClick={() => setAba("ia")}
          >
            IA
            <span className="aba-tag">opcional</span>
          </button>
        )}
      </nav>

      {erro && (
        <div className="erro-geral" role="alert">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} title="Fechar" aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <main className="conteudo">
        {abaAtiva === "pedido" && (
          <AbaPedido
            briefing={briefing}
            pedido={pedido}
            iaAtiva={iaAtiva}
            onBriefing={setBriefing}
            onPedido={setPedido}
            onComecar={() => setAba("alteracoes")}
            onIrParaIA={() => setAba("ia")}
            onLimpar={limpar}
            conversa={{
              importacao,
              importando,
              erro: erroImportacao,
              arquivoNome: arquivoConversa?.name ?? null,
              onTentarDeNovo: () => arquivoConversa && void importar(arquivoConversa),
              promovidos,
              onArquivo: (f) => void importar(f),
              onReprocessar: (clientes) => arquivoConversa && void importar(arquivoConversa, clientes),
              onAdicionar: adicionarTarefas,
              onPromover: promoverDescartado,
            }}
          />
        )}

        {abaAtiva === "alteracoes" &&
          (ordenadas.length === 0 ? (
            <div className="pagina estreita">
              <div className="painel vazio-grande">
                <p>Não há nenhuma alteração.</p>
                <button className="primario" onClick={adicionar}>
                  + Adicionar alteração
                </button>
              </div>
            </div>
          ) : (
            <AbaAlteracoes
              alteracoes={ordenadas}
              selecionada={selecionada}
              achados={achados}
              vereditoDe={vereditoDe}
              prints={prints}
              pedido={pedido}
              onSelecionar={setSelecionada}
              onCampo={atualizar}
              onConfirmar={confirmar}
              onPrints={(ordem, arquivos) =>
                setPrints((p) => ({ ...p, [ordem]: [...(p[ordem] ?? []), ...arquivos] }))
              }
              onRemoverPrint={(ordem, i) =>
                setPrints((p) => ({ ...p, [ordem]: (p[ordem] ?? []).filter((_, k) => k !== i) }))
              }
              onRemover={remover}
              onMover={mover}
              onAdicionar={adicionar}
              onResolverDuvida={resolverDuvida}
              onIrParaPedido={() => setAba("pedido")}
            />
          ))}

        {abaAtiva === "conferencia" && (
          <AbaConferencia
            alteracoes={ordenadas}
            achados={achados}
            vereditoDe={vereditoDe}
            perguntas={perguntas}
            copiado={copiado}
            onMontar={montarPerguntas}
            onCopiar={copiarPerguntas}
            onTextoPerguntas={(texto) => setPerguntas((p) => (p ? { ...p, texto } : p))}
            onAbrir={abrirAlteracao}
          />
        )}

        {abaAtiva === "planilha" && (
          <AbaPlanilha
            quantidade={briefing.alteracoes.length}
            pendencias={qtdPendencias}
            avisos={qtdAvisos}
            naoConfirmadas={naoConfirmadas}
            planilha={planilha}
            inspecao={inspecao}
            inspecionando={inspecionando}
            desatualizada={desatualizada}
            semCapacidade={semCapacidade}
            bloqueado={bloqueado}
            gerando={gerando}
            onEscolher={(f) => void inspecionar(f)}
            onDescartar={descartarPlanilha}
            onReconferir={() => planilha && void inspecionar(planilha)}
            onGerar={exportar}
            onIrParaProblema={irParaPrimeiroProblema}
          />
        )}

        {abaAtiva === "ia" && iaAtiva && (
          <AbaIA
            pedido={pedido}
            origem={origem}
            sugerindo={sugerindo}
            revisando={revisando}
            aRevisar={aRevisar}
            totalAlteracoes={briefing.alteracoes.length}
            naoConfirmadas={naoConfirmadas}
            ignorados={ignorados}
            revertidas={revertidas}
            uso={uso}
            onOrigem={setOrigem}
            onSugerir={sugerir}
            onRevisar={revisarIA}
            onVerAlteracoes={() => abrirAlteracao(1)}
            onIrParaPedido={() => setAba("pedido")}
            modo={iaModo}
            pronta={iaPronta}
            chave={iaChave}
            onChave={setIaChave}
            provedor={iaProvedorEscolhido}
            provedorSugerido={provedorPadrao}
            onProvedor={setIaProvedorEscolhido}
          />
        )}
      </main>

      <footer className="rodape">
        <strong>Gerador de Briefing</strong>
        <span>O rascunho fica salvo neste navegador. A IA só sugere; quem confirma é você.</span>
      </footer>
    </div>
  );
}

function Indicador({
  valor,
  rotulo,
  tom,
  onClick,
}: {
  valor: number;
  rotulo: string;
  tom: "ok" | "erro" | "aviso" | "ia" | "neutro";
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      <strong>{valor}</strong>
      <span>{rotulo}</span>
    </>
  );
  return onClick ? (
    <button className={`indicador ${tom} clicavel`} onClick={onClick}>
      {conteudo}
    </button>
  ) : (
    <div className={`indicador ${tom}`}>{conteudo}</div>
  );
}
