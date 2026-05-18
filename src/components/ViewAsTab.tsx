import { Avatar } from './Avatar';

interface Props {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Nome completo pra resolver foto + iniciais. Quando omitido, usa label. */
  fullName?: string;
  /** Foto da pessoa (do Monday). null/undefined → cai pro avatar com iniciais. */
  photoUrl?: string | null;
  /** Quando true, NÃO mostra avatar (ex: tab "Visão geral"). */
  noAvatar?: boolean;
}

/**
 * Tab pequeno usado pelo admin pra trocar entre "Visão geral" e perfis
 * individuais (view-as). Mostra avatar pequeno do user + primeiro nome.
 */
export function ViewAsTab({
  label,
  active,
  onClick,
  fullName,
  photoUrl,
  noAvatar,
}: Props) {
  return (
    <button
      onClick={onClick}
      title={fullName ?? label}
      className={[
        'flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg text-sm font-semibold transition-colors',
        active
          ? 'bg-burst-orange/20 text-burst-orange-bright shadow-orange-glow-sm'
          : 'text-burst-muted hover:text-white hover:bg-white/5',
      ].join(' ')}
    >
      {!noAvatar && (
        <Avatar
          src={photoUrl}
          name={fullName ?? label}
          size={22}
          className={active ? 'ring-1 ring-burst-orange-bright' : ''}
        />
      )}
      <span className={noAvatar ? 'px-2' : ''}>{label}</span>
    </button>
  );
}
