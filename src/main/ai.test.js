const test = require('node:test');
const assert = require('node:assert');
const ai = require('./ai');

test('the logged Gemini cost counts cached input cheaply and thinking as output', () => {
  const u = ai.geminiUsage({ promptTokenCount: 12000, cachedContentTokenCount: 10000, candidatesTokenCount: 3000, thoughtsTokenCount: 1000 });
  assert.equal(u.dollars.toFixed(6), '0.010900'); // 2000×0.30 + 10000×0.03 + 4000×2.50, per million
  assert.equal(ai.geminiUsage().dollars, 0);
});

test('Gemini requests ask for little thinking and report what they used', async () => {
  const real = globalThis.fetch;
  const sent = [];
  const used = [];
  ai.configure('gemini', 'AIza' + 'x'.repeat(35));
  ai.onUsage((u) => used.push(u));
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      candidates: [{ content: { parts: [{ text: JSON.stringify({ score: 2, covered: [], missed: [], feedback: 'ok' }) }] } }],
    });
  };
  await ai.grade({ chapter: { title: 't', summary: 's' }, keyPoints: ['a'], prompt: 'p', answer: 'x' });
  globalThis.fetch = real;
  assert.ok(sent[0].url.includes('gemini-3.5-flash-lite'));
  assert.equal(sent[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(used.length, 1);
  assert.equal(used[0].input, 100);
});
