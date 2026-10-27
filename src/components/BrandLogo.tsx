import React, { useState } from 'react';
import logoMarkImg from '../assets/images/trustgraph_logo_mark_1793068388846.jpg';

interface BrandLogoProps {
  theme?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  theme = 'dark',
  size = 'md',
  showWordmark = true,
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const boxSizeClass =
    size === 'sm'
      ? 'w-7 h-7 rounded-md'
      : size === 'lg'
      ? 'w-10 h-10 rounded-xl'
      : 'w-8 h-8 rounded-lg';

  const textSizeClass =
    size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-lg';

  const wordmarkColorClass = theme === 'dark' ? 'text-white' : 'text-[#0C100C]';
  const borderClass =
    theme === 'dark' ? 'border border-white/15' : 'border border-[#0C100C]/15';

  return (
    <span
      className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none ${className}`}
    >
      <span
        className={`relative inline-flex items-center justify-center overflow-hidden bg-[#0C100C] ${borderClass} ${boxSizeClass} shrink-0`}
      >
        {!imgFailed ? (
          <img
            src={logoMarkImg}
            alt="TrustGraph hexagonal node emblem"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover scale-[1.32]"
          />
        ) : (
          <svg
            viewBox="0 0 64 64"
            className="w-5 h-5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <polygon
              points="32,10 51,21 51,43 32,54 13,43 13,21"
              stroke="#CCFF00"
              strokeWidth="5"
              strokeLinejoin="miter"
            />
            <line x1="32" y1="12" x2="32" y2="32" stroke="#CCFF00" strokeWidth="5" />
            <line x1="14" y1="42" x2="32" y2="32" stroke="#CCFF00" strokeWidth="5" />
            <line x1="50" y1="42" x2="32" y2="32" stroke="#CCFF00" strokeWidth="5" />
            <polygon points="32,5 38,8.5 38,15.5 32,19 26,15.5 26,8.5" fill="#CCFF00" />
            <polygon points="13,36 19,39.5 19,46.5 13,50 7,46.5 7,39.5" fill="#CCFF00" />
            <polygon points="51,36 57,39.5 57,46.5 51,50 45,46.5 45,39.5" fill="#CCFF00" />
            <polygon points="32,28 35.5,30 35.5,34 32,36 28.5,34 28.5,30" fill="#FFFFFF" />
          </svg>
        )}
      </span>

      {showWordmark && (
        <span
          className={`${textSizeClass} font-bold tracking-tight font-display ${wordmarkColorClass}`}
        >
          TrustGraph
        </span>
      )}
    </span>
  );
};
