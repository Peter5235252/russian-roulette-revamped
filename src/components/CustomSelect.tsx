import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { IndustrialScrollArea } from "./IndustrialScrollArea";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  description?: string;
  colorClass?: string;
  badge?: string;
}

export interface CustomSelectProps<T extends string | number = string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  optionClassName?: string;
  disabled?: boolean;
  align?: "left" | "right" | "center";
  showIndustrialScrollbar?: boolean;
}

export function CustomSelect<T extends string | number = string>({
  options,
  value,
  onChange,
  label,
  placeholder = "Select option...",
  className = "",
  buttonClassName = "",
  optionClassName = "",
  disabled = false,
  align = "left",
  showIndustrialScrollbar = true,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    options.find((opt) => opt.value === value) || options[0];

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const currentIndex = options.findIndex((opt) => opt.value === value);
      if (e.key === "ArrowDown") {
        const nextIndex = (currentIndex + 1) % options.length;
        onChange(options[nextIndex].value);
      } else {
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        onChange(options[prevIndex].value);
      }
    }
  };

  return (
    <div
      className={`relative w-full text-left font-mono ${className}`}
      ref={containerRef}
    >
      {label && (
        <label className={`block font-mono uppercase text-xs font-bold mb-1.5 tracking-wider ${
          disabled ? 'text-neutral-500 opacity-70' : 'text-neutral-400'
        }`}>
          {label}
        </label>
      )}

      {/* Main Trigger Button */}
      <button role="combobox"
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
          }
        }}
        onKeyDown={handleKeyDown}
        className={`w-full min-h-[42px] border transition-colors duration-150 rounded-none px-3 py-2 flex items-center justify-between gap-3 text-xs tracking-wider outline-none ${
          disabled
            ? "bg-[#0a0a0c] border-neutral-900 text-neutral-600 opacity-50 cursor-not-allowed"
            : isOpen
              ? "bg-[#0d0d10] border-red-800 text-white cursor-pointer"
              : "bg-[#0d0d10] border-neutral-800 hover:border-neutral-600 text-neutral-200 cursor-pointer"
        } ${buttonClassName}`}
      >
        <div className="flex items-center gap-2 truncate">
          <span
            className={`truncate font-bold tracking-wider ${
              selectedOption?.colorClass || "text-neutral-200"
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="text-[10px] text-neutral-400 font-mono">
              {selectedOption.badge}
            </span>
          )}
        </div>

        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="text-neutral-400 flex-shrink-0"
        >
          <ChevronDown
            className={`w-4 h-4 ${isOpen ? "text-red-500" : "text-neutral-500"}`}
          />
        </motion.div>
      </button>

      {/* Industrial Dropdown Options Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className={`absolute left-0 right-0 mt-1 z-50 frosted-glass-options-dropdown border border-neutral-700 overflow-hidden ${
              align === "right" ? "right-0 left-auto" : ""
            }`}
          >

            {showIndustrialScrollbar ? (
              <IndustrialScrollArea
                className="max-h-60"
                viewportClassName="p-1 space-y-0.5"
                showSteppers={false}
              >
                {options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button role="combobox"
                      key={String(option.value)}
                      type="button"

                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                        isSelected
                          ? "frosted-glass-option-selected text-white font-bold"
                          : "frosted-glass-option-item text-neutral-200 hover:text-white"
                      } ${optionClassName}`}
                    >
                      <div className="flex flex-col gap-0.5 truncate">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={`truncate tracking-wider ${option.colorClass || ""}`}
                          >
                            {option.label}
                          </span>
                          {option.badge && (
                            <span className="text-[9px] bg-red-950/80 text-red-400 border border-red-800 px-1 py-0.2 font-mono">
                              {option.badge}
                            </span>
                          )}
                        </div>
                        {option.description && (
                          <span className="text-[10px] text-neutral-300/80 font-sans tracking-normal font-normal">
                            {option.description}
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-red-400 flex-shrink-0 ml-1 stroke-[3]" />
                      )}
                    </button>
                  );
                })}
              </IndustrialScrollArea>
            ) : (
              <div className="max-h-60 overflow-y-auto p-1 space-y-0.5 hide-scrollbar">
                {options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button role="combobox"
                      key={String(option.value)}
                      type="button"

                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-xs cursor-pointer ${
                        isSelected
                          ? "frosted-glass-option-selected text-white font-bold"
                          : "frosted-glass-option-item text-neutral-200 hover:text-white"
                      } ${optionClassName}`}
                    >
                      <div className="flex flex-col gap-0.5 truncate">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={`truncate tracking-wider ${option.colorClass || ""}`}
                          >
                            {option.label}
                          </span>
                          {option.badge && (
                            <span className="text-[9px] bg-red-950/80 text-red-400 border border-red-800 px-1 py-0.2 font-mono">
                              {option.badge}
                            </span>
                          )}
                        </div>
                        {option.description && (
                          <span className="text-[10px] text-neutral-300/80 font-sans tracking-normal font-normal">
                            {option.description}
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-red-400 flex-shrink-0 ml-1 stroke-[3]" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
