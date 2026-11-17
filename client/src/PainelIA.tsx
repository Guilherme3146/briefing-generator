import { useState } from "react";
import type { OrigemPedido, Uso } from "./types";

type Props = {
  pedido: string;
  origem: OrigemPedido;
  instrucao: string;
  onInstrucao: (v: string) => void;
  sugerindo: boolean;
  revisando: boolean;
  aRevisar: number;
  totalAlteracoes: number;
  naoConfirmadas: number;
  ignorados: string[];
  revertidas: string[];
  uso: Uso | null;
  onOrigem: (o: OrigemPedido) => void;
  onSugerir: () => void;
  onRevisar: () => void;
  onVerAlteracoes: () => void;
};

/**
 * IA dentro da etapa Pedido (não há mais aba própria). Só é renderizada quando o servidor
 * tem uma chave no .env (GEMINI_API_KEY ou ANTHROPIC_API_KEY); sem chave, nada disto aparece
 * e o fluxo manual segue igual.
 */
export default function PainelIA(p: Props) {
  const temPedido = p.pedido.trim().length > 0;
  const gerouAlgo = p.ignorados.length > 0 || p.revertidas.length > 0 || p.naoConfirmadas > 0;

  return (
    <section className="painel ia">
      <header className="painel-topo">
        <h2>Separar em alterações</h2>
        <p>
          Lê o texto do pedido acima e monta as alterações, anotando as dúvidas. Cada alteração nasce como
          rascunho e você confirma uma a uma.
        </p>
      </header>

      <div className="campo">
        <span className="rotulo">De onde veio o texto</span>
        <div className="segmentado" role="group">
          <button className={p.origem === "mensagem" ? "ativo" : ""} onClick={() => p.onOrigem("mensagem")}>
            Mensagem
          </button>
          <button className={p.origem === "reuniao" ? "ativo" : ""} onClick={() => p.onOrigem("reuniao")}>
            Reunião
          </button>
        </div>
        <small>
          {p.origem === "reuniao"
            ? "Transcrição é chute da máquina: nada dela vira texto final do site — tudo que for publicado vira pergunta."
            : "O que o cliente escreveu entre aspas pode ir direto para o site."}
        </small>
      </div>

      <label className="campo">
        <span className="rotulo">
          Orientação <em>opcional</em>
        </span>
        <textarea
          rows={2}
          maxLength={2000}
          value={p.instrucao}
          onChange={(e) => p.onInstrucao(e.target.value)}
          placeholder="Ex.: uma alteração por produto, na ordem dos slides."
        />
      </label>

      <div className="acoes">
        <button className="ia-botao cheio" onClick={p.onSugerir} disabled={p.sugerindo || !temPedido}>
          {p.sugerindo ? (p.origem === "reuniao" ? "Lendo a reunião…" : "Lendo o pedido…") : "Separar em alterações"}
        </button>
        {gerouAlgo && (
          <button className="secundario" onClick={p.onVerAlteracoes}>
            Conferir as alterações →
          </button>
        )}
      </div>
      <small className="nota">Cada clique é uma chamada à IA; o app nunca chama sozinho.</small>

      {p.revertidas.length > 0 && (
        <Recolhivel
          titulo={`Decisões revertidas na reunião (${p.revertidas.length})`}
          tom="neutro"
          nota="Foi decidido e depois desfeito na própria conversa. Não virou alteração — confira se a IA leu certo."
          itens={p.revertidas}
        />
      )}
      {p.ignorados.length > 0 && (
        <Recolhivel
          titulo={`Não virou alteração (${p.ignorados.length})`}
          tom="atencao"
          nota="Trechos que a IA não transformou em nada. Confira se algum deveria ter virado alteração."
          itens={p.ignorados}
        />
      )}

      {p.totalAlteracoes > 0 && (
        <div className="acoes">
          <button className="ia-botao" onClick={p.onRevisar} disabled={p.revisando || p.aRevisar === 0}>
            {p.revisando
              ? "Revisando…"
              : p.aRevisar === 0
                ? "Tudo revisado"
                : `Revisar ${p.aRevisar} ${p.aRevisar === 1 ? "alteração" : "alterações"} com a IA`}
          </button>
          <small className="nota">Pergunta, para cada alteração, se alguém que nunca falou com o cliente conseguiria executar.</small>
        </div>
      )}

      {p.uso && (
        <p className="uso">
          Último uso: {p.uso.modelo} · entrada {p.uso.entrada.toLocaleString("pt-BR")} · saída{" "}
          {p.uso.saida.toLocaleString("pt-BR")}
        </p>
      )}
    </section>
  );
}

function Recolhivel({
  titulo,
  nota,
  itens,
  tom,
}: {
  titulo: string;
  nota: string;
  itens: string[];
  tom: "atencao" | "neutro";
}) {
  const [aberto, setAberto] = useState(true);
  return (
    <div className={`recolhivel ${tom}`}>
      <button className="recolhivel-topo" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span>{titulo}</span>
        <span className="seta">{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div className="recolhivel-corpo">
          <p className="nota">{nota}</p>
          <ul>
            {itens.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
