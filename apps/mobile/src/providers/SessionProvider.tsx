import type { MobileSession } from "@reader/contracts";
import {
    createContext,
    PropsWithChildren,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    apiFetch,
    apiJson,
    clearStoredSession,
    currentRefreshToken,
    hydrateStoredSession,
    persistSession,
    registerInvalidSessionHandler,
} from "@/lib/api";
import { clearPrivateDatabase } from "@/lib/database";
import { clearPrivateFiles } from "@/lib/downloads";

type Credentials = { email: string; password: string };
type SignupDetails = Credentials & { username: string };

type SessionContextValue = {
    session: MobileSession | null;
    isHydrating: boolean;
    signIn(input: Credentials): Promise<void>;
    signUp(input: SignupDetails): Promise<void>;
    signOut(): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export const SessionProvider = ({ children }: PropsWithChildren) => {
    const [session, setSession] = useState<MobileSession | null>(null);
    const [isHydrating, setHydrating] = useState(true);

    const clearPrivateSession = useCallback(async () => {
        await Promise.allSettled([
            clearStoredSession(),
            clearPrivateDatabase(),
            clearPrivateFiles(),
        ]);
        setSession(null);
    }, []);

    useEffect(() => {
        registerInvalidSessionHandler(clearPrivateSession);
        void hydrateStoredSession()
            .then(setSession)
            .finally(() => setHydrating(false));
        return () => registerInvalidSessionHandler(null);
    }, [clearPrivateSession]);

    const authenticate = useCallback(
        async (
            route: "/api/auth/mobile/login" | "/api/auth/mobile/signup",
            input: Credentials | SignupDetails
        ) => {
            const nextSession = await apiJson<MobileSession>(route, {
                method: "POST",
                body: JSON.stringify(input),
            });
            await persistSession(nextSession);
            setSession(nextSession);
        },
        []
    );

    const signOut = useCallback(async () => {
        const refreshToken = currentRefreshToken();
        if (refreshToken) {
            await apiFetch(
                "/api/auth/mobile/logout",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        refreshToken,
                    }),
                },
                false
            ).catch(() => undefined);
        }
        await clearPrivateSession();
    }, [clearPrivateSession]);

    const value = useMemo<SessionContextValue>(
        () => ({
            session,
            isHydrating,
            signIn: (input) => authenticate("/api/auth/mobile/login", input),
            signUp: (input) => authenticate("/api/auth/mobile/signup", input),
            signOut,
        }),
        [authenticate, isHydrating, session, signOut]
    );
    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
};

export const useSession = () => {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used inside SessionProvider");
    }
    return context;
};
