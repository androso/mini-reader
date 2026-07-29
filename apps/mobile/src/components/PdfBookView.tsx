import Pdf from "react-native-pdf";
import { Keyboard, StyleSheet, View } from "react-native";
import { apiUrl, authorizedHeaders } from "@/lib/api";
import { color } from "@/theme/tokens";

export const PdfBookView = ({
    bookId,
    offlineUri,
    initialPage,
    onPage,
}: {
    bookId: string;
    offlineUri: string | null;
    initialPage: number;
    onPage(page: number): void;
}) => (
    <View style={styles.root}>
        <Pdf
            source={
                offlineUri
                    ? { uri: offlineUri }
                    : {
                          uri: apiUrl(`/api/books/${bookId}`),
                          headers: authorizedHeaders(),
                          cache: true,
                      }
            }
            page={Math.max(1, initialPage)}
            trustAllCerts={false}
            enablePaging
            horizontal={false}
            onPageChanged={onPage}
            onPageSingleTap={() => Keyboard.dismiss()}
            style={styles.pdf}
        />
    </View>
);

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: color.darkPaper },
    pdf: { flex: 1, backgroundColor: color.darkPaper },
});
