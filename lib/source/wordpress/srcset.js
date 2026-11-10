/**
 * Parse HTML srcset candidates without mistaking commas inside a URL for
 * candidate separators. WordPress/NASA emits image-resize URLs such as
 * `...?resize=1024,683 1024w`; splitting that string on every comma turns
 * the height (`683`) into a second relative URL.
 *
 * This deliberately returns only the candidate URL and its descriptor. It is
 * not a URL validator: callers still apply their normal URL policy.
 */
function candidateFrom(value) {
  const match = /^(\S+)(?:\s+(.+))?$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const url = match[1];
  // A bare responsive-image dimension is never a useful URL candidate. This
  // is also what lets `?resize=300,200 300w` remain one candidate.
  if (/^\d+(?:\.\d+)?(?:w|h|x)?$/i.test(url)) return null;
  return { url, descriptor: match[2]?.trim() || null };
}

export function parseSrcset(value) {
  const fragments = String(value ?? '').split(',');
  const candidates = [];
  let buffered = '';

  const flush = () => {
    const candidate = candidateFrom(buffered);
    if (candidate) candidates.push(candidate);
    buffered = '';
  };

  for (const fragment of fragments) {
    const trimmed = fragment.trim();
    if (!trimmed) continue;
    if (!buffered) {
      buffered = trimmed;
      continue;
    }

    const previous = candidateFrom(buffered);
    const next = candidateFrom(trimmed);
    // A completed candidate is always followed by a new one. A descriptorless
    // candidate may also be followed by a new URL; a numeric next token is a
    // width/height component of a comma-bearing URL, not a new candidate.
    if (previous?.descriptor || next) {
      flush();
      buffered = trimmed;
    } else {
      buffered += ',' + trimmed;
    }
  }
  flush();
  return candidates;
}
