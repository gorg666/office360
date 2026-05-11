import { searchMessages, type SearchResult } from "@/services/db/search";
import { askInbox as callAskInbox } from "./aiService";
import { getLocalizedFallback } from "./language";

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "what", "which",
  "who", "whom", "this", "that", "these", "those", "am", "about", "up",
  "my", "me", "i", "we", "our", "you", "your", "he", "she", "it", "they",
  "them", "his", "her", "its", "and", "but", "or", "nor", "not", "so",
  "very", "just", "also", "any", "each", "every", "all", "both", "few",
  "more", "most", "some", "such", "no", "only", "own", "same", "than",
  "too", "if", "tell", "know", "find", "get", "got",

  "найди", "найти", "найдите", "поищи", "поищите", "ищи", "искать",
  "покажи", "покажите", "открой", "откройте", "дай", "дайте", "скажи",
  "расскажи", "нужно", "надо", "хочу", "можно", "пожалуйста",
  "письмо", "письма", "письме", "письму", "письмом", "писем", "письм",
  "сообщение", "сообщения", "сообщении", "сообщению", "сообщений",
  "переписка", "переписку", "переписке", "переписки",
  "почта", "почте", "почту", "почты", "ящик", "ящике", "ящика",
  "с", "со", "в", "во", "на", "по", "о", "об", "обо", "про", "для", "к", "ко",
  "от", "до", "из", "у", "за", "при", "и", "или", "а", "но", "что", "чтобы",
  "который", "которая", "которое", "которые", "где", "когда", "как", "какой",
  "какая", "какое", "какие", "это", "этот", "эта", "эти", "тот", "та", "те",
]);

const WEAK_FALLBACK_TERMS = new Set(["данн", "информац", "сведен"]);

const RUSSIAN_ENDINGS = [
  "иями", "ями", "ами", "ными", "ыми", "ими", "ого", "его", "ому", "ему",
  "ая", "яя", "ое", "ее", "ые", "ие", "ой", "ей", "ый", "ий", "ам", "ям",
  "ах", "ях", "ов", "ев", "ом", "ем", "ым", "им", "ых", "их", "ую", "юю",
  "а", "я", "ы", "и", "у", "ю", "е", "о",
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function tokenize(question: string): string[] {
  return question
    .replace(/ё/g, "е")
    .replace(/Ё/g, "Е")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeRussianToken(token: string): string {
  if (token.startsWith("паспорт")) return "паспорт";
  if (token.startsWith("данн")) return "данн";

  for (const ending of RUSSIAN_ENDINGS) {
    if (token.length - ending.length >= 4 && token.endsWith(ending)) {
      return token.slice(0, -ending.length);
    }
  }

  return token;
}

function normalizeToken(token: string): string {
  const lower = token.toLowerCase().replace(/ё/g, "е");
  if (/[а-я]/.test(lower)) {
    return normalizeRussianToken(lower);
  }
  return lower;
}

function extractSearchTokens(question: string): string[] {
  return unique(
    tokenize(question)
      .map((token) => ({ raw: token.toLowerCase(), normalized: normalizeToken(token) }))
      .filter(({ raw, normalized }) =>
        normalized.length > 1 &&
        !STOP_WORDS.has(raw) &&
        !STOP_WORDS.has(normalized)
      )
      .map(({ normalized }) => normalized),
  );
}

function extractProperNameTokens(question: string): string[] {
  return unique(
    tokenize(question)
      .filter((token) => /^\p{Lu}/u.test(token))
      .map((token) => ({ raw: token.toLowerCase(), normalized: normalizeToken(token) }))
      .filter(({ raw, normalized }) =>
        normalized.length > 1 &&
        !STOP_WORDS.has(raw) &&
        !STOP_WORDS.has(normalized)
      )
      .map(({ normalized }) => normalized),
  );
}

/**
 * Extract key search terms from a natural language question.
 * Uses a heuristic: remove common stop words/question words and normalize
 * Russian inflections so natural questions remain searchable by FTS5.
 */
function extractSearchTerms(question: string): string {
  return extractSearchTokens(question).join(" ");
}

export function buildAskInboxSearchQueries(question: string): string[] {
  const tokens = extractSearchTokens(question);
  const primaryQuery = extractSearchTerms(question);
  const strongTokens = tokens.filter((token) => !WEAK_FALLBACK_TERMS.has(token));
  const properNameTokens = extractProperNameTokens(question);

  return unique([
    primaryQuery,
    strongTokens.length >= 2 ? strongTokens.join(" ") : "",
    properNameTokens.length >= 2 ? properNameTokens.join(" ") : "",
    strongTokens.length >= 2 ? strongTokens.slice(-2).join(" ") : "",
    strongTokens.length === 1 ? (strongTokens[0] ?? "") : "",
  ]);
}

async function searchMessagesForQuestion(
  question: string,
  accountId: string,
  limit: number,
): Promise<SearchResult[]> {
  for (const query of buildAskInboxSearchQueries(question)) {
    try {
      const results = await searchMessages(query, accountId, limit);
      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn("Ask inbox search query failed:", query, err);
    }
  }

  return [];
}

export interface AskInboxResult {
  answer: string;
  sourceMessages: SearchResult[];
}

/**
 * Answer a natural language question by searching the user's inbox
 * and using AI to synthesize an answer from the results.
 */
export async function askMyInbox(
  question: string,
  accountId: string,
): Promise<AskInboxResult> {
  // Extract search terms
  const queries = buildAskInboxSearchQueries(question);
  if (queries.length === 0) {
    return {
      answer: getLocalizedFallback(
        "Не удалось понять вопрос. Попробуйте сформулировать его иначе.",
        "I couldn't understand the question. Please try rephrasing it.",
      ),
      sourceMessages: [],
    };
  }

  // Search messages using existing FTS
  const results = await searchMessagesForQuestion(question, accountId, 15);

  if (results.length === 0) {
    return {
      answer: getLocalizedFallback(
        "Не удалось найти подходящие письма по вашему вопросу. Попробуйте другой вопрос или измените поисковые слова.",
        "I couldn't find any relevant emails for your question. Try a different question or check your search terms.",
      ),
      sourceMessages: [],
    };
  }

  // Format context for AI
  const context = results
    .map((r) => {
      const date = new Date(r.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const from = r.from_name
        ? `${r.from_name} <${r.from_address}>`
        : (r.from_address ?? "Unknown");
      return `[Message ID: ${r.message_id}]\nFrom: ${from}\nDate: ${date}\nSubject: ${r.subject ?? "(no subject)"}\nPreview: ${r.snippet ?? ""}`;
    })
    .join("\n---\n");

  // Call AI
  const answer = await callAskInbox(question, accountId, context);

  return { answer, sourceMessages: results };
}
