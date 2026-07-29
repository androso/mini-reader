import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    useFonts as useJakartaFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
    JetBrainsMono_500Medium,
    useFonts as useMonoFonts,
} from "@expo-google-fonts/jetbrains-mono";
import {
    Literata_400Regular,
    useFonts as useReaderFonts,
} from "@expo-google-fonts/literata";
import { SessionProvider } from "@/providers/SessionProvider";
import { ReadingThemeProvider } from "@/providers/ReadingThemeProvider";

void SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, staleTime: 20_000 },
        mutations: { retry: 0 },
    },
});

export default function RootLayout() {
    const [jakartaLoaded] = useJakartaFonts({
        PlusJakartaSans_400Regular,
        PlusJakartaSans_500Medium,
        PlusJakartaSans_600SemiBold,
        PlusJakartaSans_700Bold,
    });
    const [monoLoaded] = useMonoFonts({ JetBrainsMono_500Medium });
    const [readerLoaded] = useReaderFonts({ Literata_400Regular });
    const loaded = jakartaLoaded && monoLoaded && readerLoaded;
    useEffect(() => {
        if (loaded) void SplashScreen.hideAsync();
    }, [loaded]);
    if (!loaded) return null;

    return (
        <SafeAreaProvider>
            <QueryClientProvider client={queryClient}>
                <ReadingThemeProvider>
                    <SessionProvider>
                        <StatusBar style="light" />
                        <Stack screenOptions={{ headerShown: false }} />
                    </SessionProvider>
                </ReadingThemeProvider>
            </QueryClientProvider>
        </SafeAreaProvider>
    );
}
