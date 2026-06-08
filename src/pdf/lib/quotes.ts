const QUOTES = [
  '"Teaching is the greatest act of optimism." — Colleen Wilcox',
  '"A teacher affects eternity; he can never tell where his influence stops." — Henry Adams',
  '"The art of teaching is the art of assisting discovery." — Mark Van Doren',
  '"Children are not vessels to be filled but lamps to be lit." — Plutarch',
  '"What we learn with pleasure we never forget." — Alfred Mercier',
  '"Tell me and I forget. Teach me and I remember. Involve me and I learn." — Benjamin Franklin',
  '"Education is the kindling of a flame, not the filling of a vessel." — Socrates',
  '"A good teacher is like a candle—it consumes itself to light the way for others." — Mustafa Kemal Atatürk',
  '"The best teachers teach from the heart, not from the book." — Anonymous',
  '"Every child deserves a champion." — Rita Pierson',
];

export function pickQuoteForWeek(monday: Date): string {
  const weekIdx = Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000));
  return QUOTES[((weekIdx % QUOTES.length) + QUOTES.length) % QUOTES.length];
}
