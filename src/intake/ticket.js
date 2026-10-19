import { createHash } from 'node:crypto';
import { buildNormalizedIntake } from './normalize.js';
import { MAX_EXTRACTED_TEXT_CHARS } from './constants.js';
import { assertSafeSourceName } from './validation.js';
import { DEFAULT_MAX_COMMENTS, renderTicketMarkdown, selectComments } from './providers/ticket.js';

// Ticket → Normalized Intake Contract (v1.1.0). A ticket source is an ordinary v2
// file source, so every YallaFlow that reads sources keeps working:
//   original        the provider payload exactly as supplied or fetched (<provider>-<key>.json)
//   extracted text  the rendered, bannered Markdown the Agent reads
//   metadata.ticket provider identity and import provenance (free-form v2 metadata)
// sourceType stays 'file': 1.0.x validates sourceType strictly and would refuse a new one.
export const TICKET_FORMAT = 'ticket';

export function ticketSourceName(ticket) {
  const slug = `${ticket.provider}-${ticket.key}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return assertSafeSourceName(`${slug.slice(0, 120) || ticket.provider}.json`);
}

export function prepareTicketIntake(ticket, rawBuffer, {
  providerLabel, acquiredBy, fetchedAt = null, credential = null, previousSource = null,
  attachmentSources = new Map(), attachmentsNotDownloaded = [], maxComments = DEFAULT_MAX_COMMENTS
} = {}) {
  const text = renderTicketMarkdown(ticket, { providerLabel, maxComments, attachmentSources });
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) throw new Error(`The rendered ticket exceeds the ${MAX_EXTRACTED_TEXT_CHARS}-character text limit.`);
  const { included, humanCount, botCount } = selectComments(ticket.comments, maxComments);
  return buildNormalizedIntake({
    sourceType: 'file',
    sourceName: ticketSourceName(ticket),
    detectedFormat: TICKET_FORMAT,
    contentType: 'application/json',
    contentAvailability: 'extracted',
    rawText: text,
    representationKind: 'ticket-markdown',
    metadata: {
      sizeBytes: rawBuffer.length,
      sha256: createHash('sha256').update(rawBuffer).digest('hex'),
      extension: '.json',
      detectedFormat: TICKET_FORMAT,
      ticket: {
        provider: ticket.provider,
        instance: ticket.instance,
        key: ticket.key,
        url: ticket.url,
        title: ticket.title,
        type: ticket.type,
        state: ticket.state,
        updatedAt: ticket.updatedAt,
        revision: ticket.revision,
        acquiredBy,
        ...(fetchedAt ? { fetchedAt } : {}),
        ...(credential ? { credentialSource: credential } : {}),
        acceptanceCriteria: ticket.acceptanceCriteria.length,
        comments: { total: ticket.comments.length, included: included.length, human: humanCount, bot: botCount },
        attachments: ticket.attachments.map((entry) => ({
          name: entry.name,
          ...(entry.sizeBytes !== undefined ? { sizeBytes: entry.sizeBytes } : {}),
          ...(attachmentSources.get(entry.name) ? { source: attachmentSources.get(entry.name) } : {})
        })),
        ...(attachmentsNotDownloaded.length ? { attachmentsNotDownloaded } : {}),
        ...(previousSource ? { previousSource } : {})
      }
    },
    buffer: rawBuffer
  });
}

// The most recent earlier import of the same ticket (same provider, instance, key).
export function findPreviousTicketSource(sources, ticket) {
  const matches = sources.filter((record) => {
    const origin = record.metadata?.ticket;
    return origin && origin.provider === ticket.provider && origin.key === ticket.key && (origin.instance ?? null) === (ticket.instance ?? null);
  });
  return matches.sort((a, b) => (a.capturedAt ?? '').localeCompare(b.capturedAt ?? '') || a.id.localeCompare(b.id)).pop() ?? null;
}

export function isTicketSource(record) {
  return Boolean(record?.metadata?.ticket && record.detectedFormat === TICKET_FORMAT);
}
