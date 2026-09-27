import React from 'react';
import { Sun, Moon, Leaf } from 'lucide-react';
import { useTheme, ThemeMode } from '../context/ThemeContext';

export const ThemeSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { theme, setTheme } = useTheme();

  const themeConfig: Record<ThemeMode, { label: string; icon: React.ReactNode; next: ThemeMode; tooltip: string }> = {
    light: {
      label: 'Light',
      icon: <Sun className="w-3.5 h-3.5 text-amber-500" />,
      next: 'dark',
      tooltip: 'Current: Light Mode — Click to switch to Dark Mode',
    },
    dark: {
      label: 'Dark',
      icon: <Moon className="w-3.5 h-3.5 text-blue-400" />,
      next: 'earth',
      tooltip: 'Current: Dark Mode — Click to switch to Earth Tone Mode',
    },
    earth: {
      label: 'Earth',
      icon: <Leaf className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />,
      next: 'light',
      tooltip: 'Current: Earth Tone Mode — Click to switch to Light Mode',
    },
  };

  const current = themeConfig[theme] || themeConfig.dark;

  const handleToggle = () => {
    setTheme(current.next);
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        className="p-2 rounded-xl bg-card hover:bg-muted border border-border text-foreground transition-all flex items-center justify-center shadow-sm hover:border-primary/40 active:scale-95"
        title={current.tooltip}
        aria-label={`Toggle theme (currently ${current.label})`}
      >
        {current.icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-card hover:bg-muted border border-border text-foreground text-xs font-medium shadow-sm transition-all hover:border-primary/40 active:scale-95 group"
      title={current.tooltip}
      aria-label={`Toggle theme (currently ${current.label})`}
    >
      <span className="p-1 rounded-lg bg-muted flex items-center justify-center transition-transform group-hover:rotate-12">
        {current.icon}
      </span>
      <span className="font-semibold">{current.label}</span>
      <span className="text-[10px] text-muted-foreground font-normal">
        Theme
      </span>
    </button>
  );
};
