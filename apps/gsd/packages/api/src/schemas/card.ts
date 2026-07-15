import { z } from "zod";

import {
  checklistResponseSchema,
  labelSchema,
  workspaceMemberSchema,
} from "./common";

const cardPrioritySchema = z.enum(["urgent", "high", "medium", "low"]);

const supportTicketMetadataSchema = z
  .object({
    externalId: z.string(),
    source: z.string(),
    sourceCaseKey: z.string().nullable(),
    supportCaseId: z.string().nullable(),
    sourceEventId: z.string().nullable(),
    sourceSystem: z.string().nullable(),
    userId: z.string().nullable(),
    emmaUserId: z.string().nullable(),
    email: z.string().nullable(),
    customerName: z.string().nullable(),
    issueCategory: z.string().nullable(),
    reportedAt: z.date().nullable(),
    sourceChannel: z.string().nullable(),
    provider: z.string().nullable(),
    providerThreadId: z.string().nullable(),
    providerMessageId: z.string().nullable(),
    mailbox: z.string().nullable(),
    ariSessionId: z.string().nullable(),
    ariSessionUrl: z.string().nullable(),
    repoFullName: z.string().nullable(),
  })
  .nullable();

// ─── card.create ─────────────────────────────────────────────
export const cardCreateResponseSchema = z.object({
  publicId: z.string(),
});

// ─── card.update ─────────────────────────────────────────────
export const cardUpdateResponseSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.date().nullable(),
  priority: cardPrioritySchema.nullable(),
});

// ─── Comment responses ───────────────────────────────────────
export const commentResponseSchema = z.object({
  publicId: z.string(),
  comment: z.string(),
});

export const commentDeleteResponseSchema = z.object({
  publicId: z.string(),
});

// ─── card.listFeatureRequests ────────────────────────────────
export const featureRequestListItemSchema = z.object({
  cardPublicId: z.string(),
  cardNumber: z.number().nullable(),
  title: z.string(),
  listName: z.string().nullable(),
  source: z.string(),
  sourceSystem: z.string().nullable(),
  sourceChannel: z.string().nullable(),
  email: z.string().nullable(),
  customerName: z.string().nullable(),
  reportedAt: z.date().nullable(),
  createdAt: z.date(),
});

// ─── card.listSentEmails ─────────────────────────────────────
export const sentEmailListItemSchema = z.object({
  id: z.number(),
  subject: z.string().nullable(),
  customerEmail: z.string().nullable(),
  customerName: z.string().nullable(),
  summary: z.string().nullable(),
  processingStatus: z.string(),
  cardPublicId: z.string().nullable(),
  cardTitle: z.string().nullable(),
  sentAt: z.date(),
});

// ─── card.listSpamRecords ────────────────────────────────────
export const spamRecordListItemSchema = z.object({
  id: z.number(),
  customerEmail: z.string().nullable(),
  customerName: z.string().nullable(),
  subject: z.string().nullable(),
  classification: z.record(z.unknown()).nullable(),
  processingStatus: z.string(),
  receivedAt: z.date().nullable(),
  createdAt: z.date(),
});

// ─── card.byId ───────────────────────────────────────────────

const cardMemberSchema = z.object({
  publicId: z.string(),
  email: z.string(),
  user: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
    })
    .nullable(),
});

export const cardDetailSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  dueDate: z.date().nullable(),
  priority: cardPrioritySchema.nullable(),
  cardNumber: z.number().nullable(),
  createdBy: z.string().nullable(),
  supportTicketMetadata: supportTicketMetadataSchema,
  labels: z.array(labelSchema),
  attachments: z.array(
    z.object({
      publicId: z.string(),
      contentType: z.string(),
      s3Key: z.string(),
      originalFilename: z.string().nullable(),
      size: z.number().nullable(),
      url: z.string().nullable(),
    }),
  ),
  checklists: z.array(checklistResponseSchema),
  list: z.object({
    publicId: z.string(),
    name: z.string(),
    board: z.object({
      publicId: z.string(),
      name: z.string(),
      labels: z.array(labelSchema),
      lists: z.array(
        z.object({
          publicId: z.string(),
          name: z.string(),
        }),
      ),
      workspace: z.object({
        publicId: z.string(),
        cardPrefix: z.string(),
        members: z.array(workspaceMemberSchema),
      }),
    }),
  }),
  members: z.array(cardMemberSchema),
  activities: z.array(
    z.object({
      publicId: z.string(),
      type: z.string(),
      createdAt: z.date(),
      fromIndex: z.number().nullable(),
      toIndex: z.number().nullable(),
      fromTitle: z.string().nullable(),
      toTitle: z.string().nullable(),
      fromDescription: z.string().nullable(),
      toDescription: z.string().nullable(),
      fromDueDate: z.date().nullable(),
      toDueDate: z.date().nullable(),
      fromList: z
        .object({
          publicId: z.string(),
          name: z.string(),
          index: z.number(),
        })
        .nullable(),
      toList: z
        .object({
          publicId: z.string(),
          name: z.string(),
          index: z.number(),
        })
        .nullable(),
      label: z
        .object({
          publicId: z.string(),
          name: z.string(),
        })
        .nullable(),
      member: z
        .object({
          publicId: z.string(),
          user: z
            .object({
              name: z.string().nullable(),
              email: z.string(),
            })
            .nullable(),
        })
        .nullable(),
      user: z
        .object({
          name: z.string().nullable(),
          email: z.string(),
        })
        .nullable(),
      comment: z
        .object({
          publicId: z.string(),
          comment: z.string(),
          createdBy: z.string().nullable(),
          updatedAt: z.date().nullable(),
          deletedAt: z.date().nullable(),
        })
        .nullable(),
    }),
  ),
  agentRuns: z.array(
    z.object({
      publicId: z.string(),
      agent: z.string(),
      status: z.enum([
        "requested",
        "running",
        "needs_input",
        "ready_for_review",
        "failed",
      ]),
      supersetWorkspaceId: z.string().nullable(),
      supersetSessionId: z.string().nullable(),
      supersetUrl: z.string().nullable(),
      error: z.string().nullable(),
      createdAt: z.date(),
      updatedAt: z.date().nullable(),
    }),
  ),
});

// ─── card.getActivities ──────────────────────────────────────
export const activityItemSchema = z.object({
  publicId: z.string(),
  type: z.string(),
  createdAt: z.date(),
  fromIndex: z.number().nullable(),
  toIndex: z.number().nullable(),
  fromTitle: z.string().nullable(),
  toTitle: z.string().nullable(),
  fromDescription: z.string().nullable(),
  toDescription: z.string().nullable(),
  fromDueDate: z.date().nullable(),
  toDueDate: z.date().nullable(),
  fromList: z
    .object({
      publicId: z.string(),
      name: z.string(),
      index: z.number(),
    })
    .nullable(),
  toList: z
    .object({
      publicId: z.string(),
      name: z.string(),
      index: z.number(),
    })
    .nullable(),
  label: z
    .object({
      publicId: z.string(),
      name: z.string(),
    })
    .nullable(),
  member: z
    .object({
      publicId: z.string(),
      user: z
        .object({
          id: z.string().nullable(),
          name: z.string().nullable(),
          email: z.string(),
          image: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  user: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      email: z.string(),
      image: z.string().nullable(),
    })
    .nullable(),
  comment: z
    .object({
      publicId: z.string(),
      comment: z.string(),
      createdBy: z.string().nullable(),
      updatedAt: z.date().nullable(),
      deletedAt: z.date().nullable(),
    })
    .nullable(),
  attachment: z
    .object({
      publicId: z.string(),
      filename: z.string(),
      originalFilename: z.string().nullable(),
    })
    .nullable(),
});
