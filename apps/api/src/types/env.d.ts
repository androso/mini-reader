import { User } from "./index";

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            AWS_ACCESS_KEY_ID: string;
            AWS_SECRET_ACCESS_KEY: string;
            S3_ENDPOINT: string;
            S3_BUCKET_NAME: string;
            S3_REGION?: string;
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
