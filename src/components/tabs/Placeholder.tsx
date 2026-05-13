import { Flame } from 'lucide-react';

interface Props {
  title: string;
  description: string;
}

export function Placeholder({ title, description }: Props) {
  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]">
      <div className="rounded-2xl bg-burst-card border border-burst-border p-12 max-w-xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-burst-orange/15 text-burst-orange-bright flex items-center justify-center mx-auto mb-4 animate-pulse-orange">
          <Flame size={28} />
        </div>
        <h2 className="font-display text-4xl text-white tracking-wider mb-2">
          {title}
        </h2>
        <p className="text-burst-muted text-sm">{description}</p>
        <div className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-burst-orange/30 bg-burst-orange/5">
          <span className="w-1.5 h-1.5 rounded-full bg-burst-orange animate-pulse" />
          <span className="text-xs uppercase tracking-widest text-burst-orange-bright">
            Em construção
          </span>
        </div>
      </div>
    </div>
  );
}
