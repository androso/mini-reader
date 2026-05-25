import { User } from "./index";

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            DO_SPACES_KEY: string;
            DO_SPACES_SECRET: string;
            DO_SPACES_ENDPOINT: string;
            DO_SPACES_NAME: string;
            OPENAI_API_KEY: string;
            CHROMA_URL: string;
            CHROMA_CLIENT_AUTH_CREDENTIALS: string;
            DATABASE_URL: string;
            DEV_USER_EMAIL?: string;
            DEV_USER_NAME?: string;
            JWT_SECRET: string;
            LOCAL_STORAGE_DIR?: string;
            NODE_ENV?: string;
            STORAGE_DRIVER?: "s3" | "local";
        }
    }

    namespace Express {
        interface Request {
            user: User;
        }
    }
}

export {};
