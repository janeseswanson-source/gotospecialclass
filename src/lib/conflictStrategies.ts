import { CalendarDays, RefreshCw, Clock, Utensils, PartyPopper, Undo2, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type StrategyCategory = 'rotation' | 'time' | 'slot' | 'grouping' | 'recovery';

export interface StrategyMeta {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  category: StrategyCategory;
}

export const CONFLICT_STRATEGIES: StrategyMeta[] = [
  { key: 'ab_week', icon: CalendarDays, title: 'A/B Week', desc: 'Specialist sees each class every other week.', category: 'rotation' },
  { key: 'aa_bb_week', icon: RefreshCw, title: 'AA/BB Week', desc: 'Specialist sees a class for 2 sessions, then rotates to the next class.', category: 'rotation' },
  { key: 'quick_30', icon: Clock, title: 'Quick 30-Min Class', desc: 'Shorter sessions — assign specific grades (e.g. Kindergarten).', category: 'time' },
  { key: 'lunch_clubs', icon: Utensils, title: 'Lunch Clubs', desc: 'Adds teaching minutes to specialist schedule during lunch.', category: 'slot' },
  { key: 'event_planning', icon: PartyPopper, title: 'Event Planning Blocks', desc: 'Time for school-wide events (Art Show, STEAM Night, etc.).', category: 'slot' },
  { key: 'big_group', icon: Users, title: 'Big Group Split', desc: 'Combine two classes into one large group for a specialist session.', category: 'grouping' },
  { key: 'makeup', icon: Undo2, title: 'Make-Up Sessions', desc: 'Suggest available flex time slots with grade suggestions.', category: 'recovery' },
];

export const getStrategyTitle = (key: string): string =>
  CONFLICT_STRATEGIES.find(s => s.key === key)?.title ?? key;

export const getStrategyCategory = (key: string): StrategyCategory =>
  CONFLICT_STRATEGIES.find(s => s.key === key)?.category ?? 'rotation';

export interface CategoryTheme {
  label: string;
  topBorder: string;
  border: string;
  bg: string;
  pillBg: string;
  pillText: string;
  iconBg: string;
  iconText: string;
  badgeBg: string;
  badgeText: string;
}

// IMPORTANT: All Tailwind classes must be statically listed so the JIT picks them up.
export const CATEGORY_THEME: Record<StrategyCategory, CategoryTheme> = {
  rotation: {
    label: 'Rotation',
    topBorder: 'border-t-blue-500',
    border: 'border-blue-200 dark:border-blue-900/50',
    bg: 'bg-blue-50/60 dark:bg-blue-950/20',
    pillBg: 'bg-blue-100 dark:bg-blue-950/40',
    pillText: 'text-blue-700 dark:text-blue-300',
    iconBg: 'bg-blue-100 dark:bg-blue-950/40',
    iconText: 'text-blue-700 dark:text-blue-300',
    badgeBg: 'bg-blue-600',
    badgeText: 'text-white',
  },
  time: {
    label: 'Time',
    topBorder: 'border-t-orange-500',
    border: 'border-orange-200 dark:border-orange-900/50',
    bg: 'bg-orange-50/60 dark:bg-orange-950/20',
    pillBg: 'bg-orange-100 dark:bg-orange-950/40',
    pillText: 'text-orange-700 dark:text-orange-300',
    iconBg: 'bg-orange-100 dark:bg-orange-950/40',
    iconText: 'text-orange-700 dark:text-orange-300',
    badgeBg: 'bg-orange-600',
    badgeText: 'text-white',
  },
  slot: {
    label: 'Slot',
    topBorder: 'border-t-emerald-500',
    border: 'border-emerald-200 dark:border-emerald-900/50',
    bg: 'bg-emerald-50/60 dark:bg-emerald-950/20',
    pillBg: 'bg-emerald-100 dark:bg-emerald-950/40',
    pillText: 'text-emerald-700 dark:text-emerald-300',
    iconBg: 'bg-emerald-100 dark:bg-emerald-950/40',
    iconText: 'text-emerald-700 dark:text-emerald-300',
    badgeBg: 'bg-emerald-600',
    badgeText: 'text-white',
  },
  grouping: {
    label: 'Grouping',
    topBorder: 'border-t-purple-500',
    border: 'border-purple-200 dark:border-purple-900/50',
    bg: 'bg-purple-50/60 dark:bg-purple-950/20',
    pillBg: 'bg-purple-100 dark:bg-purple-950/40',
    pillText: 'text-purple-700 dark:text-purple-300',
    iconBg: 'bg-purple-100 dark:bg-purple-950/40',
    iconText: 'text-purple-700 dark:text-purple-300',
    badgeBg: 'bg-purple-600',
    badgeText: 'text-white',
  },
  recovery: {
    label: 'Recovery',
    topBorder: 'border-t-amber-500',
    border: 'border-amber-200 dark:border-amber-900/50',
    bg: 'bg-amber-50/60 dark:bg-amber-950/20',
    pillBg: 'bg-amber-100 dark:bg-amber-950/40',
    pillText: 'text-amber-700 dark:text-amber-300',
    iconBg: 'bg-amber-100 dark:bg-amber-950/40',
    iconText: 'text-amber-700 dark:text-amber-300',
    badgeBg: 'bg-amber-600',
    badgeText: 'text-white',
  },
};

export const getCategoryTheme = (key: string): CategoryTheme =>
  CATEGORY_THEME[getStrategyCategory(key)];
