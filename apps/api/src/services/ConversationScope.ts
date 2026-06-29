export type ConversationScope = {
    userId: string;
    resourceType: string;
    resourceId: string;
};

export const isValidResourceType = (
    resourceType: string
): resourceType is "book" | "article" =>
    resourceType === "book" || resourceType === "article";

export const isConversationInScope = (
    conversation: ConversationScope,
    scope: ConversationScope
) =>
    conversation.userId === scope.userId &&
    conversation.resourceType === scope.resourceType &&
    conversation.resourceId === scope.resourceId;
