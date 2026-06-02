export function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalized = query.trim();
  if (!normalized) return <>{text}</>;

  const index = text.toLowerCase().indexOf(normalized.toLowerCase());
  if (index < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + normalized.length)}</mark>
      {text.slice(index + normalized.length)}
    </>
  );
}
