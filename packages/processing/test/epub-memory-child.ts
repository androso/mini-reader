import fs from "node:fs";
import path from "node:path";
import { extractEpubChunks } from "../src/epubIngestion";

async function main() {
    const fixturePath = path.resolve(
        process.cwd(),
        "../../.local-storage/epub-bacadba17183"
    );
    const buffer = fs.readFileSync(fixturePath);
    const chunks = await extractEpubChunks(buffer);
    if (!chunks || chunks.length === 0) {
        throw new Error("No chunks extracted from EPUB fixture");
    }
    console.log(`EPUB_EXTRACTION_OK:${chunks.length}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
