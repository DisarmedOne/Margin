// Dev-only stand-in for the Electron preload so the renderer can be driven in a plain browser.
// Query string picks a scenario: ?s=new | nokey | full
(() => {
  const s = new URLSearchParams(location.search).get('s') || 'full';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (data) => ({ ok: true, data });
  const now = Date.now();
  const DAY = 864e5;
  const ranks = [
    { name: 'Reader', xp: 0 }, { name: 'Annotator', xp: 300 }, { name: 'Close Reader', xp: 900 },
    { name: 'Reviewer', xp: 2000 }, { name: 'Referee', xp: 4000 }, { name: 'Editor', xp: 7500 }, { name: 'Scholar', xp: 12500 },
  ];
  const rankFor = (xp) => {
    let i = 0;
    while (i + 1 < ranks.length && xp >= ranks[i + 1].xp) i++;
    return { index: i, name: ranks[i].name, floor: ranks[i].xp, next: ranks[i + 1] || null };
  };
  const day = (o) => { const d = new Date(now - o * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const full = s === 'full';
  let profile = {
    xp: full ? 1140 : 0, streak: full ? 4 : 0, answered: full ? 38 : 0, correct: full ? 29 : 0, levelsDone: full ? 4 : 0, reviewsDone: full ? 22 : 0,
    calibration: full ? { guess: { n: 7, right: 3 }, fairly: { n: 16, right: 12 }, certain: { n: 15, right: 14 } } : { guess: { n: 0, right: 0 }, fairly: { n: 0, right: 0 }, certain: { n: 0, right: 0 } },
    daily: full ? { [day(0)]: 140, [day(1)]: 210, [day(2)]: 95, [day(3)]: 180, [day(6)]: 60, [day(9)]: 120 } : {},
    due: full ? 3 : 0, deckSize: full ? 18 : 0, nextDue: full ? now + 5 * 3600e3 : null, today: day(0), ranks,
  };
  profile.rank = rankFor(profile.xp);

  const outline = {
    title: 'Test-enhanced learning: taking memory tests improves long-term retention',
    authors: 'Henry L. Roediger III, Jeffrey D. Karpicke',
    field: 'Cognitive psychology',
    oneLiner: 'Practising **recall** of a text makes it stick far longer than re-reading it, even though re-reading feels more effective.',
    studyMinutes: 50,
    chapters: [
      { title: 'Why re-reading feels like learning', summary: 'Why **fluency** while studying is a poor signal of what you will remember later.', concepts: ['fluency illusion', 'restudy', 'metacognition'] },
      { title: 'The two experiments', summary: 'How the study compared repeated testing with repeated studying of prose passages.', concepts: ['study-test cycles', 'free recall', 'retention interval'] },
      { title: 'Short delay versus one week', summary: 'Why restudying wins after five minutes but loses badly after a week.', concepts: ['crossover effect', 'forgetting rate', 'delay'] },
      { title: 'What students predicted', summary: 'How learners misjudged which method would serve them best.', concepts: ['judgments of learning', 'overconfidence'] },
      { title: 'Using testing on purpose', summary: 'What the results mean for how to study and how to teach.', concepts: ['retrieval practice', 'spacing', 'low-stakes quizzes'] },
    ],
  };
  const papers = full
    ? [
        { id: 'p1', fileName: 'roediger-karpicke-2006.pdf', kind: 'pdf', addedAt: now - 3 * DAY, touchedAt: now - 3600e3, status: 'ready', outline, progress: { 0: { done: true, correct: 8, total: 9 }, 1: { done: true, correct: 6, total: 9 } }, levelsReady: ['0', '1', '2'] },
        { id: 'p2', fileName: 'attention-is-all-you-need.pdf', kind: 'pdf', addedAt: now - 40e3, startedAt: now - 23e3, status: 'reading', outline: null, progress: {}, levelsReady: [] },
        { id: 'p3', fileName: 'scan_0042.pdf', kind: 'pdf', addedAt: now - 2 * DAY, status: 'error', error: 'Anthropic could not process this document.', outline: null, progress: {}, levelsReady: [] },
        { id: 'p4', fileName: 'kahneman-tversky.pdf', kind: 'pdf', addedAt: now - 9 * DAY, touchedAt: now - 8 * DAY, status: 'ready', progress: { 0: { done: true, correct: 7, total: 9 }, 1: { done: true, correct: 9, total: 9 }, 2: { done: true, correct: 5, total: 9 }, 3: { done: true, correct: 8, total: 9 } }, levelsReady: [],
          outline: { ...outline, title: 'Judgment under uncertainty: heuristics and biases', authors: 'Amos Tversky, Daniel Kahneman', field: 'Behavioural economics', chapters: outline.chapters.slice(0, 4) } },
      ]
    : [];

  const level = {
    hook: { prompt: 'Students either re-read a passage three more times or tried to recall it three times. One week later, which group remembered more?', options: ['The re-readers, by a wide margin', 'The recallers', 'Both about the same', 'The re-readers, slightly'], answerIndex: 1, explanation: 'The group that practised recall remembered about half as much again as the re-readers, despite seeing the text far less.' },
    explainer: [
      { heading: 'Feeling fluent is not knowing', body: 'Re-reading makes a passage feel familiar, and **familiarity** is easy to mistake for memory. Students in the study rated re-reading as the better method, yet it produced the weaker result a week later. The ease you feel while studying says little about what you will be able to pull out of memory once the page is gone.' },
      { heading: 'Recall changes the memory', body: 'Each time you pull an idea back out, you strengthen the route to it. This is the **testing effect**. In the experiments, students who spent their time recalling the passage, rather than reading it again, kept far more of it after seven days.' },
      { heading: 'Why the short test misleads', body: 'Measured after five minutes, re-reading looked slightly better. The advantage flipped once a week had passed. A **crossover** like this is why your own sense of what works can mislead you: you only ever see the short-term result.' },
    ],
    challenges: [
      { kind: 'choice', prompt: 'What did students believe about re-reading compared with self-testing?', options: ['That self-testing would work better', 'That re-reading would work better', 'That both would work equally well', 'They were not asked'], answerIndex: 1, explanation: 'Students predicted re-reading would help more, the opposite of the result. A tempting wrong pick is "not asked", but judgments were collected.' },
      { kind: 'truefalse', prompt: 'After a five-minute delay, the repeated-testing group already recalled more than the re-reading group.', options: ['True', 'False'], answerIndex: 1, explanation: 'At five minutes re-reading was slightly ahead. Testing pulled ahead only at the longer delays.' },
      { kind: 'cloze', prompt: 'The benefit of practising recall over re-reading is called the ____ effect.', options: ['testing', 'spacing', 'generation', 'primacy'], answerIndex: 0, explanation: 'The testing effect. Spacing is a related but separate finding about when you study.' },
      { kind: 'spot', prompt: 'Which of these statements does the paper NOT support?', options: ['Recall practice slows forgetting', 'Re-reading feels more effective than it is', 'Testing only helps if you get feedback on every answer', 'Delay changes which method looks best'], answerIndex: 2, explanation: 'The study found benefits from recall even without feedback, so the third statement is not supported.' },
    ],
    teachBack: { prompt: 'Explain to a friend why quizzing yourself beats re-reading, even though re-reading feels better.', keyPoints: ['Recall strengthens memory', 'Re-reading creates false fluency', 'Benefit shows after a delay', 'Students mispredict'] },
    boss: [
      { kind: 'choice', prompt: 'A teacher gives a short quiz at the end of each lesson and finds scores the next morning are no better than with a review sheet. What does the paper suggest?', options: ['Quizzes do not work for this class', 'Check retention after a week before deciding', 'Switch to review sheets', 'Make the quizzes harder'], answerIndex: 1, explanation: 'Testing advantages often appear only after longer delays, so a next-day check can hide them.' },
    ],
    cards: [{ front: 'What is the testing effect?', back: 'Practising recall strengthens memory more than restudying the same material.' }],
    nextTeaser: 'The researchers designed two experiments to rule out one obvious objection. Can you guess what it was?',
  };

  const cards = full
    ? [
        { id: 'c1', paperId: 'p1', chapter: 0, paperTitle: outline.title, front: 'Why does re-reading feel effective even when it is not?', back: 'It makes material feel fluent and familiar, which learners mistake for being able to recall it later.', previewMs: [6e5, 864e5, 864e5, 3456e5] },
        { id: 'c2', paperId: 'p1', chapter: 1, paperTitle: outline.title, front: 'At what delay did repeated testing overtake repeated studying?', back: 'At the longer delays of two days and one week. At five minutes re-reading was slightly ahead.', previewMs: [6e5, 2592e5, 5184e5, 6912e5] },
      ]
    : [];

  window.margin = {
    boot: async () => ok({ languages: { en: 'English', es: 'Spanish', fr: 'French', de: 'German', nl: 'Dutch', pt: 'Portuguese', it: 'Italian', ru: 'Russian', zh: 'Simplified Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish' }, settings: { language: new URLSearchParams(location.search).get('lang') || 'en', dailyGoal: 60, readingSize: 'm', confidence: new URLSearchParams(location.search).get('conf') !== '0', autoContinue: new URLSearchParams(location.search).get('auto') === '1', levelLength: 'standard', sound: false, motion: 'full', theme: new URLSearchParams(location.search).get('t') || 'system' }, key: { provider: 'anthropic', set: s !== 'nokey', last4: 'Q7xk', saved: { anthropic: s !== 'nokey', gemini: false, openai: false } }, profile, papers, providers: { anthropic: { label: 'Anthropic', model: 'claude-opus-5-5', modelName: 'Claude Opus 5.5' }, gemini: { label: 'Google Gemini', model: 'gemini-4-hydrogen', modelName: 'Gemini 4 Hydrogen' }, openai: { label: 'OpenAI', model: 'gpt-6.2-sol', modelName: 'GPT-6.2 Sol' } } }),
    setKey: async (p, k) => { await wait(900); return k.length > 20 ? ok({ provider: p, set: true, last4: k.slice(-4), saved: { anthropic: true, gemini: p === 'gemini', openai: p === 'openai' } }) : { ok: false, error: { message: 'That does not look like a valid key.' } }; },
    useProvider: async (p) => ok({ provider: p, set: true, last4: 'abcd', saved: { anthropic: true, gemini: true, openai: false } }),
    setSettings: async (p) => ok({ language: 'en', dailyGoal: 60, sound: false, motion: 'system', theme: 'system', ...p }),
    cardPool: async () => ok([['What is the testing effect?','Recalling information strengthens memory more than restudying it.'],['What is the spacing effect?','Spreading study over time beats massing it in one session.'],['What is hypercorrection?','Confident errors are corrected more strongly than unsure ones.'],['What is interleaving?','Mixing related topics in one session improves later recall.'],['What did students predict?','That re-reading would work better than self-testing.']].map(([front, back], i) => ({ id: 'k' + i, front, back }))),
    finishLightning: async (n) => ok({ profile, isBest: true }),
    pickFiles: async () => ok([]),
    addPaper: async () => ok(papers[1]),
    getPaper: async (id) => ok(papers.find((p) => p.id === id)),
    retryPaper: async (id) => ok(papers.find((p) => p.id === id)),
    removePaper: async () => ok(profile),
    getLevel: async () => { await wait(new URLSearchParams(location.search).get('slow') ? 60000 : 1200); return ok(level); },
    prefetchLevel: async () => ok(true),
    completeLevel: async (id, ch, r) => { profile = { ...profile, xp: profile.xp + r.xp }; profile.rank = rankFor(profile.xp); papers[0].progress[ch] = { done: true, correct: r.correct, total: r.total }; return ok({ profile, cardsAdded: 3, rankUp: null }); },
    gradeTeachBack: async () => { await wait(1200); return ok({ score: 2, covered: ['Recall strengthens memory', 'Re-reading feels fluent'], missed: ['Students mispredict which works'], feedback: 'You explained the core mechanism clearly and used your own words. Add that students themselves guessed wrong about which method works, which is the most surprising part.' }); },
    dueCards: async () => { await wait(300); return ok(cards); },
    rateCard: async () => ok(profile),
    profile: async () => ok(profile),
    openConsole: async () => ok(true),
    openData: async () => ok(true),
    pathForFile: () => null,
    onPaper: () => () => {},
  };
})();
