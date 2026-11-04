// A model can invent a citation as easily as it can invent a fact, so citations
// are checked in code. A citation only counts if the quoted words really appear
// in the clause it names, and that clause was actually given to the model.

export type ProposedCitation = { clauseId: string; quote: string };

export type RetrievedClause = {
  clauseId: string;
  text: string;
  startOffset: number;
  endOffset: number;
};

export type VerifiedCitation = {
  clauseId: string;
  quote: string;
  clauseText: string;
  startOffset: number;
  endOffset: number;
};

const MIN_QUOTE_CHARS = 8;

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyCitations(proposed: ProposedCitation[], retrieved: RetrievedClause[]) {
  const verified: VerifiedCitation[] = [];
  const rejected: ProposedCitation[] = [];
  const seen = new Set<string>();

  for (const citation of proposed) {
    const clause = retrieved.find((item) => item.clauseId === citation.clauseId);
    const quote = normalize(citation.quote);

    if (!clause || quote.length < MIN_QUOTE_CHARS || !normalize(clause.text).includes(quote)) {
      rejected.push(citation);
      continue;
    }

    const key = `${citation.clauseId}:${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);

    verified.push({
      clauseId: clause.clauseId,
      quote: citation.quote,
      clauseText: clause.text,
      startOffset: clause.startOffset,
      endOffset: clause.endOffset
    });
  }

  return { verified, rejected };
}
