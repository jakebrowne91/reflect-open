CREATE EXTENSION IF NOT EXISTS "uuid-ossp";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_board_type" AS ENUM('regular', 'template'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_board_visibility" AS ENUM('private', 'public'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_card_agent_run_status" AS ENUM('requested', 'running', 'needs_input', 'ready_for_review', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_card_activity_type" AS ENUM('card.created', 'card.updated.title', 'card.updated.description', 'card.updated.index', 'card.updated.list', 'card.updated.label.added', 'card.updated.label.removed', 'card.updated.member.added', 'card.updated.member.removed', 'card.updated.comment.added', 'card.updated.comment.updated', 'card.updated.comment.deleted', 'card.updated.checklist.added', 'card.updated.checklist.renamed', 'card.updated.checklist.deleted', 'card.updated.checklist.item.added', 'card.updated.checklist.item.updated', 'card.updated.checklist.item.completed', 'card.updated.checklist.item.uncompleted', 'card.updated.checklist.item.deleted', 'card.updated.attachment.added', 'card.updated.attachment.removed', 'card.updated.dueDate.added', 'card.updated.dueDate.updated', 'card.updated.dueDate.removed', 'card.archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_card_priority" AS ENUM('urgent', 'high', 'medium', 'low'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_import_source" AS ENUM('trello', 'github'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_import_status" AS ENUM('started', 'success', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_role" AS ENUM('admin', 'member', 'guest'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_member_status" AS ENUM('invited', 'active', 'removed', 'paused'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_slug_type" AS ENUM('reserved', 'premium'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_workspace_plan" AS ENUM('free', 'team', 'pro', 'enterprise'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_invite_link_status" AS ENUM('active', 'inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."gsd_notification_type" AS ENUM('mention', 'workspace.member.added', 'workspace.member.removed', 'workspace.role.changed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_account" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" uuid NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_api_key" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"userId" uuid NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp,
	"enabled" boolean,
	"rateLimitEnabled" boolean,
	"rateLimitTimeWindow" integer,
	"rateLimitMax" integer,
	"requestCount" integer,
	"remaining" integer,
	"lastRequest" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
ALTER TABLE "gsd_api_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_session" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" uuid NOT NULL,
	CONSTRAINT "gsd_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "gsd_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_verification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "gsd_verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_board" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"slug" varchar(255) NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	"importId" bigint,
	"workspaceId" bigint NOT NULL,
	"visibility" "gsd_board_visibility" DEFAULT 'private' NOT NULL,
	"type" "gsd_board_type" DEFAULT 'regular' NOT NULL,
	"isArchived" boolean DEFAULT false NOT NULL,
	"sourceBoardId" bigint,
	CONSTRAINT "gsd_board_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_board" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_user_board_favorites" (
	"userId" uuid NOT NULL,
	"boardId" bigint NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gsd_user_board_favorites_userId_boardId_pk" PRIMARY KEY("userId","boardId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_agent_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"createdBy" uuid,
	"agent" varchar(64) NOT NULL,
	"status" "gsd_card_agent_run_status" DEFAULT 'requested' NOT NULL,
	"supersetWorkspaceId" text,
	"supersetSessionId" text,
	"supersetUrl" text,
	"prompt" text NOT NULL,
	"response" jsonb,
	"error" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "gsd_card_agent_run_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_agent_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"type" "gsd_card_activity_type" NOT NULL,
	"cardId" bigint NOT NULL,
	"fromIndex" integer,
	"toIndex" integer,
	"fromListId" bigint,
	"toListId" bigint,
	"labelId" bigint,
	"workspaceMemberId" bigint,
	"fromTitle" text,
	"toTitle" text,
	"fromDescription" text,
	"toDescription" text,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"commentId" bigint,
	"fromComment" text,
	"toComment" text,
	"fromDueDate" timestamp,
	"toDueDate" timestamp,
	"sourceBoardId" bigint,
	"attachmentId" bigint,
	CONSTRAINT "gsd_card_activity_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_attachment" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"cardId" bigint NOT NULL,
	"filename" varchar(255) NOT NULL,
	"originalFilename" varchar(255) NOT NULL,
	"contentType" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"s3Key" varchar(500) NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "gsd_card_attachment_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_workspace_members" (
	"cardId" bigint NOT NULL,
	"workspaceMemberId" bigint NOT NULL,
	CONSTRAINT "gsd_card_workspace_members_cardId_workspaceMemberId_pk" PRIMARY KEY("cardId","workspaceMemberId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"index" integer NOT NULL,
	"cardNumber" integer,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	"listId" bigint NOT NULL,
	"importId" bigint,
	"dueDate" timestamp,
	"priority" "gsd_card_priority",
	CONSTRAINT "gsd_card_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_labels" (
	"cardId" bigint NOT NULL,
	"labelId" bigint NOT NULL,
	CONSTRAINT "gsd_card_labels_cardId_labelId_pk" PRIMARY KEY("cardId","labelId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"comment" text NOT NULL,
	"cardId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_card_comments_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_checklist_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"title" varchar(500) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"index" integer NOT NULL,
	"checklistId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_card_checklist_item_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_checklist_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_card_checklist" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"index" integer NOT NULL,
	"cardId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_card_checklist_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_card_checklist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feedback" text NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"url" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_import" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"source" "gsd_import_source" NOT NULL,
	"status" "gsd_import_status" NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gsd_import_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_label" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"colourCode" varchar(12),
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"boardId" bigint NOT NULL,
	"importId" bigint,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_label_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_list" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"index" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	"boardId" bigint NOT NULL,
	"importId" bigint,
	CONSTRAINT "gsd_list_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_user" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"name" varchar(255),
	"email" varchar(255) NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"stripeCustomerId" varchar(255),
	CONSTRAINT "gsd_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "gsd_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_integration" (
	"provider" varchar(255) NOT NULL,
	"userId" uuid NOT NULL,
	"accessToken" text NOT NULL,
	"refreshToken" varchar(255),
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "gsd_integration_pkey" PRIMARY KEY("userId","provider")
);
--> statement-breakpoint
ALTER TABLE "gsd_integration" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_slug_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"available" boolean NOT NULL,
	"reserved" boolean NOT NULL,
	"workspaceId" bigint,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_slug_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_slugs" (
	"slug" varchar(255) NOT NULL,
	"type" "gsd_slug_type" NOT NULL,
	CONSTRAINT "gsd_workspace_slugs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"email" varchar(255) NOT NULL,
	"userId" uuid,
	"workspaceId" bigint NOT NULL,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	"role" "gsd_role" NOT NULL,
	"roleId" bigint,
	"status" "gsd_member_status" DEFAULT 'invited' NOT NULL,
	CONSTRAINT "gsd_workspace_members_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"slug" varchar(255) NOT NULL,
	"plan" "gsd_workspace_plan" DEFAULT 'free' NOT NULL,
	"showEmailsToMembers" boolean DEFAULT true NOT NULL,
	"weekStartDay" integer DEFAULT 1 NOT NULL,
	"cardPrefix" varchar(10) DEFAULT '' NOT NULL,
	"cardCounter" integer DEFAULT 0 NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_workspace_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "gsd_workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_subscription" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan" varchar(255) NOT NULL,
	"referenceId" varchar(12),
	"stripeCustomerId" varchar(255),
	"stripeSubscriptionId" varchar(255),
	"status" varchar(255) NOT NULL,
	"periodStart" timestamp,
	"periodEnd" timestamp,
	"cancelAtPeriodEnd" boolean,
	"seats" integer,
	"unlimitedSeats" boolean DEFAULT false NOT NULL,
	"trialStart" timestamp,
	"trialEnd" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_invite_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"code" varchar(12) NOT NULL,
	"status" "gsd_invite_link_status" DEFAULT 'active' NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"createdBy" uuid,
	"updatedAt" timestamp,
	"updatedBy" uuid,
	CONSTRAINT "gsd_workspace_invite_links_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "gsd_workspace_invite_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_invite_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_member_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspaceMemberId" bigint NOT NULL,
	"permission" varchar(64) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_member_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_role_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspaceRoleId" bigint NOT NULL,
	"permission" varchar(64) NOT NULL,
	"granted" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"name" varchar(64) NOT NULL,
	"description" varchar(255),
	"hierarchyLevel" integer NOT NULL,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "gsd_workspace_roles_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_notification" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"type" "gsd_notification_type" NOT NULL,
	"userId" uuid NOT NULL,
	"cardId" bigint,
	"commentId" bigint,
	"workspaceId" bigint,
	"metadata" text,
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	CONSTRAINT "gsd_notification_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_note" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"workspaceId" bigint NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "gsd_note_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_workspace_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"secret" text,
	"events" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "gsd_workspace_webhooks_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "gsd_workspace_webhooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_support_case_thread" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"supportCaseId" varchar(80),
	"sourceCaseKey" varchar(300),
	"provider" varchar(80) NOT NULL,
	"mailbox" varchar(320),
	"providerThreadId" varchar(300) NOT NULL,
	"firstProviderMessageId" varchar(300),
	"latestProviderMessageId" varchar(300),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "gsd_support_case_thread" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_support_email_message" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint,
	"source" varchar(80) DEFAULT 'email' NOT NULL,
	"sourceEventId" varchar(300) NOT NULL,
	"sourceCaseKey" varchar(300),
	"supportCaseId" varchar(80),
	"direction" varchar(20) NOT NULL,
	"eventType" varchar(80) DEFAULT 'inbound_email' NOT NULL,
	"provider" varchar(80),
	"mailbox" varchar(320),
	"providerMessageId" varchar(300),
	"providerThreadId" varchar(300),
	"replyToMessageId" varchar(300),
	"customerEmail" varchar(320),
	"customerName" varchar(200),
	"subject" text,
	"bodyText" text,
	"bodyHtml" text,
	"summary" text,
	"classification" jsonb,
	"extraction" jsonb,
	"decision" jsonb,
	"raw" jsonb,
	"processingStatus" varchar(80) DEFAULT 'received' NOT NULL,
	"receivedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "gsd_support_email_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_support_ticket_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"source" varchar(80) NOT NULL,
	"sourceEventId" varchar(300) NOT NULL,
	"sourceCaseKey" varchar(300),
	"eventType" varchar(80) NOT NULL,
	"status" varchar(80),
	"summary" text,
	"payload" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gsd_support_ticket_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gsd_support_ticket_metadata" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"externalId" varchar(200) NOT NULL,
	"source" varchar(80) NOT NULL,
	"sourceCaseKey" varchar(300),
	"supportCaseId" varchar(80),
	"sourceEventId" varchar(300),
	"sourceSystem" varchar(80),
	"userId" varchar(200),
	"emmaUserId" varchar(200),
	"email" varchar(320),
	"customerName" varchar(200),
	"issueCategory" varchar(80),
	"reportedAt" timestamp,
	"sourceChannel" varchar(80),
	"provider" varchar(80),
	"providerThreadId" varchar(300),
	"providerMessageId" varchar(300),
	"mailbox" varchar(320),
	"ariSessionId" varchar(200),
	"ariSessionUrl" text,
	"repoFullName" varchar(300),
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "gsd_support_ticket_metadata_cardId_unique" UNIQUE("cardId")
);
--> statement-breakpoint
ALTER TABLE "gsd_support_ticket_metadata" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_account" ADD CONSTRAINT "gsd_account_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_api_key" ADD CONSTRAINT "gsd_api_key_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_session" ADD CONSTRAINT "gsd_session_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_board" ADD CONSTRAINT "gsd_board_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_board" ADD CONSTRAINT "gsd_board_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_board" ADD CONSTRAINT "gsd_board_importId_gsd_import_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."gsd_import"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_board" ADD CONSTRAINT "gsd_board_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_user_board_favorites" ADD CONSTRAINT "gsd_user_board_favorites_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_user_board_favorites" ADD CONSTRAINT "gsd_user_board_favorites_boardId_gsd_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."gsd_board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_agent_run" ADD CONSTRAINT "gsd_card_agent_run_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_agent_run" ADD CONSTRAINT "gsd_card_agent_run_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_fromListId_gsd_list_id_fk" FOREIGN KEY ("fromListId") REFERENCES "public"."gsd_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_toListId_gsd_list_id_fk" FOREIGN KEY ("toListId") REFERENCES "public"."gsd_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_labelId_gsd_label_id_fk" FOREIGN KEY ("labelId") REFERENCES "public"."gsd_label"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_workspaceMemberId_gsd_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."gsd_workspace_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_commentId_gsd_card_comments_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."gsd_card_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_sourceBoardId_gsd_board_id_fk" FOREIGN KEY ("sourceBoardId") REFERENCES "public"."gsd_board"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_activity" ADD CONSTRAINT "gsd_card_activity_attachmentId_gsd_card_attachment_id_fk" FOREIGN KEY ("attachmentId") REFERENCES "public"."gsd_card_attachment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_attachment" ADD CONSTRAINT "gsd_card_attachment_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_attachment" ADD CONSTRAINT "gsd_card_attachment_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_workspace_members" ADD CONSTRAINT "gsd_card_workspace_members_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_workspace_members" ADD CONSTRAINT "gsd_card_workspace_members_workspaceMemberId_gsd_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."gsd_workspace_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card" ADD CONSTRAINT "gsd_card_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card" ADD CONSTRAINT "gsd_card_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card" ADD CONSTRAINT "gsd_card_listId_gsd_list_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."gsd_list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card" ADD CONSTRAINT "gsd_card_importId_gsd_import_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."gsd_import"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_labels" ADD CONSTRAINT "gsd_card_labels_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_labels" ADD CONSTRAINT "gsd_card_labels_labelId_gsd_label_id_fk" FOREIGN KEY ("labelId") REFERENCES "public"."gsd_label"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_comments" ADD CONSTRAINT "gsd_card_comments_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_comments" ADD CONSTRAINT "gsd_card_comments_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_comments" ADD CONSTRAINT "gsd_card_comments_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist_item" ADD CONSTRAINT "gsd_card_checklist_item_checklistId_gsd_card_checklist_id_fk" FOREIGN KEY ("checklistId") REFERENCES "public"."gsd_card_checklist"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist_item" ADD CONSTRAINT "gsd_card_checklist_item_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist_item" ADD CONSTRAINT "gsd_card_checklist_item_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist" ADD CONSTRAINT "gsd_card_checklist_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist" ADD CONSTRAINT "gsd_card_checklist_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_card_checklist" ADD CONSTRAINT "gsd_card_checklist_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_feedback" ADD CONSTRAINT "gsd_feedback_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_import" ADD CONSTRAINT "gsd_import_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_label" ADD CONSTRAINT "gsd_label_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_label" ADD CONSTRAINT "gsd_label_boardId_gsd_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."gsd_board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_label" ADD CONSTRAINT "gsd_label_importId_gsd_import_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."gsd_import"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_label" ADD CONSTRAINT "gsd_label_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_list" ADD CONSTRAINT "gsd_list_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_list" ADD CONSTRAINT "gsd_list_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_list" ADD CONSTRAINT "gsd_list_boardId_gsd_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."gsd_board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_list" ADD CONSTRAINT "gsd_list_importId_gsd_import_id_fk" FOREIGN KEY ("importId") REFERENCES "public"."gsd_import"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_integration" ADD CONSTRAINT "gsd_integration_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_slug_checks" ADD CONSTRAINT "gsd_workspace_slug_checks_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_slug_checks" ADD CONSTRAINT "gsd_workspace_slug_checks_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_members" ADD CONSTRAINT "gsd_workspace_members_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_members" ADD CONSTRAINT "gsd_workspace_members_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_members" ADD CONSTRAINT "gsd_workspace_members_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_members" ADD CONSTRAINT "gsd_workspace_members_roleId_gsd_workspace_roles_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."gsd_workspace_roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace" ADD CONSTRAINT "gsd_workspace_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace" ADD CONSTRAINT "gsd_workspace_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_subscription" ADD CONSTRAINT "gsd_subscription_referenceId_gsd_workspace_publicId_fk" FOREIGN KEY ("referenceId") REFERENCES "public"."gsd_workspace"("publicId") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_invite_links" ADD CONSTRAINT "gsd_workspace_invite_links_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_invite_links" ADD CONSTRAINT "gsd_workspace_invite_links_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_invite_links" ADD CONSTRAINT "gsd_workspace_invite_links_updatedBy_gsd_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_role_permissions" ADD CONSTRAINT "gsd_workspace_role_permissions_workspaceRoleId_gsd_workspace_roles_id_fk" FOREIGN KEY ("workspaceRoleId") REFERENCES "public"."gsd_workspace_roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_roles" ADD CONSTRAINT "gsd_workspace_roles_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_notification" ADD CONSTRAINT "gsd_notification_userId_gsd_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_notification" ADD CONSTRAINT "gsd_notification_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_notification" ADD CONSTRAINT "gsd_notification_commentId_gsd_card_comments_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."gsd_card_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_notification" ADD CONSTRAINT "gsd_notification_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_note" ADD CONSTRAINT "gsd_note_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_note" ADD CONSTRAINT "gsd_note_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_note" ADD CONSTRAINT "gsd_note_deletedBy_gsd_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."gsd_user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_webhooks" ADD CONSTRAINT "gsd_workspace_webhooks_workspaceId_gsd_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."gsd_workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_workspace_webhooks" ADD CONSTRAINT "gsd_workspace_webhooks_createdBy_gsd_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."gsd_user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_support_case_thread" ADD CONSTRAINT "gsd_support_case_thread_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_support_email_message" ADD CONSTRAINT "gsd_support_email_message_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_support_ticket_event" ADD CONSTRAINT "gsd_support_ticket_event_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gsd_support_ticket_metadata" ADD CONSTRAINT "gsd_support_ticket_metadata_cardId_gsd_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."gsd_card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_board_is_archived_idx" ON "gsd_board" USING btree ("isArchived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_board_visibility_idx" ON "gsd_board" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_board_type_idx" ON "gsd_board" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_board_source_idx" ON "gsd_board" USING btree ("sourceBoardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_boards_name_trgm_idx" ON "gsd_board" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_unique_slug_per_workspace" ON "gsd_board" USING btree ("workspaceId","slug") WHERE "gsd_board"."deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_user_board_favorite_user_idx" ON "gsd_user_board_favorites" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_user_board_favorite_board_idx" ON "gsd_user_board_favorites" USING btree ("boardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_card_agent_run_card_created_idx" ON "gsd_card_agent_run" USING btree ("cardId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_card_list_number_idx" ON "gsd_card" USING btree ("listId","cardNumber");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_cards_title_trgm_idx" ON "gsd_card" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_workspace_card_prefix_idx" ON "gsd_workspace" USING btree ("cardPrefix");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_unique_member_permission" ON "gsd_workspace_member_permissions" USING btree ("workspaceMemberId","permission");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_permission_member_idx" ON "gsd_workspace_member_permissions" USING btree ("workspaceMemberId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_unique_role_permission" ON "gsd_workspace_role_permissions" USING btree ("workspaceRoleId","permission");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_role_permissions_role_idx" ON "gsd_workspace_role_permissions" USING btree ("workspaceRoleId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_unique_role_per_workspace" ON "gsd_workspace_roles" USING btree ("workspaceId","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_workspace_roles_workspace_idx" ON "gsd_workspace_roles" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_notification_user_deleted_idx" ON "gsd_notification" USING btree ("userId","deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_notification_user_read_deleted_idx" ON "gsd_notification" USING btree ("userId","readAt","deletedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_notification_user_type_card_idx" ON "gsd_notification" USING btree ("userId","type","cardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_notification_user_type_workspace_idx" ON "gsd_notification" USING btree ("userId","type","workspaceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_notification_user_created_idx" ON "gsd_notification" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_note_workspace_updated_idx" ON "gsd_note" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_workspace_webhooks_workspace_idx" ON "gsd_workspace_webhooks" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_support_case_thread_provider_uidx" ON "gsd_support_case_thread" USING btree ("provider","mailbox","providerThreadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_case_thread_card_idx" ON "gsd_support_case_thread" USING btree ("cardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_case_thread_support_case_idx" ON "gsd_support_case_thread" USING btree ("supportCaseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_case_thread_source_case_idx" ON "gsd_support_case_thread" USING btree ("sourceCaseKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_support_email_message_source_event_uidx" ON "gsd_support_email_message" USING btree ("source","sourceEventId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_email_message_card_created_idx" ON "gsd_support_email_message" USING btree ("cardId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_email_message_case_created_idx" ON "gsd_support_email_message" USING btree ("supportCaseId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_email_message_thread_idx" ON "gsd_support_email_message" USING btree ("provider","providerThreadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_email_message_source_case_idx" ON "gsd_support_email_message" USING btree ("source","sourceCaseKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_email_message_customer_idx" ON "gsd_support_email_message" USING btree ("customerEmail");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gsd_support_ticket_event_source_event_uidx" ON "gsd_support_ticket_event" USING btree ("source","sourceEventId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_event_card_created_idx" ON "gsd_support_ticket_event" USING btree ("cardId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_event_source_case_idx" ON "gsd_support_ticket_event" USING btree ("source","sourceCaseKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_source_external_idx" ON "gsd_support_ticket_metadata" USING btree ("source","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_source_case_idx" ON "gsd_support_ticket_metadata" USING btree ("source","sourceCaseKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_support_case_idx" ON "gsd_support_ticket_metadata" USING btree ("supportCaseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_provider_thread_idx" ON "gsd_support_ticket_metadata" USING btree ("provider","providerThreadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_source_system_idx" ON "gsd_support_ticket_metadata" USING btree ("sourceSystem");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_source_channel_idx" ON "gsd_support_ticket_metadata" USING btree ("sourceChannel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_user_idx" ON "gsd_support_ticket_metadata" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gsd_support_ticket_metadata_reported_idx" ON "gsd_support_ticket_metadata" USING btree ("reportedAt");
