#!/usr/bin/env node

import fs from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const ENV_FILES = [new URL('.env', ROOT), new URL('server/.env', ROOT)];
const question = process.argv.slice(2).join(' ').trim();
const timeoutMs = 25_000;

if (!question) {
  console.error('Uso: npm run assist:research -- "pergunta"');
  process.exit(2);
}

async function loadEnv() {
  const env = { ...process.env };
  for (const file of ENV_FILES) {
    try {
      const text = await fs.readFile(file, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || env[match[1]]) continue;
        env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    } catch {}
  }
  return env;
}

async function request(url, options, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      if (![408, 429, 500, 502, 503, 504, 529].includes(response.status)) {
        throw new Error(`${response.status}: ${body?.error?.message || 'provider error'}`);
      }
      lastError = new Error(`${response.status}: temporary provider error`);
    } catch (error) {
      lastError = error.name === 'AbortError' ? new Error('timeout') : error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError;
}

const json = (value) => ({ 'Content-Type': 'application/json', Accept: 'application/json', ...value });

async function askOpenAICompatible(name, url, key, model) {
  if (!key) return { provider: name, status: 'not_configured' };
  try {
    const body = await request(url, {
      method: 'POST',
      headers: json({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'Analise problemas de software com objetividade. Proponha uma alternativa curta, riscos e um teste de validação. Não invente evidências.' },
          { role: 'user', content: question },
        ],
      }),
    });
    return { provider: name, status: 'ok', text: body?.choices?.[0]?.message?.content?.trim() || '(sem resposta)' };
  } catch (error) {
    return { provider: name, status: 'error', error: error.message };
  }
}

async function askGemini(key, model) {
  if (!key) return { provider: 'gemini', status: 'not_configured' };
  try {
    const body = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: json({}),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Analise problemas de software com objetividade. Proponha uma alternativa curta, riscos e um teste de validação. Não invente evidências.' }] },
        contents: [{ role: 'user', parts: [{ text: question }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
      }),
    });
    return { provider: 'gemini', status: 'ok', text: body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ').trim() || '(sem resposta)' };
  } catch (error) {
    return { provider: 'gemini', status: 'error', error: error.message };
  }
}

async function validateWithJev(key, candidates) {
  if (!key || candidates.length === 0) return { status: key ? 'not_run' : 'not_configured' };
  const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.provider, `Alternativa proposta por ${candidate.provider}; deve ter baixo risco e um teste reproduzível.`]));
  try {
    const body = await request('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: json({ Authorization: `Bearer ${key}` }),
      body: JSON.stringify({
        model: 'jev-latest',
        state: { problem: question, suggestions: candidates.map(({ provider, text }) => ({ provider, text })) },
        questions: {
          recommendation: { type: 'choice', instructions: 'Qual alternativa é o melhor próximo passo seguro e verificável?', criteria },
          safe_to_apply: { type: 'noul', instructions: 'As alternativas são suficientemente fundamentadas para serem implementadas sem validação adicional?', criteria: { true: 'Há evidência e teste claro.', false: 'Falta evidência, há risco ou a proposta é especulativa.' } },
        },
      }),
    });
    return { status: 'ok', model: body.model, answers: body.answers };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

const env = await loadEnv();
const results = await Promise.all([
  askGemini(env.GEMINI_API_KEY || env.GEMINI_APY_key, env.GEMINI_MODEL || 'gemini-2.5-flash'),
  askOpenAICompatible('mistral', 'https://api.mistral.ai/v1/chat/completions', env.MISTRAL_API_KEY, env.MISTRAL_MODEL || 'mistral-small-latest'),
]);
const candidates = results.filter((result) => result.status === 'ok');
const validation = await validateWithJev(env.TYPESAFE_API_KEY, candidates);
console.log(JSON.stringify({ question, results, validation }, null, 2));
