import type { Inspecao } from "./types";

type Props = {
  quantidade: number;
  pendencias: number;
  avisos: number;
  naoConfirmadas: number;
  planilha: File | null;
  inspecao: Inspecao | null;
  inspecionando: boolean;
  desatualizada: boolean;
  semCapacidade: boolean;
  bloqueado: boolean;
  gerando: boolean;
  onEscolher: (arquivo: File) => void;
  onDescartar: () => void;
  onReconferir: () => void;
  onGerar: () => void;
  onIrParaProblema: () => void;
};

export default function AbaPlanilha(p: Props) {
  const acrescentando = Boolean(p.planilha);

  return (
    <div className="pagina estreita">
      <section className="painel">
        <header className="painel-topo">
          <h2>Antes de gerar</h2>
          <p>O botão libera quando não houver pendência nem rascunho da IA sem confirmar.</p>
        </header>

        <ul className="checklist">
          <Item
            ok={p.quantidade > 0}
            texto={`${p.quantidade} ${p.quantidade === 1 ? "alteração" : "alterações"} no briefing`}
          />
          <Item
            ok={p.pendencias === 0}
            texto={
              p.pendencias === 0
                ? "Nenhuma pendência"
                : `${p.pendencias} ${p.pendencias === 1 ? "pendência bloqueia" : "pendências bloqueiam"}`
            }
            acao={p.pendencias > 0 ? { rotulo: "Ir para a primeira", onClick: p.onIrParaProblema } : undefined}
          />
          <Item
            ok={p.naoConfirmadas === 0}
            texto={
              p.naoConfirmadas === 0
                ? "Tudo confirmado"
                : `${p.naoConfirmadas} ${p.naoConfirmadas === 1 ? "rascunho" : "rascunhos"} da IA sem confirmar`
            }
          />
          <Item
            ok={!p.semCapacidade}
            texto={p.semCapacidade ? "Não cabe na planilha enviada" : "Cabe na planilha"}
          />
          {p.avisos > 0 && (
            <Item neutro texto={`${p.avisos} ${p.avisos === 1 ? "aviso" : "avisos"} — não bloqueiam`} />
          )}
        </ul>
      </section>

      <section className="painel">
        <header className="painel-topo">
          <h2>Para onde vão as alterações</h2>
        </header>

        <div className="modos">
          <div className={`modo ${!acrescentando ? "ativo" : ""}`}>
            <strong>Planilha nova</strong>
            <span>Gera um arquivo a partir do modelo da casa.</span>
          </div>

          <div className={`modo ${acrescentando ? "ativo" : ""}`}>
            <strong>Segunda rodada</strong>
            <span>
              Acrescenta no fim de uma planilha que já está em execução e devolve o mesmo arquivo,
              preservando o link do Salesforce.
            </span>

            {!p.planilha ? (
              <label className="anexar">
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) p.onEscolher(f);
                  }}
                />
                <span>{p.inspecionando ? "Lendo a planilha…" : "+ Enviar planilha existente"}</span>
              </label>
            ) : (
              <div className="arquivo-escolhido">
                <span title={p.planilha.name}>{p.planilha.name}</span>
                <button onClick={p.onDescartar} title="Descartar e gerar uma nova" aria-label="Descartar planilha">
                  ×
                </button>
              </div>
            )}
          </div>
        </div>

        {p.inspecao && (
          <ul className="inspecao">
            <li>
              <strong>{p.inspecao.jaExistiam}</strong> já na planilha
              {p.inspecao.emExecucao > 0 && (
                <>
                  , <strong>{p.inspecao.emExecucao}</strong> em execução
                </>
              )}
            </li>
            <li>
              As novas entram na linha <strong>{p.inspecao.primeiraLinhaLivre}</strong> — nada acima é tocado
            </li>
            <li className={p.semCapacidade ? "ruim" : undefined}>
              Cabem mais <strong>{p.inspecao.capacidadeRestante}</strong>; você tem {p.quantidade}
            </li>
          </ul>
        )}

        {p.inspecao && p.inspecao.duplicadas.length > 0 && (
          <div className="aviso aviso-box">
            <strong>{p.inspecao.duplicadas.length} já parece(m) estar lá</strong>
            <ul>
              {p.inspecao.duplicadas.map((d) => (
                <li key={d.ordem}>
                  Alteração {d.ordem} é igual à linha {d.linha}
                </li>
              ))}
            </ul>
            <small>Confira antes — o app não bloqueia.</small>
          </div>
        )}

        {p.desatualizada && (
          <div className="aviso aviso-box">
            <span>As alterações mudaram desde a leitura da planilha.</span>
            <button className="mini" onClick={p.onReconferir}>
              Reconferir
            </button>
          </div>
        )}
      </section>

      <div className="acao-final">
        <button className="primario grande" onClick={p.onGerar} disabled={p.bloqueado || p.gerando}>
          {p.gerando
            ? acrescentando
              ? "Acrescentando…"
              : "Gerando…"
            : acrescentando
              ? `Acrescentar na linha ${p.inspecao?.primeiraLinhaLivre ?? "?"}`
              : "Gerar planilha"}
        </button>
        {p.bloqueado && !p.gerando && (
          <small className="nota">Resolva os itens marcados acima para liberar o botão.</small>
        )}
      </div>
    </div>
  );
}

function Item({
  ok,
  neutro,
  texto,
  acao,
}: {
  ok?: boolean;
  neutro?: boolean;
  texto: string;
  acao?: { rotulo: string; onClick: () => void };
}) {
  const estado = neutro ? "neutro" : ok ? "ok" : "falta";
  return (
    <li className={`check ${estado}`}>
      <span className="marca" aria-hidden="true">
        {neutro ? "!" : ok ? "✓" : "✕"}
      </span>
      <span>{texto}</span>
      {acao && (
        <button className="mini" onClick={acao.onClick}>
          {acao.rotulo}
        </button>
      )}
    </li>
  );
}
