import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as sharedUtils from "@kan/shared/utils";
import * as boardRepo from "@kan/db/repository/board.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
  getByPublicId: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@kan/shared/utils", async () => {
  const actual = await vi.importActual<typeof sharedUtils>(
    "@kan/shared/utils",
  );

  return {
    ...actual,
    generateAvatarUrl: vi.fn(),
  };
});

const mockGetWorkspaceAndBoardIdByBoardPublicId =
  boardRepo.getWorkspaceAndBoardIdByBoardPublicId as ReturnType<typeof vi.fn>;
const mockGetByPublicId = boardRepo.getByPublicId as ReturnType<typeof vi.fn>;
const mockAssertPermission = assertPermission as ReturnType<typeof vi.fn>;

const mockDb = {} as never;
const mockUser = {
  id: "user-123",
  name: "Test User",
  email: "test@example.com",
};

const boardResult = {
  publicId: "board-123456",
  name: "Customer Support",
  slug: "customer-support",
  visibility: "private" as const,
  isArchived: false,
  favorite: false,
  workspace: {
    publicId: "workspace-123",
    cardPrefix: "RS",
    members: [],
  },
  labels: [],
  lists: [
    {
      publicId: "list-1234567",
      name: "New",
      index: 0,
      cards: [
        {
          publicId: "card-1234567",
          title: "Support ticket",
          description: null,
          index: 0,
          createdAt: new Date("2026-05-16T10:00:00.000Z"),
          updatedAt: null,
          dueDate: null,
          priority: "medium" as const,
          cardNumber: 14,
          supportTicketMetadata: {
            externalId: "emma-support:test",
            source: "ari_gold",
            sourceSystem: "ari_gold",
            userId: "auth-user-123",
            emmaUserId: "emma-user-123",
            email: "creator@example.com",
            customerName: "Creator",
            issueCategory: "product_debug",
            reportedAt: new Date("2026-05-16T13:43:18.075Z"),
            sourceChannel: "whatsapp",
            ariSessionId: "ari-sess-123",
            ariSessionUrl: "https://admin.example.com/ari-gold/ari-sess-123",
          },
          labels: [],
          members: [],
          attachments: [],
          checklists: [],
          comments: [],
        },
      ],
    },
  ],
  allLists: [{ publicId: "list-1234567", name: "New" }],
};

describe("board router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPermission.mockResolvedValue(undefined);
    mockGetWorkspaceAndBoardIdByBoardPublicId.mockResolvedValue({
      workspaceId: 42,
      boardId: 7,
    });
    mockGetByPublicId.mockResolvedValue(boardResult);
  });

  it("passes support ticket filters to the board repository", async () => {
    const { boardRouter } = await import("./board");

    const reportedFrom = new Date("2026-05-16T00:00:00.000Z");
    const reportedTo = new Date("2026-05-16T23:59:59.000Z");
    const updatedFrom = new Date("2026-05-15T00:00:00.000Z");
    const updatedTo = new Date("2026-05-16T14:00:00.000Z");

    await boardRouter
      .createCaller({ user: mockUser, db: mockDb } as never)
      .byId({
        boardPublicId: "board-123456",
        sources: ["emma"],
        supportUserId: "auth-user-123",
        sourceSystem: "ari_gold",
        sourceChannel: "whatsapp",
        reportedFrom,
        reportedTo,
        updatedFrom,
        updatedTo,
      });

    expect(mockGetByPublicId).toHaveBeenCalledWith(
      mockDb,
      "board-123456",
      mockUser.id,
      expect.objectContaining({
        sources: ["emma"],
        supportUserId: "auth-user-123",
        sourceSystem: "ari_gold",
        sourceChannel: "whatsapp",
        reportedAt: { from: reportedFrom, to: reportedTo },
        updatedAt: { from: updatedFrom, to: updatedTo },
      }),
    );
  });

  it("returns NOT_FOUND when the board lookup misses", async () => {
    const { boardRouter } = await import("./board");
    mockGetWorkspaceAndBoardIdByBoardPublicId.mockResolvedValueOnce(null);

    await expect(
      boardRouter.createCaller({ user: mockUser, db: mockDb } as never).byId({
        boardPublicId: "board-123456",
      }),
    ).rejects.toThrow(TRPCError);
  });
});
