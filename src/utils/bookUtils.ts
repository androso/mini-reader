import JSZip from "jszip";
import crypto from "crypto";
import { Metadata } from "../types";
import { parseStringPromise } from "xml2js";

export async function extractMetadata(file: Buffer): Promise<Metadata> {
  const zip = new JSZip();
  await zip.loadAsync(file);

  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new Error("Invalid EPUB: Missing container.xml");
  }

  const metadata: Metadata = {};

  try {
    // Parse container.xml properly
    const container = await parseStringPromise(containerXml);
    const opfPath = container.container.rootfiles[0].rootfile[0].$["full-path"];

    if (!opfPath) {
      throw new Error("Cannot find OPF file path");
    }

    const opfContent = await zip.file(opfPath)?.async("text");
    if (opfContent) {
      const opf = await parseStringPromise(opfContent);
      const meta = opf.package.metadata[0];

      // Handle potential arrays of values
      metadata.title = meta["dc:title"]?.[0]?._ || meta["dc:title"]?.[0];
      metadata.creator = meta["dc:creator"]?.[0]?._ || meta["dc:creator"]?.[0];
      metadata.identifier =
        meta["dc:identifier"]?.[0]?._ || meta["dc:identifier"]?.[0];
    }
  } catch (err) {
    console.error("Error extracting metadata", err);
    throw err;
  }

  return metadata;
}

//create a hast per metadata book
export function createHash(metadata: Metadata): string {
  // Sort properties to ensure consistent order
  const normalized = {
    title: metadata.title?.trim(),
    creator: metadata.creator?.trim(),
    identifier: metadata.identifier?.trim(),
  };

  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(normalized));
  return hash.digest("hex");
}
