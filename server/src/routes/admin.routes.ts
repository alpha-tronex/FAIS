import express from 'express';
import { getOpenAIClient } from '../lib/openai.js';
import { MONGO_QUERY_SCHEMA_DESCRIPTION } from '../lib/mongo-query-schema.js';
import { validateAndSanitizeQuery, runMongoFind } from '../lib/mongo-query-runner.js';
import { sendError, sendErrorWithMessage } from './error.js';
import type { AuthMiddlewares } from './middleware.js';

const QUERY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'query_mongodb',
    description:
      'Run a read-only MongoDB find query. Use only allowed collections and safe filter/projection.',
    parameters: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'MongoDB filter' },
        projection: { type: 'object', description: 'Optional projection' },
        limit: { type: 'number', description: 'Max docs to return (1-500)' },
      },
      required: ['collection', 'filter'],
    },
  },
};

export function createAdminRouter(
  auth: Pick<AuthMiddlewares, 'requireAuth' | 'requireAdmin'>
): express.Router {
  const router = express.Router();

  router.post('/admin/query', auth.requireAuth, auth.requireAdmin, async (req, res) => {
    const question =
      typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      return sendErrorWithMessage(res, 'Missing question', 400);
    }

    const client = getOpenAIClient();
    if (!client) {
      return sendErrorWithMessage(
        res,
        'AI query service is not configured (missing OPENAI_API_KEY)',
        503
      );
    }

    try {
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `${MONGO_QUERY_SCHEMA_DESCRIPTION}\n\nOutput only by calling the query_mongodb tool. Do not explain.`,
          },
          { role: 'user', content: question },
        ],
        tools: [QUERY_TOOL],
        tool_choice: { type: 'function', function: { name: 'query_mongodb' } },
        max_tokens: 500,
      });

      const choice = completion.choices?.[0];
      const toolCall = choice?.message?.tool_calls?.[0];
      if (
        !toolCall ||
        toolCall.function?.name !== 'query_mongodb'
      ) {
        return res.status(400).json({
          error: 'Could not generate a query. Try rephrasing.',
          raw: choice?.message?.content ?? null,
        });
      }

      let args: {
        collection?: string;
        filter?: Record<string, unknown>;
        projection?: Record<string, unknown>;
        limit?: number;
      };
      try {
        args = JSON.parse(toolCall.function.arguments ?? '{}');
      } catch {
        return res.status(400).json({ error: 'Invalid query from AI.' });
      }

      const sanitized = validateAndSanitizeQuery({
        collection: args.collection ?? '',
        filter: args.filter,
        projection: args.projection,
        limit: args.limit,
      });
      const results = await runMongoFind(sanitized);

      res.json({ results, count: results.length });
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err?.status === 429 || err?.status === 402) {
        return sendErrorWithMessage(
          res,
          'AI quota exceeded. Check OpenAI billing.',
          err.status
        );
      }
      if (
        err?.message?.includes('Invalid collection') ||
        err?.message?.includes('forbidden')
      ) {
        return res.status(400).json({ error: err.message });
      }
      sendError(res, e);
    }
  });

  return router;
}
