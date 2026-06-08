export function abbrevSubject(subject?: string | null): string {
  if (!subject) return '';
  const s = subject.toLowerCase();
  if (s.startsWith('art')) return 'Art';
  if (s.startsWith('mus')) return 'Mus';
  if (s.startsWith('pe') || s.includes('phys')) return 'PE';
  if (s.startsWith('tech') || s.includes('comp')) return 'Tech';
  if (s.startsWith('sci')) return 'Sci';
  if (s.startsWith('enr')) return 'Enr';
  if (s.startsWith('lib')) return 'Lib';
  if (s.startsWith('span') || s.includes('lang')) return 'Lang';
  return subject.slice(0, 4);
}

export function lastName(name?: string | null): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}
