import type { dbClient } from "@kan/db/client";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardCommentRepo from "@kan/db/repository/cardComment.repo";

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHtmlParagraphs(value: string) {
  const blocks = value
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function renderHtmlFieldList(
  fields: Array<{ label: string; value: string | null | undefined }>,
) {
  const items = fields
    .filter((field) => field.value?.trim())
    .map(
      (field) =>
        `<li><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(field.value ?? "")}</li>`,
    );

  return items.length > 0 ? `<ul>${items.join("")}</ul>` : "";
}

export function renderHtmlCodeBlock(value: string) {
  return `<pre><code>${escapeHtml(value)}</code></pre>`;
}

export async function createSupportComment(
  db: dbClient,
  input: {
    cardId: number;
    createdBy: string | null | undefined;
    html: string | null | undefined;
  },
) {
  const html = input.html?.trim();
  if (!html || !input.createdBy) return null;

  const comment = await cardCommentRepo.create(db, {
    cardId: input.cardId,
    createdBy: input.createdBy,
    comment: html,
  });

  if (!comment?.id) return null;

  await cardActivityRepo.create(db, {
    type: "card.updated.comment.added",
    cardId: input.cardId,
    commentId: comment.id,
    toComment: comment.comment,
    createdBy: input.createdBy,
  });

  return comment;
}
