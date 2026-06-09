import { log, type Target } from '../../lib/browser';
import { runFlow } from '../../lib/flow';
import { extractTopStories, openTopStory } from './stories';

/**
 * hacker-news — the reference flow for browser-flows. Scrapes the top Hacker News stories into a
 * structured digest, and optionally opens the #1 discussion. A small, real, no-login example to
 * copy when building your own flow: it shows the folder shape (index.ts entry + index.md guidance
 * + a building-block module), a single no-auth target, params, and navigate → extract → interact.
 *
 * Params: count (1–30, default 10) · open (true to also open the top story's comments).
 * No `auth` on the target, so the manual-login wait is skipped — it just visits a public site.
 */
const TARGETS = {
  web: { name: 'web', appUrl: 'https://news.ycombinator.com' }
} satisfies Record<string, Target>;

runFlow(TARGETS, async ({ params, target, session }) => {
  const count = Math.min(Math.max(Number(params.count ?? 10) || 10, 1), 30);
  log(`hacker-news → top ${count} stories from ${target.appUrl}`);

  const stories = await extractTopStories(session, target.appUrl, count);
  for (const story of stories) {
    log(`${story.rank}. ${story.title} — ${story.points}, ${story.comments}${story.author ? ` by ${story.author}` : ''}`);
    log(`   ${story.url}`);
  }
  log(`✅ captured ${stories.length} stories.`);

  if (params.open === 'true') {
    await openTopStory(session);
  }
});
