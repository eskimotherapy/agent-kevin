import { log, step, type Session } from '../../lib/browser';
import type { Story } from './types';

/**
 * Building block: navigate to the HN front page and scrape the top `count` stories. Demonstrates
 * the core pattern — navigate, then extract structured data with `page.evaluate`. (HN's markup is
 * stable; if it drifts, the selectors here are the only thing to retune.)
 */
export const extractTopStories = (session: Session, appUrl: string, count: number): Promise<Story[]> =>
  step(session, 'extract top stories', async (page) => {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    return page.evaluate((limit: number): Story[] => {
      const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('tr.athing'))
        .slice(0, limit)
        .map((row): Story => {
          const link = row.querySelector('.titleline a');
          const subtext = row.nextElementSibling;
          const commentsLink = Array.from(subtext?.querySelectorAll('a') ?? [])
            .reverse()
            .find((anchor) => /comment|discuss/i.test(anchor.textContent ?? ''));
          return {
            rank: clean(row.querySelector('.rank')?.textContent).replace('.', ''),
            title: clean(link?.textContent),
            url: link?.getAttribute('href') ?? '',
            points: clean(subtext?.querySelector('.score')?.textContent) || '0 points',
            author: clean(subtext?.querySelector('.hnuser')?.textContent),
            comments: clean(commentsLink?.textContent) || '0 comments'
          };
        });
    }, count);
  });

/**
 * Optional building block: click into the top story's discussion. Demonstrates interaction +
 * multi-screen navigation (vs the pure-scrape digest above).
 */
export const openTopStory = (session: Session): Promise<void> =>
  step(session, 'open top story comments', async (page) => {
    await page
      .getByRole('link', { name: /comment|discuss/i })
      .first()
      .click();
    await page.waitForLoadState('domcontentloaded');
    const title = (await page.locator('.titleline a').first().textContent().catch(() => null))?.trim();
    log(`opened top story discussion: ${title ?? '(title not found)'}`);
  });
