import { User } from "./index";

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            S3_ENDPOINT?: string;
            S3_BUCKET_NAME: string;
            S3_REGION?: string;
            OPENAI_API_KEY: string;
            CHROMA_URL: string;
            CHROMA_CLIENT_AUTH_CREDENTIALS: string;
            DATABASE_URL: string;
            REDIS_URL: string;
            DEV_USER_EMAIL?: string;
            DEV_USER_NAME?: string;
            JWT_SECRET: string;
            LOCAL_STORAGE_DIR?: string;
            NODE_ENV?: string;
            STORAGE_DRIVER?: "s3" | "local";
            LOG_LEVEL?: "debug" | "info" | "warn" | "error";
            LANGFUSE_PUBLIC_KEY?: string;
            LANGFUSE_SECRET_KEY?: string;
            LANGFUSE_BASE_URL?: string;
            LANGFUSE_SAMPLE_RATE?: string;
            LANGFUSE_CAPTURE_CONTENT?: "metadata" | "snippets";
            LANGFUSE_MAX_CAPTURE_CHARS?: string;
        }
    }

    namespace Express {
        interface Request {
            user: User;
        }
    }
}

export {};
