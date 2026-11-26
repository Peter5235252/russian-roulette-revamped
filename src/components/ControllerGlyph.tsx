import React from 'react';
import { ControllerLayout } from '../controller';

export type ControllerGlyphRole =
  | 'confirm'
  | 'cancel'
  | 'west'
  | 'north'
  | 'lb'
  | 'rb'
  | 'lt'
  | 'rt'
  | 'dpad'
  | 'dpad_lr'
  | 'dpad_ud'
  | 'lstick'
  | 'rstick'
  | 'select'
  | 'start';

export type ControllerGlyphSize = 'xs' | 'sm' | 'md' | 'lg';

export const CONTROLLER_LAYOUT_META: Record<
  ControllerLayout,
  {
    name: string;
    shortName: string;
    subtitle: string;
    buttons: {
      top: { label: string; color: string; text: string };
      right: { label: string; color: string; text: string };
      bottom: { label: string; color: string; text: string };
      left: { label: string; color: string; text: string };
    };
  }
> = {
  xbox: {
    name: 'Xbox',
    shortName: 'XBOX',
    subtitle: 'Green A · Red B · Blue X · Yellow Y',
    buttons: {
      top: { label: 'Y', color: '#FFD600', text: '#09090b' },
      right: { label: 'B', color: '#E81123', text: '#ffffff' },
      bottom: { label: 'A', color: '#107C10', text: '#ffffff' },
      left: { label: 'X', color: '#3A96DD', text: '#ffffff' },
    },
  },
  playstation: {
    name: 'PlayStation',
    shortName: 'PS',
    subtitle: 'Sky Cross · Coral Circle · Pink Square · Mint Triangle',
    buttons: {
      top: { label: '△', color: '#3EE3A1', text: '#3EE3A1' },
      right: { label: '○', color: '#FF6666', text: '#FF6666' },
      bottom: { label: '✕', color: '#7DB3E9', text: '#7DB3E9' },
      left: { label: '□', color: '#FF69F8', text: '#FF69F8' },
    },
  },
  nintendo: {
    name: 'Nintendo',
    shortName: 'NINTENDO',
    subtitle: 'Red A (Confirm) · Yellow B · Blue X · Green Y',
    buttons: {
      top: { label: 'X', color: '#0749B4', text: '#ffffff' },
      right: { label: 'A', color: '#EB1A1D', text: '#ffffff' },
      bottom: { label: 'B', color: '#FECE15', text: '#111111' },
      left: { label: 'Y', color: '#008D45', text: '#ffffff' },
    },
  },
  universal: {
    name: 'Universal',
    shortName: 'UNIV',
    subtitle: 'Neutral directional face diamond · L1 / R1 / L2 / R2',
    buttons: {
      top: { label: '▲', color: '#a1a1aa', text: '#f4f4f5' },
      right: { label: '▶', color: '#a1a1aa', text: '#f4f4f5' },
      bottom: { label: '▼', color: '#e4e4e7', text: '#111111' },
      left: { label: '◀', color: '#a1a1aa', text: '#f4f4f5' },
    },
  },
};

const SIZE_MAP: Record<ControllerGlyphSize, { px: number; font: number; capPad: string; capFont: number }> = {
  xs: { px: 14, font: 8, capPad: '1px 4px', capFont: 8 },
  sm: { px: 16, font: 9, capPad: '1.5px 5px', capFont: 8.5 },
  md: { px: 19, font: 10, capPad: '2px 6px', capFont: 9 },
  lg: { px: 25, font: 12, capPad: '3px 7px', capFont: 10 },
};

function getShoulderLabel(role: ControllerGlyphRole, layout: ControllerLayout): string | null {
  switch (role) {
    case 'lb':
      return layout === 'xbox' ? 'LB' : layout === 'nintendo' ? 'L' : 'L1';
    case 'rb':
      return layout === 'xbox' ? 'RB' : layout === 'nintendo' ? 'R' : 'R1';
    case 'lt':
      return layout === 'xbox' ? 'LT' : layout === 'nintendo' ? 'ZL' : 'L2';
    case 'rt':
      return layout === 'xbox' ? 'RT' : layout === 'nintendo' ? 'ZR' : 'R2';
    case 'dpad':
      return 'D-PAD';
    case 'dpad_lr':
      return 'D-PAD ◀/▶';
    case 'dpad_ud':
      return 'D-PAD ▲/▼';
    case 'lstick':
      return 'L-STICK';
    case 'rstick':
      return 'R-STICK';
    case 'select':
      return layout === 'xbox' ? 'VIEW' : layout === 'playstation' ? 'SHARE' : layout === 'nintendo' ? '−' : 'BACK';
    case 'start':
      return layout === 'xbox' ? 'MENU' : layout === 'playstation' ? 'OPT' : layout === 'nintendo' ? '+' : 'MENU';
    default:
      return null;
  }
}

function getFaceVisual(
  role: 'confirm' | 'cancel' | 'west' | 'north',
  layout: ControllerLayout
): {
  bg: string;
  border: string;
  bottomBorder: string;
  color: string;
  shadow: string;
  label: string;
  psShape?: 'cross' | 'circle' | 'square' | 'triangle';
  univPos?: 'bottom' | 'right' | 'left' | 'top';
} {
  if (layout === 'xbox') {
    switch (role) {
      case 'confirm':
        return {
          bg: 'linear-gradient(145deg, #26C454 0%, #107C10 55%, #095209 100%)',
          border: '#199E19',
          bottomBorder: '#073B07',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.4)',
          label: 'A',
        };
      case 'cancel':
        return {
          bg: 'linear-gradient(145deg, #FF4B5A 0%, #E81123 55%, #9B0915 100%)',
          border: '#FF5C69',
          bottomBorder: '#6B050D',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.4)',
          label: 'B',
        };
      case 'west':
        return {
          bg: 'linear-gradient(145deg, #62B4F2 0%, #3A96DD 55%, #1F67A0 100%)',
          border: '#72BDF5',
          bottomBorder: '#154770',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.4)',
          label: 'X',
        };
      case 'north':
        return {
          bg: 'linear-gradient(145deg, #FFE659 0%, #FFD600 55%, #C99D00 100%)',
          border: '#FFE970',
          bottomBorder: '#8C6C00',
          color: '#09090b',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.65)',
          label: 'Y',
        };
    }
  }

  if (layout === 'nintendo') {
    switch (role) {
      case 'confirm':
        // Nintendo A is Red (#EB1A1D) on the Right position
        return {
          bg: 'linear-gradient(145deg, #FF494C 0%, #EB1A1D 55%, #A60F12 100%)',
          border: '#FF6366',
          bottomBorder: '#70080A',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.42)',
          label: 'A',
        };
      case 'cancel':
        // Nintendo B is Yellow (#FECE15) on the Bottom position
        return {
          bg: 'linear-gradient(145deg, #FFE159 0%, #FECE15 55%, #C49B04 100%)',
          border: '#FFE87A',
          bottomBorder: '#8A6B02',
          color: '#111111',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.65)',
          label: 'B',
        };
      case 'west':
        // Nintendo Y is Green (#008D45) on the Left position
        return {
          bg: 'linear-gradient(145deg, #1EB868 0%, #008D45 55%, #005C2C 100%)',
          border: '#34D17E',
          bottomBorder: '#003D1D',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.38)',
          label: 'Y',
        };
      case 'north':
        // Nintendo X is Blue (#0749B4) on the Top position
        return {
          bg: 'linear-gradient(145deg, #2A71E0 0%, #0749B4 55%, #042E75 100%)',
          border: '#4D8FF2',
          bottomBorder: '#021E4F',
          color: '#ffffff',
          shadow: '0 1.5px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.38)',
          label: 'X',
        };
    }
  }

  if (layout === 'playstation') {
    switch (role) {
      case 'confirm':
        return {
          bg: 'radial-gradient(circle at 35% 30%, #272b36 0%, #15171e 70%, #0d0e13 100%)',
          border: '#3e5e80',
          bottomBorder: '#08090c',
          color: '#7DB3E9',
          shadow: '0 1.5px 4px rgba(0,0,0,0.65), 0 0 6px rgba(125,179,233,0.28)',
          label: '✕',
          psShape: 'cross',
        };
      case 'cancel':
        return {
          bg: 'radial-gradient(circle at 35% 30%, #2b2327 0%, #171417 70%, #0e0c0e 100%)',
          border: '#7d3a3c',
          bottomBorder: '#08090c',
          color: '#FF6666',
          shadow: '0 1.5px 4px rgba(0,0,0,0.65), 0 0 6px rgba(255,102,102,0.28)',
          label: '○',
          psShape: 'circle',
        };
      case 'west':
        return {
          bg: 'radial-gradient(circle at 35% 30%, #2a232d 0%, #17141a 70%, #0e0c10 100%)',
          border: '#7d3c7a',
          bottomBorder: '#08090c',
          color: '#FF69F8',
          shadow: '0 1.5px 4px rgba(0,0,0,0.65), 0 0 6px rgba(255,105,248,0.26)',
          label: '□',
          psShape: 'square',
        };
      case 'north':
        return {
          bg: 'radial-gradient(circle at 35% 30%, #202b28 0%, #121817 70%, #0b0e0e 100%)',
          border: '#2d755a',
          bottomBorder: '#08090c',
          color: '#3EE3A1',
          shadow: '0 1.5px 4px rgba(0,0,0,0.65), 0 0 6px rgba(62,227,161,0.26)',
          label: '△',
          psShape: 'triangle',
        };
    }
  }

  // Universal: dark industrial circular cap with directional face diamond SVG
  const univPosMap: Record<'confirm' | 'cancel' | 'west' | 'north', 'bottom' | 'right' | 'left' | 'top'> = {
    confirm: 'bottom',
    cancel: 'right',
    west: 'left',
    north: 'top',
  };
  return {
    bg: 'linear-gradient(145deg, #27272e 0%, #17171c 60%, #101014 100%)',
    border: role === 'confirm' ? '#d4d4d8' : role === 'cancel' ? '#ef4444' : '#52525b',
    bottomBorder: '#09090b',
    color: role === 'cancel' ? '#f87171' : '#f4f4f5',
    shadow: '0 1.5px 4px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
    label: '',
    univPos: univPosMap[role],
  };
}

function renderPsSvg(shape: 'cross' | 'circle' | 'square' | 'triangle', color: string, size: number) {
  const iconPx = Math.max(9, Math.round(size * 0.62));
  if (shape === 'cross') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 16 16" fill="none">
        <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (shape === 'circle') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="4.8" stroke={color} strokeWidth="2.2" />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg width={iconPx} height={iconPx} viewBox="0 0 16 16" fill="none">
        <rect x="3.5" y="3.5" width="9" height="9" rx="0.8" stroke={color} strokeWidth="2.2" />
      </svg>
    );
  }
  return (
    <svg width={iconPx} height={iconPx} viewBox="0 0 16 16" fill="none">
      <path d="M8 2.8L13 12.2H3L8 2.8Z" stroke={color} strokeWidth="2.1" strokeLinejoin="round" />
    </svg>
  );
}

function renderUniversalDiamondSvg(active: 'bottom' | 'right' | 'left' | 'top', activeColor: string, size: number) {
  const iconPx = Math.max(10, Math.round(size * 0.68));
  const dot = (pos: 'bottom' | 'right' | 'left' | 'top', cx: number, cy: number) => (
    <circle
      cx={cx}
      cy={cy}
      r={active === pos ? 2.5 : 1.45}
      fill={active === pos ? activeColor : '#52525b'}
    />
  );
  return (
    <svg width={iconPx} height={iconPx} viewBox="0 0 16 16" fill="none">
      {dot('top', 8, 3.1)}
      {dot('right', 12.9, 8)}
      {dot('bottom', 8, 12.9)}
      {dot('left', 3.1, 8)}
    </svg>
  );
}

export interface ControllerGlyphProps {
  role: ControllerGlyphRole;
  layout?: ControllerLayout;
  size?: ControllerGlyphSize;
  className?: string;
}

export function ControllerGlyph({
  role,
  layout = 'xbox',
  size = 'md',
  className = '',
}: ControllerGlyphProps) {
  const safeLayout: ControllerLayout = layout;
  const dims = SIZE_MAP[size];
  const shoulderLabel = getShoulderLabel(role, safeLayout);

  if (shoulderLabel !== null) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-[4px] font-mono font-bold text-neutral-100 select-none leading-none whitespace-nowrap ${className}`}
        style={{
          padding: dims.capPad,
          fontSize: `${dims.capFont}px`,
          background: 'linear-gradient(180deg, #4b5563 0%, #374151 48%, #1f2937 100%)',
          border: '1px solid #18181b',
          borderBottom: '2px solid #09090b',
          boxShadow: '0 1.5px 3px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.16)',
        }}
      >
        {shoulderLabel}
      </span>
    );
  }

  const face = getFaceVisual(role as 'confirm' | 'cancel' | 'west' | 'north', safeLayout);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-sans font-extrabold select-none leading-none shrink-0 ${className}`}
      style={{
        width: `${dims.px}px`,
        height: `${dims.px}px`,
        fontSize: `${dims.font}px`,
        background: face.bg,
        border: `1px solid ${face.border}`,
        borderBottom: `${size === 'lg' ? 3 : 2}px solid ${face.bottomBorder}`,
        boxShadow: face.shadow,
        color: face.color,
      }}
    >
      {face.psShape
        ? renderPsSvg(face.psShape, face.color, dims.px)
        : face.univPos
        ? renderUniversalDiamondSvg(face.univPos, face.color, dims.px)
        : face.label}
    </span>
  );
};

export function getControllerGlyphHtml(
  role: ControllerGlyphRole,
  layout: ControllerLayout = 'xbox',
  size: ControllerGlyphSize = 'xs'
): string {
  const dims = SIZE_MAP[size];
  const shoulderLabel = getShoulderLabel(role, layout);
  if (shoulderLabel !== null) {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;border-radius:4px;font-family:var(--font-mono),monospace;font-weight:700;color:#f4f4f5;padding:${dims.capPad};font-size:${dims.capFont}px;line-height:1;background:linear-gradient(180deg,#4b5563 0%,#374151 48%,#1f2937 100%);border:1px solid #18181b;border-bottom:2px solid #09090b;box-shadow:0 1.5px 3px rgba(0,0,0,0.55);vertical-align:middle;margin:0 3px;">${shoulderLabel}</span>`;
  }

  const face = getFaceVisual(role as 'confirm' | 'cancel' | 'west' | 'north', layout);
  const iconPx = Math.max(9, Math.round(dims.px * 0.62));
  let inner = face.label;
  if (face.psShape === 'cross') {
    inner = `<svg width="${iconPx}" height="${iconPx}" viewBox="0 0 16 16" fill="none"><path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="${face.color}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  } else if (face.psShape === 'circle') {
    inner = `<svg width="${iconPx}" height="${iconPx}" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="4.8" stroke="${face.color}" stroke-width="2.2"/></svg>`;
  } else if (face.psShape === 'square') {
    inner = `<svg width="${iconPx}" height="${iconPx}" viewBox="0 0 16 16" fill="none"><rect x="3.5" y="3.5" width="9" height="9" rx="0.8" stroke="${face.color}" stroke-width="2.2"/></svg>`;
  } else if (face.psShape === 'triangle') {
    inner = `<svg width="${iconPx}" height="${iconPx}" viewBox="0 0 16 16" fill="none"><path d="M8 2.8L13 12.2H3L8 2.8Z" stroke="${face.color}" stroke-width="2.1" stroke-linejoin="round"/></svg>`;
  } else if (face.univPos) {
    const uPx = Math.max(10, Math.round(dims.px * 0.68));
    const rT = face.univPos === 'top' ? 2.5 : 1.45;
    const rR = face.univPos === 'right' ? 2.5 : 1.45;
    const rB = face.univPos === 'bottom' ? 2.5 : 1.45;
    const rL = face.univPos === 'left' ? 2.5 : 1.45;
    inner = `<svg width="${uPx}" height="${uPx}" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3.1" r="${rT}" fill="${face.univPos === 'top' ? face.color : '#52525b'}"/><circle cx="12.9" cy="8" r="${rR}" fill="${face.univPos === 'right' ? face.color : '#52525b'}"/><circle cx="8" cy="12.9" r="${rB}" fill="${face.univPos === 'bottom' ? face.color : '#52525b'}"/><circle cx="3.1" cy="8" r="${rL}" fill="${face.univPos === 'left' ? face.color : '#52525b'}"/></svg>`;
  }

  return `<span style="display:inline-flex;align-items:center;justify-content:center;border-radius:9999px;width:${dims.px}px;height:${dims.px}px;font-size:${dims.font}px;font-weight:800;line-height:1;color:${face.color};background:${face.bg};border:1px solid ${face.border};border-bottom:2px solid ${face.bottomBorder};box-shadow:${face.shadow};vertical-align:middle;margin:0 3px;">${inner}</span>`;
}
