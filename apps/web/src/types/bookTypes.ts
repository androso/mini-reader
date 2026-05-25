export interface Book {
    id: string;
    title: string;
    userId: string;
    fileKey: string;
    fileType?: "epub" | "pdf" | null;
    createdAt: Date;
}

export interface BookWithUser extends Book {
    user: {
        id: string;
        email: string;
        name: string;
        image?: string | null;
        googleId?: string | null;
        createdAt: Date;
        updatedAt: Date;
    };
}
