export type SupportedChatResourceType = "book";

export type ChatResourceAuthorizationRepository = {
    findBookById: (
        resourceId: string
    ) => Promise<{ id: string; userId: string } | null>;
};

export type ChatResourceAuthorizationFailure = {
    ok: false;
    status: 400 | 403 | 404;
    error: string;
};

export type ChatResourceAuthorizationResult =
    | { ok: true; resourceType: SupportedChatResourceType }
    | ChatResourceAuthorizationFailure;

export type AuthorizedChatResourceOperationResult<T> =
    | { ok: true; resourceType: SupportedChatResourceType; value: T }
    | ChatResourceAuthorizationFailure;

export type ScopedChatConversationFailure = {
    ok: false;
    status: 404;
    error: "Conversation not found";
};

export const isSupportedChatResourceType = (
    resourceType: string
): resourceType is SupportedChatResourceType => resourceType === "book";

export const authorizeChatResource = async ({
    resourceType,
    resourceId,
    userId,
    repository,
}: {
    resourceType: string;
    resourceId: string;
    userId: string;
    repository: ChatResourceAuthorizationRepository;
}): Promise<ChatResourceAuthorizationResult> => {
    if (!isSupportedChatResourceType(resourceType)) {
        return {
            ok: false,
            status: 400,
            error: "Unsupported resource type",
        };
    }

    const book = await repository.findBookById(resourceId);
    if (!book) {
        return { ok: false, status: 404, error: "Book not found" };
    }

    if (book.userId !== userId) {
        return { ok: false, status: 403, error: "Book access denied" };
    }

    return { ok: true, resourceType };
};

/**
 * Keeps every route side effect behind the resource authorization boundary.
 * Route callbacks may insert rows, start SSE, retrieve context, or call a model;
 * none of them are reachable for a rejected resource.
 */
export const runAuthorizedChatResourceOperation = async <T>({
    resourceType,
    resourceId,
    userId,
    repository,
    operation,
}: {
    resourceType: string;
    resourceId: string;
    userId: string;
    repository: ChatResourceAuthorizationRepository;
    operation: (resourceType: SupportedChatResourceType) => Promise<T>;
}): Promise<AuthorizedChatResourceOperationResult<T>> => {
    const authorization = await authorizeChatResource({
        resourceType,
        resourceId,
        userId,
        repository,
    });
    if (!authorization.ok) return authorization;

    return {
        ok: true,
        resourceType: authorization.resourceType,
        value: await operation(authorization.resourceType),
    };
};

export const runAuthorizedScopedChatConversationOperation = async <
    TConversation,
    TResult,
>({
    resourceType,
    resourceId,
    userId,
    conversationId,
    repository,
    findScopedConversation,
    operation,
}: {
    resourceType: string;
    resourceId: string;
    userId: string;
    conversationId: string;
    repository: ChatResourceAuthorizationRepository;
    findScopedConversation: (input: {
        conversationId: string;
        userId: string;
        resourceType: SupportedChatResourceType;
        resourceId: string;
    }) => Promise<TConversation | null>;
    operation: (
        conversation: TConversation,
        resourceType: SupportedChatResourceType
    ) => Promise<TResult>;
}): Promise<
    | AuthorizedChatResourceOperationResult<TResult>
    | ScopedChatConversationFailure
> => {
    const authorization = await authorizeChatResource({
        resourceType,
        resourceId,
        userId,
        repository,
    });
    if (!authorization.ok) return authorization;

    const conversation = await findScopedConversation({
        conversationId,
        userId,
        resourceType: authorization.resourceType,
        resourceId,
    });
    if (!conversation) {
        return {
            ok: false,
            status: 404,
            error: "Conversation not found",
        };
    }

    return {
        ok: true,
        resourceType: authorization.resourceType,
        value: await operation(conversation, authorization.resourceType),
    };
};
