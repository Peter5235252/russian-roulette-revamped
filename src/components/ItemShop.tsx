import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { ItemType, Difficulty } from '../types';
import { ITEM_METADATA, getItemPrice, DIFFICULTY_PRICE_MULTIPLIERS } from '../gameData';
import { playPurchaseSound } from '../audio';

interface ItemShopProps {
  bloodCurrency: number;
  onBuyItem: (item: ItemType, cost: number) => void;
  onClose: () => void;
  playerItemCount: number;
  difficulty?: Difficulty;
}

const ITEMS_LIST: ItemType[] = [
  'MIRROR',
  'PLIERS',
  'WHISKEY',
  'TOURNIQUET',
  'CIGARETTE',
  'SCALPEL',
  'DEFIBRILLATOR',
  'PENTAGRAM',
  'RAZORBLADE',
  'SYRINGE'
];

export function ItemShop({
  bloodCurrency,
  onBuyItem,
  onClose,
  playerItemCount,
  difficulty = 'NORMAL'
}: ItemShopProps) {
  const [purchasedItem, setPurchasedItem] = useState<ItemType | null>(null);

  const mult = DIFFICULTY_PRICE_MULTIPLIERS[difficulty] || 1.0;
  const inflationPct = Math.round((mult - 1.0) * 100);

  const handleBuy = useCallback(
    (item: ItemType, cost: number) => {
      if (bloodCurrency >= cost && playerItemCount < 8) {
        playPurchaseSound();
        setPurchasedItem(item);
        setTimeout(() => setPurchasedItem(null), 300);
        onBuyItem(item, cost);
      }
    },
    [bloodCurrency, playerItemCount, onBuyItem]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="absolute inset-0 z-[250] flex items-center justify-center bg-black/80 p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 12 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="frosted-glass-ui p-5 sm:p-6 flex flex-col gap-5 w-full max-w-2xl text-neutral-200"
      >
        <div className="flex justify-between items-baseline border-b border-neutral-800 pb-3">
          <div>
            <h2 className="text-neutral-100 font-mono tracking-widest text-lg sm:text-xl uppercase font-bold">
              BLACK MARKET
            </h2>
            <div className="text-[10px] font-mono tracking-wider text-neutral-500 mt-0.5 tabular-nums">
              {difficulty} · {inflationPct > 0 ? `+${inflationPct}% MARKUP` : 'STANDARD RATE'}
            </div>
          </div>

          <div className="text-neutral-300 font-mono text-sm sm:text-base flex items-baseline gap-2 tabular-nums">
            <span className="text-neutral-500 text-xs">BLOOD</span>
            <span className="text-red-500 font-bold">{bloodCurrency}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ITEMS_LIST.map((item) => {
            const meta = ITEM_METADATA[item];
            const cost = getItemPrice(item, difficulty);
            const canAfford = bloodCurrency >= cost;
            const isFull = playerItemCount >= 8;
            const disabled = !canAfford || isFull;
            const isPurchased = purchasedItem === item;

            return (
              <button
                key={item}
                onClick={() => handleBuy(item, cost)}
                disabled={disabled}
                className={`group relative p-3 flex flex-col items-center gap-1.5 transition-colors duration-150 ${
                  isPurchased
                    ? 'frosted-glass-item-selected z-10'
                    : disabled
                    ? 'frosted-glass-item opacity-35 cursor-not-allowed grayscale'
                    : 'frosted-glass-item hover:border-red-800 hover:bg-[#190809] cursor-pointer'
                }`}
              >
                <span className="text-[8px] font-mono uppercase tracking-widest text-neutral-500">
                  {meta.rarity}
                </span>

                <span className="text-2xl sm:text-3xl my-0.5">
                  {meta.icon}
                </span>

                <div className="text-center w-full">
                  <div className="text-neutral-200 font-mono text-[10px] uppercase tracking-wider font-bold truncate">
                    {meta.name}
                  </div>
                  <div className="text-red-500 font-mono text-[11px] font-bold tabular-nums">
                    {cost}
                  </div>
                </div>

                {/* Minimal hover tooltip */}
                <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity duration-150 frosted-glass-ui p-2.5 text-[10px] text-neutral-300 font-mono z-20 w-48 bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none text-center">
                  <div className="text-red-500 font-bold border-b border-neutral-800 pb-1 mb-1 uppercase">
                    {meta.name}
                  </div>
                  <p>{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-neutral-800">
          <div className="text-[11px] text-neutral-400 font-mono uppercase tracking-wider tabular-nums">
            {playerItemCount >= 8 ? 'INVENTORY FULL (8/8)' : `INVENTORY ${playerItemCount}/8`}
          </div>

          <button
            className="btn-rusty px-6 py-2 text-xs font-bold tracking-widest cursor-pointer"
            onClick={onClose}
          >
            RETURN
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
