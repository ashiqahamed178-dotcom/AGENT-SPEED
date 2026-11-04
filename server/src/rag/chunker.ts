// Splits an agreement into clauses and remembers where each one sits in the
// original text. Keeping the exact position means a citation can always point
// back to the real source. It's never a copy the model could have changed.

export type Clause = {
  position: number;
  text: string;
  startOffset: number;
  endOffset: number;
};

const MAX_CLAUSE_CHARS = 900;
const MIN_CLAUSE_CHARS = 40;

// Lines that start a clause: "1.", "2.3", "(a)", "Section 4", "Clause 5", "Article 6".
const CLAUSE_START =
  /^[ \t]*(?:(?:section|clause|article)\s+\d+|\d+(?:\.\d+)*[.)]|\([a-z0-9]{1,3}\))(?=\s)/gim;

type Span = { start: number; end: number };

function trimSpan(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(text.charAt(start))) start += 1;
  while (end > start && /\s/.test(text.charAt(end - 1))) end -= 1;
  return { start, end };
}

function splitAt(positions: number[], span: Span): Span[] {
  const cuts = [span.start, ...positions.filter((p) => p > span.start && p < span.end), span.end];
  return cuts.slice(0, -1).map((start, index) => ({ start, end: cuts[index + 1] as number }));
}

function matchPositions(text: string, pattern: RegExp, useEnd = false): number[] {
  return [...text.matchAll(pattern)].map((match) =>
    useEnd ? match.index + match[0].length : match.index
  );
}

// Group sentences into pieces under the limit. A single sentence that is too
// long is cut at the limit, so no piece can be oversized.
function splitLongSpan(text: string, span: Span): Span[] {
  const sentenceEnds = matchPositions(text.slice(0, span.end), /[.!?;]["')\]]*\s+/g, true);
  const pieces: Span[] = [];
  let current: Span | undefined;

  for (const sentence of splitAt(sentenceEnds, span)) {
    if (current && sentence.end - current.start <= MAX_CLAUSE_CHARS) {
      current.end = sentence.end;
      continue;
    }

    if (current) pieces.push(current);
    current = { ...sentence };

    while (current.end - current.start > MAX_CLAUSE_CHARS) {
      const cut: number = current.start + MAX_CLAUSE_CHARS;
      pieces.push({ start: current.start, end: cut });
      current = { start: cut, end: current.end };
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

export function chunkAgreement(text: string): Clause[] {
  const whole: Span = { start: 0, end: text.length };

  // Prefer the document's own structure: numbered clauses, then paragraphs,
  // then sentences for one long block of text.
  const numbered = matchPositions(text, CLAUSE_START);
  const paragraphs = matchPositions(text, /\n\s*\n/g, true);

  let spans: Span[];

  if (numbered.length >= 2) {
    spans = splitAt(numbered, whole);
  } else if (paragraphs.length >= 1) {
    spans = splitAt(paragraphs, whole);
  } else {
    const sentenceEnds = matchPositions(text, /[.!?;]["')\]]*\s+/g, true);
    spans = splitAt(sentenceEnds, whole);
  }

  const trimmed = spans
    .map((span) => trimSpan(text, span))
    .filter((span) => span.end > span.start)
    .flatMap((span) => (span.end - span.start > MAX_CLAUSE_CHARS ? splitLongSpan(text, span) : [span]))
    .map((span) => trimSpan(text, span))
    .filter((span) => span.end > span.start);

  // A very short piece, like a title, has little meaning alone, so it joins the next one.
  const merged: Span[] = [];
  let pendingStart: number | undefined;

  for (const span of trimmed) {
    const start = pendingStart ?? span.start;
    const length = span.end - start;

    if (length < MIN_CLAUSE_CHARS && span !== trimmed.at(-1)) {
      pendingStart = start;
      continue;
    }

    merged.push({ start, end: span.end });
    pendingStart = undefined;
  }

  return merged.map((span, index) => ({
    position: index + 1,
    text: text.slice(span.start, span.end),
    startOffset: span.start,
    endOffset: span.end
  }));
}
