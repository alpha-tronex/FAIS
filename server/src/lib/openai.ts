import OpenAI from 'openai';

/**
 * Read at request time so dotenv has already run.
 * Supports OPENAI_API_KEY or OPENAI_KEY.
 */
export function getOpenAIClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY?.trim() || process.env.OPENAI_KEY?.trim();
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}
