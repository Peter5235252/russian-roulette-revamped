import React from 'react';

interface HealthTubeProps {
  health: number;
  maxHealth: number;
  label: string;
  isPlayer?: boolean;
}

export function HealthTube({ health, maxHealth, label, isPlayer }: HealthTubeProps) {
  const percentage = Math.max(0, Math.min(100, (health / maxHealth) * 100));

  return (
    <div className={`flex flex-col gap-1.5 w-60 ${isPlayer ? 'items-start' : 'items-end'}`}>
      <div className="font-mono text-xs tracking-widest text-neutral-400 tabular-nums">
        {label} [{Math.round(health)}]
      </div>
      
      <div className="relative w-full h-5 frosted-glass-ui border border-neutral-800 rounded-none overflow-hidden">
        <div 
          className="absolute top-0 bottom-0 bg-[#5c0808] transition-all duration-700 ease-out"
          style={{ 
            width: `${percentage}%`,
            right: !isPlayer ? 0 : 'auto',
            left: isPlayer ? 0 : 'auto',
          }}
        />
        
        <div className="absolute inset-0 flex justify-between px-1 z-10 opacity-20 pointer-events-none">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="w-[1px] h-full bg-neutral-400"></div>
          ))}
        </div>
      </div>
    </div>
  );
}
