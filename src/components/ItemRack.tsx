import React from 'react';
import { ItemType } from '../types';
import { ITEM_DESCRIPTIONS } from '../gameData';

interface ItemRackProps {
  items: ItemType[];
  onUseItem?: (index: number) => void;
  disabled?: boolean;
  selectedIndex?: number;
  highlightSelected?: boolean;
}

const ITEM_ICONS: Record<ItemType, string> = {
  MIRROR: '🪞',
  PLIERS: '🔧',
  WHISKEY: '🥃',
  TOURNIQUET: '🩸',
  PENTAGRAM: '⛧',
  CIGARETTE: '🚬',
  SCALPEL: '🔪',
  DEFIBRILLATOR: '⚡',
  SYRINGE: '💉',
  RAZORBLADE: '🪒',
  MEDKIT: '🚑'
};

export function ItemRack({ items, onUseItem, disabled, selectedIndex = -1, highlightSelected = false }: ItemRackProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex gap-2 p-2 frosted-glass-ui rounded-none overflow-visible max-w-full">
      {items.map((item, index) => {
        const isSelected = highlightSelected && index === selectedIndex;
        return (
          <button
            key={index}
            onClick={() => onUseItem && onUseItem(index)}
            disabled={disabled}
            className={`group relative min-w-[52px] w-13 h-13 transition-colors duration-150 flex items-center justify-center text-xl ${
              isSelected 
                ? 'frosted-glass-item-selected z-10' 
                : 'frosted-glass-item hover:border-red-800 hover:bg-[#1b0809] disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
            title={ITEM_DESCRIPTIONS[item]}
          >
            <span className="opacity-85 group-hover:opacity-100 font-sans">
              {ITEM_ICONS[item]}
            </span>
            <div className="absolute bottom-full mb-2.5 left-1/2 -ml-24 text-[10px] w-48 text-center text-neutral-300 p-2 hidden group-hover:flex flex-col items-center z-50 frosted-glass-ui font-mono pointer-events-none">
              <span className="text-red-500 font-bold mb-0.5">{item === 'RAZORBLADE' ? 'RUSTY RAZORBLADE' : item}</span>
              {ITEM_DESCRIPTIONS[item]}
            </div>
          </button>
        );
      })}
    </div>
  );
}
