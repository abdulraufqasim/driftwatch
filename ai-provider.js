const DEFAULT_MODELS = {
  anthropic: 'claude-3-5-haiku-latest',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash'
};

class ChatProviderError extends Error {
  constructor(status = 502) {
    super('The AI provider could not complete the request.');
    this.status = status;
  }
}

function providerConfig(env = process.env) {
  const provider = (env.AI_PROVIDER || '').trim().toLowerCase();
  const apiKey = (env.AI_API_KEY || '').trim();
  if (!apiKey || !Object.hasOwn(DEFAULT_MODELS, provider)) return null;
  return {
    provider,
    apiKey,
    model: (env.AI_MODEL || '').trim() || DEFAULT_MODELS[provider]
  };
}

function isProviderConfigured(env = process.env) {
  return providerConfig(env) !== null;
}

async function callAiProvider({ systemPrompt, userPrompt }, {
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = providerConfig(env);
  if (!config) throw new ChatProviderError(503);

  const signal = AbortSignal.timeout(30_000);
  let url;
  let headers;
  let body;

  if (config.provider === 'openai') {
    url = 'https://api.openai.com/v1/chat/completions';
    headers = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    };
    body = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.3
    };
  } else if (config.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };
    body = {
      model: config.model,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    headers = { 'Content-Type': 'application/json' };
    body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
    };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });
  } catch {
    throw new ChatProviderError(signal.aborted ? 504 : 502);
  }
  if (!response.ok) throw new ChatProviderError(502);

  let result;
  try {
    result = await response.json();
  } catch {
    throw new ChatProviderError(502);
  }

  let reply;
  if (config.provider === 'openai') {
    reply = result.choices?.[0]?.message?.content;
  } else if (config.provider === 'anthropic') {
    reply = Array.isArray(result.content)
      ? result.content.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n')
      : '';
  } else {
    reply = result.candidates?.[0]?.content?.parts
      ?.filter((part) => typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n');
  }
  if (typeof reply !== 'string' || !reply.trim()) throw new ChatProviderError(502);
  return reply.trim().slice(0, 1800);
}

module.exports = { callAiProvider, isProviderConfigured, providerConfig };
