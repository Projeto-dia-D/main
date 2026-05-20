import { useEffect, useState } from 'react';
import { LogIn, Loader2, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { fetchAuthEmails } from '../lib/monday';
import {
  checkEmailInSupabase,
  attemptLoginWithResolvedUser,
  registerPasswordWithResolvedUser,
  fetchPasswordHash,
  writeCurrentUser,
  type AuthUser,
  type MondayEmails,
} from '../lib/auth';
import { readCache, writeCache } from '../lib/cache';

interface Props {
  /** Emails pré-carregados (se já vieram via useMondayClients). */
  preloadedEmails: MondayEmails | null;
  onAuthenticated: (user: AuthUser) => void;
}

interface CachedAuthEmails {
  cs: [string, string][];
  gestor: [string, string][];
  programador: [string, string][];
  designer?: [string, string][];
  photos?: [string, string][];      // email → photoUrl
  workspace?: [string, string][];   // email → nome (workspace)
}
// v3: adicionados designer + workspace (resolve login via nome do workspace)
const AUTH_CACHE_KEY = 'auth:emails:v3';

function readCachedEmails(): MondayEmails | null {
  const c = readCache<CachedAuthEmails>(AUTH_CACHE_KEY);
  if (!c) return null;
  return {
    csByEmail: new Map(c.cs),
    gestorByEmail: new Map(c.gestor),
    programadorByEmail: new Map(c.programador),
    designerByEmail: new Map(c.designer ?? []),
    photoByEmail: new Map(c.photos ?? []),
    workspaceNameByEmail: new Map(c.workspace ?? []),
  };
}

function saveCachedEmails(em: MondayEmails) {
  writeCache<CachedAuthEmails>(AUTH_CACHE_KEY, {
    cs: Array.from(em.csByEmail.entries()),
    gestor: Array.from(em.gestorByEmail.entries()),
    programador: Array.from(em.programadorByEmail.entries()),
    designer: em.designerByEmail ? Array.from(em.designerByEmail.entries()) : [],
    photos: em.photoByEmail ? Array.from(em.photoByEmail.entries()) : [],
    workspace: em.workspaceNameByEmail ? Array.from(em.workspaceNameByEmail.entries()) : [],
  });
}

// Fluxo em 2 passos:
//   step='email'  → usuário digita email; ao continuar, verifica se ele existe
//                   no Monday e se já tem senha cadastrada
//   step='entrar' → tem senha cadastrada, mostra campo "Senha" + botão Entrar
//   step='criar'  → não tem senha, mostra 2 campos "Nova senha" + "Confirmar"
type Step = 'email' | 'entrar' | 'criar';

export function Login({ preloadedEmails, onAuthenticated }: Props) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [resolvedUser, setResolvedUser] = useState<AuthUser | null>(null);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Determina os emails: preloaded > cache > fetch on mount
  const [emails, setEmails] = useState<MondayEmails | null>(() => {
    if (preloadedEmails) return preloadedEmails;
    return readCachedEmails();
  });

  // Se já chegaram via prop depois, atualiza
  useEffect(() => {
    if (preloadedEmails) {
      setEmails(preloadedEmails);
      saveCachedEmails(preloadedEmails);
    }
  }, [preloadedEmails]);

  // Se não tem emails ainda, busca direto do Monday (em background)
  useEffect(() => {
    if (emails) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchAuthEmails();
        if (!active) return;
        setEmails(res);
        saveCachedEmails(res);
      } catch {
        /* falha silenciosa - o usuario tenta de novo */
      }
    })();
    return () => { active = false; };
  }, [emails]);

  useEffect(() => {
    if (step === 'email') {
      document.getElementById('login-email')?.focus();
    } else {
      document.getElementById('login-pwd')?.focus();
    }
  }, [step]);

  // Passo 1: usuário digita email e clica em "Continuar".
  // Verifica DIRETO no Supabase (tabela monday_auth_emails) — instantâneo,
  // não depende de carregar Monday API. Decide próximo passo (entrar/criar).
  async function handleSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user, error: err } = await checkEmailInSupabase(email);
      if (!user) {
        setError(err ?? 'Email não cadastrado.');
        return;
      }
      // Email válido — checa se já tem senha
      const existing = await fetchPasswordHash(email);
      setResolvedUser(user);
      setStep(existing ? 'entrar' : 'criar');
    } catch {
      setError('Falha ao consultar banco — tente novamente em alguns segundos.');
    } finally {
      setSubmitting(false);
    }
  }

  // Passo 2A (tem senha): login normal
  async function handleSubmitEntrar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resolvedUser) return;
    setSubmitting(true);
    try {
      const { user, error: err } = await attemptLoginWithResolvedUser(email, password, resolvedUser);
      if (user) {
        writeCurrentUser(user);
        onAuthenticated(user);
      } else {
        setError(err ?? 'Falha no login.');
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  }

  // Passo 2B (criar senha): registra e já entra
  async function handleSubmitCriar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!resolvedUser) return;
    if (password !== passwordConfirm) {
      setError('As senhas não coincidem.');
      return;
    }
    setSubmitting(true);
    try {
      const { user, error: err } = await registerPasswordWithResolvedUser(email, password, resolvedUser);
      if (user) {
        writeCurrentUser(user);
        onAuthenticated(user);
      } else {
        setError(err ?? 'Falha ao criar senha.');
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : 'Erro inesperado.');
    } finally {
      setSubmitting(false);
    }
  }

  function voltarPraEmail() {
    setStep('email');
    setPassword('');
    setPasswordConfirm('');
    setError(null);
    setResolvedUser(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-burst-bg px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block">
            <BrandTitle size="lg" />
          </div>
          <div className="text-burst-muted text-sm mt-2 tracking-widest uppercase">
            Acesso restrito
          </div>
        </div>

        {step === 'email' && (
          <form
            onSubmit={handleSubmitEmail}
            className="bg-burst-card border border-burst-border rounded-2xl p-6 flex flex-col gap-4 shadow-card"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-[10px] uppercase tracking-widest text-burst-muted">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seuemail@burstmidia.com"
                autoComplete="email"
                required
                className="bg-black/40 border border-burst-border rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-burst-orange placeholder:text-burst-muted/60"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 bg-burst-orange/20 border border-burst-orange/50 hover:bg-burst-orange/30 text-burst-orange-bright px-4 py-2.5 rounded-md font-semibold text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Verificando...
                </>
              ) : (
                <>
                  <LogIn size={15} /> Continuar
                </>
              )}
            </button>
            <div className="text-[11px] text-burst-muted/80 text-center leading-snug">
              Use o email cadastrado no Monday.
              <br />
              Primeira vez? Você cria sua senha no próximo passo.
            </div>
          </form>
        )}

        {step === 'entrar' && (
          <form
            onSubmit={handleSubmitEntrar}
            className="bg-burst-card border border-burst-border rounded-2xl p-6 flex flex-col gap-4 shadow-card"
          >
            <UserHeader user={resolvedUser} email={email} onVoltar={voltarPraEmail} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-pwd" className="text-[10px] uppercase tracking-widest text-burst-muted">
                Senha
              </label>
              <input
                id="login-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="bg-black/40 border border-burst-border rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-burst-orange"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 bg-burst-orange/20 border border-burst-orange/50 hover:bg-burst-orange/30 text-burst-orange-bright px-4 py-2.5 rounded-md font-semibold text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Entrando...
                </>
              ) : (
                <>
                  <LogIn size={15} /> Entrar
                </>
              )}
            </button>
          </form>
        )}

        {step === 'criar' && (
          <form
            onSubmit={handleSubmitCriar}
            className="bg-burst-card border border-burst-border rounded-2xl p-6 flex flex-col gap-4 shadow-card"
          >
            <UserHeader user={resolvedUser} email={email} onVoltar={voltarPraEmail} />

            <div className="rounded-md bg-burst-orange/10 border border-burst-orange/30 px-3 py-2 text-[11px] text-burst-orange-bright flex items-start gap-2">
              <KeyRound size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>Primeiro acesso</strong> — crie uma senha pra você.
                Mínimo 6 caracteres.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-pwd" className="text-[10px] uppercase tracking-widest text-burst-muted">
                Nova senha
              </label>
              <input
                id="login-pwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                className="bg-black/40 border border-burst-border rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-burst-orange"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-pwd2" className="text-[10px] uppercase tracking-widest text-burst-muted">
                Confirmar senha
              </label>
              <input
                id="login-pwd2"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                className="bg-black/40 border border-burst-border rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-burst-orange"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 bg-burst-orange/20 border border-burst-orange/50 hover:bg-burst-orange/30 text-burst-orange-bright px-4 py-2.5 rounded-md font-semibold text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Criando...
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} /> Criar senha e entrar
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Header com nome resolvido + botão pra voltar e trocar email. */
function UserHeader({
  user,
  email,
  onVoltar,
}: {
  user: AuthUser | null;
  email: string;
  onVoltar: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pb-2 border-b border-burst-border">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-widest text-burst-muted">
          Entrando como
        </div>
        <div className="text-sm text-white font-semibold truncate" title={email}>
          {user?.displayName ?? email}
        </div>
        <div className="text-[10px] text-burst-muted truncate" title={email}>
          {email}
        </div>
      </div>
      <button
        type="button"
        onClick={onVoltar}
        className="text-[10px] text-burst-muted hover:text-burst-orange-bright flex items-center gap-1 uppercase tracking-wider"
      >
        <ArrowLeft size={11} /> Trocar
      </button>
    </div>
  );
}
