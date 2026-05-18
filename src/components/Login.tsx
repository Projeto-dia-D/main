import { useEffect, useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { BrandTitle } from './BrandTitle';
import { fetchAuthEmails } from '../lib/monday';
import {
  attemptLogin,
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

export function Login({ preloadedEmails, onAuthenticated }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    document.getElementById('login-email')?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!emails) {
      setError('Aguarde alguns segundos — carregando lista de usuários do Monday...');
      return;
    }
    setSubmitting(true);
    const { user, error: err } = attemptLogin(email, password, emails);
    setSubmitting(false);
    if (user) {
      writeCurrentUser(user);
      onAuthenticated(user);
    } else {
      setError(err ?? 'Falha no login.');
    }
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

        <form
          onSubmit={handleSubmit}
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
      </div>
    </div>
  );
}
