import * as SecureStore from "expo-secure-store";
import {
    createContext,
    PropsWithChildren,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useColorScheme } from "react-native";

type ThemePreference = "system" | "light" | "dark";

const ThemeContext = createContext<{
    preference: ThemePreference;
    isDark: boolean;
    setPreference(value: ThemePreference): void;
} | null>(null);

const THEME_KEY = "mentarie.reading.theme";

export const ReadingThemeProvider = ({ children }: PropsWithChildren) => {
    const system = useColorScheme();
    const [preference, setPreferenceState] =
        useState<ThemePreference>("system");
    useEffect(() => {
        void SecureStore.getItemAsync(THEME_KEY).then((value) => {
            if (value === "light" || value === "dark" || value === "system") {
                setPreferenceState(value);
            }
        });
    }, []);
    const setPreference = (value: ThemePreference) => {
        setPreferenceState(value);
        void SecureStore.setItemAsync(THEME_KEY, value);
    };
    const value = useMemo(
        () => ({
            preference,
            isDark:
                preference === "dark" ||
                (preference === "system" && system !== "light"),
            setPreference,
        }),
        [preference, system]
    );
    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
};

export const useReadingTheme = () => {
    const context = useContext(ThemeContext);
    if (!context)
        throw new Error(
            "useReadingTheme must be used inside ReadingThemeProvider"
        );
    return context;
};
