declare namespace NodeJS{
    interface ProcessEnv{
        DO_SPACES_KEY : string;
        DO_SPACES_SECRET : string;
        DO_SPACES_ENDPOINT : string;
        DO_SPACES_NAME : string;
        OPENAI_API_KEY : string;
        CHROMA_URL : string;
        CHROMA_CLIENT_AUTH_CREDENTIALS : string;
        DATABASE_URL : string;
    }
}