import { Phone, Calendar } from 'lucide-react';
import type { RelatorioBias } from '../../lib/types';

interface Props {
  lead: RelatorioBias;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatPhone(t: string): string {
  return t.replace('@s.whatsapp.net', '');
}

export function AlertaLeadSemDoutor({ lead }: Props) {
  const shortMsg = (lead.mensagemInicial ?? '').slice(0, 80);

  return (
    <div className="flex items-start gap-3 py-2 border-t border-burst-border/40 first:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-sm text-white/90">
            {formatPhone(lead.telefone)}
          </span>
          {lead.senderName && (
            <span className="text-xs text-burst-muted">{lead.senderName}</span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-burst-muted ml-auto whitespace-nowrap">
            <Calendar size={11} />
            {formatDate(lead.dataCadastro)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-burst-muted/50 truncate">
          <Phone size={9} />
          {lead.token}
        </div>
        {shortMsg && (
          <div className="mt-1 text-xs text-white/60 italic line-clamp-1">
            "{shortMsg}{(lead.mensagemInicial?.length ?? 0) > 80 ? '...' : ''}"
          </div>
        )}
      </div>
    </div>
  );
}
