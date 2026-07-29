import {
    NativeSyntheticEvent,
    StyleSheet,
    Text,
    TextInput,
    TextInputFocusEventData,
    TextInputProps,
    View,
} from "react-native";
import { useState } from "react";
import { color, radius, space, type } from "@/theme/tokens";

type Props = TextInputProps & {
    label: string;
    helper?: string;
    error?: string | null;
    touched?: boolean;
    onBlur?: (event: NativeSyntheticEvent<TextInputFocusEventData>) => void;
};

export const FormField = ({
    label,
    helper,
    error,
    touched,
    onBlur,
    ...inputProps
}: Props) => {
    const showError = Boolean(touched && error);
    const [focused, setFocused] = useState(false);
    return (
        <View style={styles.group}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                {...inputProps}
                accessibilityLabel={label}
                accessibilityHint={showError ? (error ?? undefined) : helper}
                accessibilityState={{ disabled: inputProps.editable === false }}
                onFocus={(event) => {
                    setFocused(true);
                    inputProps.onFocus?.(event);
                }}
                onBlur={(event) => {
                    setFocused(false);
                    onBlur?.(event);
                }}
                placeholderTextColor={color.ink2}
                style={[
                    styles.input,
                    focused && styles.inputFocused,
                    showError && styles.inputError,
                    inputProps.editable === false && styles.inputDisabled,
                    inputProps.style,
                ]}
            />
            <Text
                accessibilityLiveRegion="polite"
                style={[styles.helper, showError && styles.error]}
            >
                {showError ? error : (helper ?? " ")}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    group: { gap: space.xxs },
    label: {
        color: color.ink,
        fontFamily: type.medium,
        fontSize: 14,
    },
    input: {
        minHeight: 48,
        borderWidth: 1,
        borderColor: color.rule,
        borderRadius: radius.md,
        paddingHorizontal: space.md,
        paddingRight: space.xl,
        backgroundColor: color.paper,
        color: color.ink,
        fontFamily: type.body,
        fontSize: 16,
    },
    inputError: { borderColor: color.coral },
    inputFocused: {
        borderColor: color.focus,
        shadowColor: color.focus,
        shadowOpacity: 0.4,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
    },
    inputDisabled: { opacity: 0.55 },
    helper: {
        minHeight: 20,
        color: color.ink2,
        fontFamily: type.body,
        fontSize: 13,
    },
    error: { color: color.coral },
});
