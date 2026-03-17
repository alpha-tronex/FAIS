/**
 * Minimal Manus API client for creating tasks and polling for completion.
 * Used by the RAG example generation job (Option B).
 */

const DEFAULT_BASE_URL = 'https://api.manus.ai';

function getBaseUrl(): string {
  return (process.env.MANUS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getApiKey(): string | undefined {
  return process.env.MANUS_API_KEY?.trim();
}

export type CreateTaskResponse = {
  task_id: string;
  task_title?: string;
  task_url?: string;
};

/**
 * Create a Manus task. Pass the full instruction (and context) in the prompt.
 * Requires MANUS_API_KEY in env.
 */
export async function createTask(
  prompt: string,
  options?: { agentProfile?: string }
): Promise<CreateTaskResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MANUS_API_KEY is required to create a Manus task');
  }
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/v1/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: apiKey,
    },
    body: JSON.stringify({
      prompt,
      agentProfile: options?.agentProfile ?? 'manus-1.6',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manus API create task failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as CreateTaskResponse;
  if (!data?.task_id) {
    throw new Error('Manus API did not return task_id');
  }
  return data;
}

export type TaskMessageContent = {
  type: 'output_text' | 'output_file';
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
};

export type TaskMessage = {
  id?: string;
  role?: string;
  type?: string;
  content?: TaskMessageContent[];
};

export type GetTaskResponse = {
  id?: string;
  status: string;
  error?: string;
  output?: TaskMessage[];
};

/**
 * Get task by ID. Used for polling until status is completed or failed.
 */
export async function getTask(taskId: string): Promise<GetTaskResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MANUS_API_KEY is required to get a Manus task');
  }
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: {
      API_KEY: apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manus API get task failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GetTaskResponse;
}

/**
 * Extract the combined assistant text from task output (last assistant message's output_text content).
 */
export function getAssistantTextFromOutput(output: TaskMessage[] | undefined): string {
  if (!Array.isArray(output) || output.length === 0) return '';
  const assistantMessages = output.filter((m) => m.role === 'assistant');
  const last = assistantMessages[assistantMessages.length - 1];
  if (!last?.content || !Array.isArray(last.content)) return '';
  const texts = last.content
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  return texts.join('\n').trim();
}

/**
 * Extract assistant output for parsing: prefers JSON from output_file (e.g. dashboard_triples.json)
 * if present, otherwise falls back to output_text. Fetches file URLs with the same API key.
 */
export async function getAssistantTextFromOutputAsync(
  output: TaskMessage[] | undefined
): Promise<string> {
  if (!Array.isArray(output) || output.length === 0) return '';

  const apiKey = getApiKey();
  for (const m of output) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (c.type !== 'output_file' || !c.fileUrl) continue;
      const isJson =
        (c.fileName && /\.json$/i.test(c.fileName)) ||
        c.mimeType === 'application/json';
      if (!isJson) continue;
      try {
        const res = await fetch(c.fileUrl, {
          headers: apiKey ? { API_KEY: apiKey } : undefined,
        });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.trim().length > 0) return text.trim();
      } catch {
        // skip failed fetch, try next or fallback
      }
    }
  }

  return getAssistantTextFromOutput(output);
}
