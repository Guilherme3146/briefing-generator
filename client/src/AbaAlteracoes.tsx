import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "./Editor";
import {
  ROTULO_SITUACAO,
  situacaoDe,
  type Achado,
  type Alteracao,
  type FonteTrecho,
  type Veredito,
} from "./types";

type Props = {
  alteracoes: Alteracao[];
  selecionada: number;
  achados: Achado[];
  vereditoDe: (a: Alteracao) => Veredito | undefined;
  prints: Record<number, File[]>;
  pedido: string;
  onSelecionar: (ordem: number) => void;
  onCampo: (ordem: number, campo: keyof Alteracao, valor: unknown) => void;
  onConfirmar: (ordem: number) => void;
  onPrints: (ordem: number, arquivos: File[]) => void;
  onRemoverPrint: (ordem: number, indice: number) => void;
  onRemover: (ordem: number) => void;
  onMover: (ordem: number, direcao: -1 | 1) => void;
  onAdicionar: () => void;
  onResolverDuvida: (ordem: number, texto: string) => void;
  onIrParaPedido: () => void;
};

/**
 * Lista compacta à esquerda, editor da alteração selecionada no centro e o
 * pedido original à direita — para responder sem alternar de tela.
 */
export default function AbaAlteracoes(p: Props) {
  const [verPedido, setVerPedido] = useState(
    () => p.pedido.trim().length > 0 && window.innerWidth >= 1280,
  );

  const indice = Math.max(
    0,
    p.alteracoes.findIndex((a) => a.ordem === p.selecionada),
  );
  const atual = p.alteracoes[indice];
  const anterior = p.alteracoes[indice - 1];
  const proxima = p.alteracoes[indice + 1];

  if (!atual) return null;

  const temIA = p.alteracoes.some((a) => a.origem.startsWith("ia"));
  const temRegra = p.alteracoes.some((a) => a.origem.startsWith("regra"));

  return (
    <div className={`alteracoes ${verPedido ? "com-pedido" : ""}`}>
      <nav className="lista-alteracoes" aria-label="Alterações">
        <div className="lista-topo">
          <h3>Alterações</h3>
          <button className="mini primario" onClick={p.onAdicionar}>
            + Nova
          </button>
        </div>

        <ol>
          {p.alteracoes.map((a, i) => {
            const achadosDela = p.achados.filter((x) => x.ordem === a.ordem);
            const sit = situacaoDe(a, achadosDela, p.vereditoDe(a));
            const novoGrupo = a.grupo.trim() && a.grupo !== p.alteracoes[i - 1]?.grupo;
            return (
              <li key={a.ordem}>
                {novoGrupo && <div className="grupo-rotulo">{a.grupo}</div>}
                <button
                  className={`item ${a.ordem === atual.ordem ? "ativo" : ""} ${a.grupo.trim() ? "agrupada" : ""}`}
                  onClick={() => p.onSelecionar(a.ordem)}
                  aria-current={a.ordem === atual.ordem}
                >
                  <span
                    className={`bolinha ${sit === "rascunho" && a.origem.startsWith("regra") ? "rascunho-regra" : sit}`}
                    title={ROTULO_SITUACAO[sit]}
                  />
                  <span className="item-num">{a.ordem}</span>
                  <span className="item-texto">
                    {a.solicitacao.trim() || <em>sem descrição</em>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="legenda" aria-hidden="true">
          <span><i className="bolinha ok" /> pronta</span>
          <span><i className="bolinha aviso" /> aviso</span>
          <span><i className="bolinha erro" /> pendência</span>
          {temIA && (
            <span>
              <i className="bolinha rascunho" /> rascunho da IA
            </span>
          )}
          {temRegra && (
            <span>
              <i className="bolinha rascunho-regra" /> lido da conversa
            </span>
          )}
          {!temIA && !temRegra && (
            <span>
              <i className="bolinha rascunho" /> rascunho
            </span>
          )}
        </div>
      </nav>

      <Editor
        key={atual.ordem}
        alteracao={atual}
        posicao={indice + 1}
        total={p.alteracoes.length}
        achados={p.achados.filter((x) => x.ordem === atual.ordem)}
        veredito={p.vereditoDe(atual)}
        prints={p.prints[atual.ordem] ?? []}
        onCampo={p.onCampo}
        onConfirmar={(irParaProxima) => {
          p.onConfirmar(atual.ordem);
          if (irParaProxima && proxima) p.onSelecionar(proxima.ordem);
        }}
        onPrints={(arquivos) => p.onPrints(atual.ordem, arquivos)}
        onRemoverPrint={(i) => p.onRemoverPrint(atual.ordem, i)}
        onRemover={() => p.onRemover(atual.ordem)}
        onMover={(d) => p.onMover(atual.ordem, d)}
        onResolverDuvida={(texto) => p.onResolverDuvida(atual.ordem, texto)}
        onAnterior={anterior ? () => p.onSelecionar(anterior.ordem) : undefined}
        onProxima={proxima ? () => p.onSelecionar(proxima.ordem) : undefined}
      />

      <aside className="referencia" aria-label="Pedido do cliente">
        {verPedido ? (
          <>
            <div className="ref-topo">
              <h3>Pedido do cliente</h3>
              <button className="mini" onClick={() => setVerPedido(false)}>
                Ocultar
              </button>
            </div>
            {p.pedido.trim() ? (
              <TextoComDestaques texto={p.pedido} itens={atual.fonte?.itens ?? []} />
            ) : (
              <div className="vazio">
                <p>Ainda não há pedido colado.</p>
                <button className="secundario" onClick={p.onIrParaPedido}>
                  Colar o pedido
                </button>
              </div>
            )}
          </>
        ) : (
          <button className="ref-abrir" onClick={() => setVerPedido(true)}>
            Ver o pedido do cliente
          </button>
        )}
      </aside>
    </div>
  );
}

/**
 * O pedido original, com os trechos da alteração selecionada destacados. Quem
 * valida a leitura da conversa vê, no texto, de onde cada tarefa saiu.
 */
function TextoComDestaques({ texto, itens }: { texto: string; itens: FonteTrecho[] }) {
  const cont = useRef<HTMLDivElement>(null);

  const faixas = useMemo(() => {
    const achadas: { ini: number; fim: number }[] = [];
    for (const it of itens) {
      let ini = it.inicio;
      // o texto pode ter sido editado depois da importação: procura de novo
      if (texto.slice(ini, ini + it.trecho.length) !== it.trecho) ini = texto.indexOf(it.trecho);
      if (ini >= 0) achadas.push({ ini, fim: ini + it.trecho.length });
    }
    achadas.sort((a, b) => a.ini - b.ini);
    const limpas: { ini: number; fim: number }[] = [];
    for (const f of achadas) if (!limpas.length || f.ini >= limpas[limpas.length - 1].fim) limpas.push(f);
    return limpas;
  }, [texto, itens]);

  useEffect(() => {
    const marca = cont.current?.querySelector("mark") as HTMLElement | null;
    const caixa = cont.current?.closest(".referencia") as HTMLElement | null;
    if (marca && caixa) caixa.scrollTop = Math.max(0, marca.offsetTop - caixa.clientHeight / 3);
  }, [faixas]);

  const partes: React.ReactNode[] = [];
  let cursor = 0;
  faixas.forEach((f, i) => {
    if (f.ini > cursor) partes.push(texto.slice(cursor, f.ini));
    partes.push(<mark key={i}>{texto.slice(f.ini, f.fim)}</mark>);
    cursor = f.fim;
  });
  partes.push(texto.slice(cursor));

  return (
    <div className="ref-texto" ref={cont}>
      {partes}
    </div>
  );
}