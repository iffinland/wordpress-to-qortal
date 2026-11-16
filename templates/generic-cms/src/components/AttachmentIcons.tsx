const common = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false as const };

export function AttachmentIcon(props: { kind: string; ext?: string }) {
  switch (props.kind) {
    case 'audio':
      return <svg {...common}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></svg>;
    case 'video':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></svg>;
    case 'archive':
      return <svg {...common}><path d="M4 7h16v13H4z" /><path d="M3 4h18v3H3z" /><path d="M12 10v6M10 12h4" /></svg>;
    case 'text':
      return <svg {...common}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></svg>;
    default:
      return <svg {...common}><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></svg>;
  }
}

export function PlayIcon() {
  return <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.6)" /><path d="M10 8l6 4-6 4z" fill="#fff" /></svg>;
}
