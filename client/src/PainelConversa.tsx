import { useState } from "react";
import {
  ROTULO_DESCARTE,
  type DescartadoConversa,
  type Importacao,
  type MotivoDescarte,
} from "./types";

type Props = {
  importacao: Importacao | null;
  importando: boolean;
  /** falha da última tentativa de importar, mostrada AQUI (a barra do topo pode estar fora da tela) */
  erro: string | null;
  arquivoNome: string | null;
  onTentarDeNovo: () => void;
  promovidos: Set<number>;
  onArquivo: (arquivo: File) => void;
  onReprocessar: (clientes: string[]) => void;
  onAdicionar: (indices: number[]) => void;
  onPromover: (d: DescartadoConversa) => void;
};

const ORDEM_GRUPOS: MotivoDescarte[] = ["sem_objeto", "sugestao_sem_acordo", "pergunta", "ja_resolvido", "processo"];
const ROTULO_CONFIANCA = { alta: "Alta confiança", media: "Confiança média" } as const;

/**
 * Importa a transcrição de uma reunião e mostra o que o programa leu, SEM IA.
 * O objetivo é o analista conferir a leitura: o que virou tarefa (e de qual
 * fala), o que ficou de fora (e por quê) e o que o programa não conseguiu ver.
 */
export default function PainelConversa(p: Props) {
  return (
    <section className="painel conversa">
      <header className="painel-topo">
        <h2>Importar uma conversa</h2>
        <p>
          Envie a transcrição da reunião (PDF, TXT ou VTT). O programa lê por regras, sem IA: separa
          quem falou, separa o que parece pedido do que é conversa e deixa as tarefas para você conferir.
        </p>
      </header>

      <label className="anexar">
        <input
          type="file"
          accept=".pdf,.txt,.vtt,application/pdf,text/plain,text/vtt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) p.onArquivo(f);
          }}
        />
        <span>
          {p.importando
            ? `Lendo ${p.arquivoNome ?? "o arquivo"}…`
            : p.importacao
              ? "Trocar o arquivo"
              : "+ Escolher o arquivo da conversa"}
        </span>
      </label>

      {p.erro && (
        <div className="aviso-box erro-importacao" role="alert">
          <strong>Não consegui importar{p.arquivoNome ? ` “${p.arquivoNome}”` : ""}</strong>
          <span>{p.erro}</span>
          {p.arquivoNome && (
            <button className="mini" disabled={p.importando} onClick={p.onTentarDeNovo}>
              Tentar de novo
            </button>
          )}
        </div>
      )}

      {p.importacao && (
        <Resultado
          // recomeça a seleção quando o resultado muda (arquivo novo ou reprocessado)
          key={p.importacao.arquivo + "|" + p.importacao.tarefas.map((t) => t.assunto).join(",")}
          {...p}
          importacao={p.importacao}
        />
      )}
    </section>
  );
}

function Resultado({ importacao: r, promovidos, onReprocessar, onAdicionar, onPromover }: Props & { importacao: Importacao }) {
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set(r.tarefas.map((_, i) => i)));
  const [clientes, setClientes] = useState<Set<string>>(
    () => new Set(r.falantes.filter((f) => f.papel === "cliente").map((f) => f.nome)),
  );
  const original = r.falantes.filter((f) => f.papel === "cliente").map((f) => f.nome);
  const mudou = original.length !== clientes.size || original.some((n) => !clientes.has(n));

  const alterna = (i: number) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const grupos = ORDEM_GRUPOS.map((m) => ({ motivo: m, itens: r.descartados.filter((d) => d.motivo === m) })).filter(
    (g) => g.itens.length > 0,
  );

  return (
    <>
      <p className="resumo-leitura">
        <strong>{r.arquivo}</strong> · {r.resumo.turnos} falas · {r.tarefas.length}{" "}
        {r.tarefas.length === 1 ? "tarefa" : "tarefas"} · {r.descartados.length} trechos de fora
        {r.resumo.ruido > 0 && <> · {r.resumo.ruido} ruídos ignorados</>}
      </p>

      {r.alertas.map((a, i) => (
        <div className="aviso-box" key={i}>
          <strong>Atenção</strong>
          <span>{a}</span>
        </div>
      ))}

      {r.falantes.length > 1 && (
        <div className="campo">
          <span className="rotulo">Quem é o cliente?</span>
          <div className="falantes">
            {r.falantes.map((f) => (
              <button
                key={f.nome}
                type="button"
                className={`chip-falante ${clientes.has(f.nome) ? "ativo" : ""}`}
                aria-pressed={clientes.has(f.nome)}
                onClick={() =>
                  setClientes((s) => {
                    const n = new Set(s);
                    if (n.has(f.nome)) n.delete(f.nome);
                    else n.add(f.nome);
                    return n;
                  })
                }
              >
                {clientes.has(f.nome) ? "Cliente" : "Equipe"} · {f.nome}
                <small>{f.turnos} falas</small>
              </button>
            ))}
            <button
              className="secundario mini"
              disabled={!mudou || clientes.size === 0}
              onClick={() => onReprocessar([...clientes])}
            >
              Reprocessar
            </button>
          </div>
          <small>
            O programa adivinhou pelo jeito de falar. Pedido do cliente vale; sugestão da equipe só vale se o
            cliente concordou. Se ele errou, corrija e reprocesse.
          </small>
        </div>
      )}

      <div className="campo">
        <span className="rotulo">
          Tarefas encontradas <em>{marcadas.size} de {r.tarefas.length} marcadas</em>
        </span>

        {r.tarefas.length === 0 ? (
          <div className="vazio">
            <p>Não achei nada que pareça um pedido.</p>
            {r.descartados.some((d) => d.motivo === "sugestao_sem_acordo") && (
              <p>
                <strong>Confira "Quem é o cliente?" acima.</strong> Só vale como pedido o que o cliente diz. Se o
                programa marcou a pessoa errada, corrija e clique em Reprocessar.
              </p>
            )}
            <p>Veja também os trechos de fora abaixo: se algum for pedido, traga para as tarefas.</p>
          </div>
        ) : (
          <ol className="tarefas-conversa">
            {r.tarefas.map((t, i) => (
              <li key={i} className={marcadas.has(i) ? "" : "desmarcada"}>
                <label className="tarefa-topo">
                  <input type="checkbox" checked={marcadas.has(i)} onChange={() => alterna(i)} />
                  <span className={`conf ${t.confianca}`}>{ROTULO_CONFIANCA[t.confianca]}</span>
                  <strong>{t.assunto}</strong>
                </label>
                <p className="tarefa-texto">{t.solicitacao}</p>
                <ul className="fontes">
                  {t.fontes.map((f, k) => (
                    <li key={k}>
                      <b>
                        {f.quem} · {f.tempo}
                      </b>
                      <span>{f.trecho.length > 150 ? f.trecho.slice(0, 150) + "…" : f.trecho}</span>
                    </li>
                  ))}
                </ul>
                {t.duvidas.map((d, k) => (
                  <p className="tarefa-duvida" key={k}>
                    <span className="tag">perguntar</span> {d}
                  </p>
                ))}
                <small className="tarefa-motivo">{t.motivo}</small>
              </li>
            ))}
          </ol>
        )}

        {r.tarefas.length > 0 && (
          <div className="acoes">
            <button className="primario" disabled={marcadas.size === 0} onClick={() => onAdicionar([...marcadas].sort((a, b) => a - b))}>
              Adicionar {marcadas.size} {marcadas.size === 1 ? "tarefa" : "tarefas"} às Alterações
            </button>
            <button
              className="secundario"
              onClick={() => setMarcadas(marcadas.size === r.tarefas.length ? new Set() : new Set(r.tarefas.map((_, i) => i)))}
            >
              {marcadas.size === r.tarefas.length ? "Desmarcar todas" : "Marcar todas"}
            </button>
          </div>
        )}
      </div>

      {grupos.length > 0 && (
        <div className="campo">
          <span className="rotulo">
            O que ficou de fora <em>para você conferir</em>
          </span>
          {grupos.map((g) => (
            <details className="desc-grupo" key={g.motivo} open={g.motivo === "sem_objeto" || g.motivo === "sugestao_sem_acordo"}>
              <summary>
                {ROTULO_DESCARTE[g.motivo].titulo} <span className="contagem">{g.itens.length}</span>
              </summary>
              <p className="desc-ajuda">{ROTULO_DESCARTE[g.motivo].ajuda}</p>
              <ul>
                {g.itens.map((d) => (
                  <li key={d.inicio}>
                    <div>
                      <b>
                        {d.quem} · {d.tempo}
                      </b>
                      <span>{d.trecho}</span>
                    </div>
                    <button className="mini" disabled={promovidos.has(d.inicio)} onClick={() => onPromover(d)}>
                      {promovidos.has(d.inicio) ? "Já é tarefa" : "Virar tarefa"}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
