import { Redirect, Stack } from "expo-router";
import { useSession } from "@/providers/SessionProvider";
import { ProgressSync } from "@/components/ProgressSync";

export default function AppLayout() {
    const { session, isHydrating } = useSession();
    if (!isHydrating && !session) return <Redirect href="/(auth)/login" />;
    return (
        <>
            <ProgressSync />
            <Stack
                screenOptions={{
                    headerShown: false,
                    animation: "fade",
                    gestureEnabled: true,
                }}
            />
        </>
    );
}
