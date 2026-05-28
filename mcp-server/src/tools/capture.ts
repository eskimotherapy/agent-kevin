import { capture, type CaptureKind } from '@/knowledge/capture';
import { log as baseLog } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

const log = baseLog.knowledge.with('capture');

const KINDS: [CaptureKind, ...CaptureKind[]] = ['inbox', 'feedback'];

export const tools: ToolDef[] = [
  defineTool({
    name: 'capture',
    description:
      "Capture any input (a thought, snippet, dropped file, concept) into Kevin's raw tree for the next knowledge-compile to absorb. Default kind=inbox writes a timestamped doc to raw/inbox/. kind=feedback appends to raw/user/feedback.md instead (operator-meta — corrections/preferences/rules; compiled into memory/index.md → Learnings). Local-only, secret-redacted, atomic, content-hash deduped.",
    inputSchema: {
      text: z
        .string()
        .optional()
        .describe('Inline text to capture. Either text or file must be provided.'),
      file: z
        .string()
        .optional()
        .describe('Absolute or relative path to a file to capture. Read fully and ingested.'),
      kind: z
        .enum(KINDS)
        .optional()
        .describe(
          'Default "inbox". Use "feedback" for corrections / preferences / rules — appends to raw/user/feedback.md instead.'
        ),
      title: z
        .string()
        .optional()
        .describe('Optional title — becomes filename slug + frontmatter title (inbox kind only).'),
      label: z
        .string()
        .optional()
        .describe('Optional label stored in frontmatter (inbox) or in the feedback entry header.')
    },
    handler: async (args) => {
      const result = await capture(args);
      log.info(`${result.duplicate ? 'duplicate' : 'wrote'} ${result.kind} → ${result.relPath}`);
      return result;
    }
  })
];
