// Spots text that tries to give orders to an AI. Agreements and evidence are
// written by the parties, so one side could plant instructions there.
//
// This is a simple extra layer, and it can't catch every rewording. Safety
// doesn't depend on it: the AI still has no way to move money.
const PATTERNS = [
  /\bignore\b.{0,30}\binstructions?\b/i,
  /\bdisregard\b.{0,30}\b(instructions?|rules?)\b/i,
  /\bsystem\s+(message|prompt)\b/i,
  /\bnew\s+(policy|instructions?)\s+from\b/i,
  /\b(set|output|return)\b.{0,20}\brecommendation\b/i,
  /\b(ai|assistants?|language models?)\b.{0,40}\b(must|should|shall)\b/i,
  /\byou\s+must\s+(set|recommend|release|approve|say|state)\b/i
];

export function looksLikePromptInjection(...texts: (string | undefined)[]) {
  return texts.some((text) => text !== undefined && PATTERNS.some((pattern) => pattern.test(text)));
}
