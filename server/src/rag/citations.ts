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

// Words that say nothing about a question's topic, including words nearly every
// escrow agreement uses.
const NON_TOPIC_WORDS = new Set(
  `a about an and any are be been before by can could did do does for from get has have how i if in is it its
  long many me much must my no not of on or our shall should so that the their them then there this to under was
  we were what when where which who whom whose why will with would you your
  agreement apply applies buyer seller party parties pay pays paid payment happen happens contract clause`.split(/\s+/)
);

// Compares the start of each word, so "delivered" matches "delivery" and
// "translated" matches "translate", without pulling in a language library.
function wordRoot(word: string) {
  return word
    .replace(/(x|ch|sh|ss)es$/, "$1")
    .replace(/s$/, "")
    .replace(/(ed|ing)$/, "")
    .slice(0, 6);
}

function words(text: string) {
  return text.toLowerCase().replace(/['’]s\b/g, "").match(/[a-z]+/g) ?? [];
}

export function topicWords(question: string) {
  return [...new Set(words(question).filter((word) => !NON_TOPIC_WORDS.has(word)).map(wordRoot))];
}

// A real quote can still be about something else. Asked which country's law
// applies, a small model once quoted the seller's name. A cited clause must
// mention at least half of what the question is about. The check runs in code,
// so it costs no model call and can't be talked out of its answer.
export function citationsCoverQuestion(question: string, clauseTexts: string[]) {
  const topics = topicWords(question);
  if (topics.length === 0) return true;

  const available = new Set(clauseTexts.flatMap(words).map(wordRoot));
  const covered = topics.filter((topic) => available.has(topic)).length;

  return covered * 2 >= topics.length;
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
