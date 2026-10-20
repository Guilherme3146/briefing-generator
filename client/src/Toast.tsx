import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Toasts — aviso curto que aparece e some sozinho, para ações que não têm
 * outro feedback visível (copiar, confirmar, limpar, gerar o arquivo).
 *
 * De propósito, NÃO substitui o `.erro-geral` fixo no topo: erro de chamada à
 * API continua lá, porque o analista precisa poder voltar e reler depois — um
 * toast que sumiu sozinho não serve para isso. Toast é só para "deu certo,
 * siga em frente".
 */

export type TomToast = "sucesso" | "erro" | "info";

type Toast = { id: number; mensagem: string; tom: TomToast };

/** Confirmação (substitui o `confirm()` nativo do navegador): some só quando o analista decide. */
type Confirmacao = {
  id: number;
  mensagem: string;
  textoConfirmar: string;
  textoCancelar: string;
  resolve: (ok: boolean) => void;
};

type OpcoesConfirmar = { confirmar?: string; cancelar?: string };

type ContextoToast = {
  mostrar: (mensagem: string, tom?: TomToast) => void;
  /** Pergunta sim/não dentro do próprio app, no lugar do `confirm()` do navegador. */
  confirmar: (mensagem: string, opcoes?: OpcoesConfirmar) => Promise<boolean>;
};

const Contexto = createContext<ContextoToast | null>(null);

const DURACAO_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmacoes, setConfirmacoes] = useState<Confirmacao[]>([]);
  const proximoId = useRef(1);

  const remover = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const mostrar = useCallback(
    (mensagem: string, tom: TomToast = "sucesso") => {
      const id = proximoId.current++;
      setToasts((t) => [...t, { id, mensagem, tom }]);
      window.setTimeout(() => remover(id), DURACAO_MS);
    },
    [remover],
  );

  const responder = useCallback((id: number, ok: boolean) => {
    setConfirmacoes((cs) => {
      const alvo = cs.find((c) => c.id === id);
      alvo?.resolve(ok);
      return cs.filter((c) => c.id !== id);
    });
  }, []);

  const confirmar = useCallback((mensagem: string, opcoes: OpcoesConfirmar = {}) => {
    return new Promise<boolean>((resolve) => {
      const id = proximoId.current++;
      setConfirmacoes((cs) => [
        ...cs,
        {
          id,
          mensagem,
          textoConfirmar: opcoes.confirmar ?? "Confirmar",
          textoCancelar: opcoes.cancelar ?? "Cancelar",
          resolve,
        },
      ]);
    });
  }, []);

  return (
    <Contexto.Provider value={{ mostrar, confirmar }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tom}`}>
            <span>{t.mensagem}</span>
            <button aria-label="Fechar aviso" onClick={() => remover(t.id)}>
              ×
            </button>
          </div>
        ))}
        {confirmacoes.map((c) => (
          <div key={c.id} className="toast confirmacao" role="alertdialog" aria-live="assertive">
            <span>{c.mensagem}</span>
            <div className="toast-acoes">
              <button className="toast-cancelar" onClick={() => responder(c.id, false)}>
                {c.textoCancelar}
              </button>
              <button className="toast-confirmar" onClick={() => responder(c.id, true)}>
                {c.textoConfirmar}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

/** Fora de um <ToastProvider>, cai para o `confirm()` nativo — nunca quebra a tela por causa de um aviso. */
export function useToast(): ContextoToast {
  const ctx = useContext(Contexto);
  if (ctx) return ctx;
  return { mostrar: () => {}, confirmar: (mensagem) => Promise.resolve(confirm(mensagem)) };
}
