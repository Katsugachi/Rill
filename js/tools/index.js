// Tool registry: JSON schemas (passed to the chat template) + implementations.
import { runJS, formatRun } from './run-js.js';
import { searchWeb, readPage } from './research.js';
import { searchFiles } from './files.js';

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

export const SCHEMAS = {
  run_js: fn('run_js', 'Run JavaScript in a secure sandbox (no network, 5s limit). Use for any maths, dates or data work. Print results with console.log.',
    { code: { type: 'string', description: 'JavaScript code to run' } }, ['code']),
  search_web: fn('search_web', 'Search the web (Wikipedia) for facts. Returns titles, links and summaries.',
    { query: { type: 'string', description: 'Search keywords' } }, ['query']),
  read_page: fn('read_page', 'Read the text of a web page by URL, e.g. a link from search_web.',
    { url: { type: 'string', description: 'Full https URL' } }, ['url']),
  search_files: fn('search_files', 'Search the user\'s uploaded files and return the most relevant passages.',
    { query: { type: 'string', description: 'What to look for' } }, ['query']),
  read_file: fn('read_file', 'Read an uploaded file, one part at a time.',
    { name: { type: 'string', description: 'File name' }, part: { type: 'integer', description: 'Part number, starting at 1' } }, ['name']),
  create_plan: fn('create_plan', 'Create a checklist plan for a multi-step goal. Rill can then work through the steps on its own.',
    { title: { type: 'string', description: 'Short plan title' }, goal: { type: 'string', description: 'The overall goal in one sentence' },
      steps: { type: 'array', items: { type: 'string' }, description: '3 to 12 short, concrete, action-first steps' } }, ['title', 'steps']),
  save_note: fn('save_note', 'Save a note for the user to keep (summaries, answers, lists).',
    { title: { type: 'string' }, content: { type: 'string', description: 'Markdown content' } }, ['title', 'content']),
};

export const LABELS = {
  run_js: ['Running code', 'Ran code'],
  search_web: ['Searching', 'Searched'],
  read_page: ['Reading page', 'Read page'],
  search_files: ['Searching files', 'Searched files'],
  read_file: ['Reading file', 'Read file'],
  create_plan: ['Making a plan', 'Made a plan'],
  save_note: ['Saving note', 'Saved note'],
};

export function toolList(names) {
  return names.map((n) => SCHEMAS[n]);
}

const MAX_RESULT = 3500;
const clip = (s) => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + '\n…(truncated)' : s);

// ctx: { files, settings, signal, onPlan(planSpec) -> plan, onNote(note) }
export async function execute(call, ctx) {
  const a = call.arguments || {};
  const str = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  try {
    switch (call.name) {
      case 'run_js': {
        const r = await runJS(str(a.code));
        return { text: clip(formatRun(r)), detail: { code: str(a.code), ...r } };
      }
      case 'search_web': {
        const r = await searchWeb(str(a.query), { signal: ctx.signal });
        return { text: clip(r.text), sources: r.sources };
      }
      case 'read_page': {
        const r = await readPage(str(a.url), { webReader: ctx.settings.webReader, signal: ctx.signal });
        return { text: clip(r.text), sources: r.sources };
      }
      case 'search_files': {
        if (!ctx.files.length) return { text: 'No files uploaded yet. Ask the user to attach one.' };
        const hits = searchFiles(ctx.files, str(a.query));
        if (!hits.length) return { text: 'No matching passages. Try other words, or read_file part 1.' };
        return { text: clip(hits.map((h) => `[${h.file}, part ${h.part}/${h.parts}]\n${h.text.slice(0, 900)}`).join('\n\n')) };
      }
      case 'read_file': {
        if (!ctx.files.length) return { text: 'No files uploaded yet.' };
        const want = str(a.name).toLowerCase();
        const f = ctx.files.find((x) => x.name.toLowerCase() === want)
          || ctx.files.find((x) => x.name.toLowerCase().includes(want) || want.includes(x.name.toLowerCase()))
          || (ctx.files.length === 1 ? ctx.files[0] : null);
        if (!f) return { text: `No file named "${str(a.name)}". Files: ${ctx.files.map((x) => x.name).join(', ')}` };
        const part = Math.min(Math.max(parseInt(a.part, 10) || 1, 1), f.chunks.length);
        return { text: clip(`[${f.name}, part ${part}/${f.chunks.length}]\n${f.chunks[part - 1]}`) };
      }
      case 'create_plan': {
        let steps = Array.isArray(a.steps) ? a.steps : str(a.steps).split(/\n+/);
        steps = steps.map((s) => str(s).replace(/^\s*(?:[-*•]|\d+[.)]|\[.?\])\s*/, '').trim()).filter(Boolean).slice(0, 20);
        if (steps.length < 2) return { text: 'A plan needs at least 2 steps.' };
        const plan = await ctx.onPlan({ title: str(a.title).slice(0, 100) || 'Plan', goal: str(a.goal).slice(0, 300), steps });
        const next = ctx.settings.autoRun
          ? 'Rill will now work through these steps automatically. In one short sentence, tell the user you are starting. Do not do the steps yourself.'
          : 'Ask the user whether to run it now. Do not do the steps yourself.';
        return { text: `Plan "${plan.title}" created with ${steps.length} steps and shown to the user. ${next}`, plan: plan.id };
      }
      case 'save_note': {
        const note = await ctx.onNote({ title: str(a.title).slice(0, 100) || 'Note', content: str(a.content).slice(0, 20000) });
        return { text: `Saved note "${note.title}".` };
      }
      default:
        return { text: `Unknown tool "${call.name}". Available: ${Object.keys(SCHEMAS).join(', ')}.`, error: true };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { text: `Tool error: ${err?.message || err}`, error: true };
  }
}
