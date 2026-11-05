type ThemeMode = 'light' | 'dark' | 'system';

const OPTIONS: Array<{ mode: ThemeMode; label: string; short: string }> = [
  { mode: 'light', label: 'Use light theme', short: 'Light' },
  { mode: 'dark', label: 'Use dark theme', short: 'Dark' },
  { mode: 'system', label: 'Follow system theme', short: 'Auto' }
];

export function ThemeToggle(props: { mode: ThemeMode | string; onChange?: (mode: ThemeMode) => void }) {
  const mode = props.mode === 'light' || props.mode === 'dark' ? props.mode : 'system';
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={'theme-toggle__button' + (mode === option.mode ? ' is-active' : '')}
          aria-pressed={mode === option.mode}
          aria-label={option.label}
          onClick={() => props.onChange && props.onChange(option.mode)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}

