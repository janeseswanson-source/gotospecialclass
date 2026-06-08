import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

export function CsvIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
      <rect x="3" y="2" width="18" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="7" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1" />
      <line x1="7" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1" />
      <line x1="7" y1="15" x2="17" y2="15" stroke="currentColor" strokeWidth="1" />
      <line x1="7" y1="19" x2="17" y2="19" stroke="currentColor" strokeWidth="1" />
      <line x1="10" y1="5" x2="10" y2="21" stroke="currentColor" strokeWidth="1" />
      <line x1="14" y1="5" x2="14" y2="21" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function PdfIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
      <path d="M4 3a1 1 0 011-1h9l6 6v13a1 1 0 01-1 1H5a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="8" y1="16" x2="14" y2="16" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="8" y1="19" x2="12" y2="19" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function DocIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
      <rect x="3" y="2" width="18" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="7" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="11" x2="17" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="15" x2="14" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="19" x2="11" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SlideIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <rect x="6" y="10" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <line x1="13" y1="11" x2="18" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="13" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
