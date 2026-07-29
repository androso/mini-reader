import { Redirect, Stack } from "expo-router";
import { useSession } from "@/providers/SessionProvider";

export default function AuthLayout() {
    const { session } = useSession();
    if (session) return <Redirect href="/(app)/library" />;
    return <Stack screenOptions={{ headerShown: false }} />;
}
