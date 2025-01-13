import JSZip from "jszip";
import crypto from "crypto";
import { Metadata } from "../types";

export async function extractMetadata(file: Buffer): Promise<Metadata> {
  const zip = new JSZip();
  await zip.loadAsync(file);

  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new Error("Invalid EPUB: Missing container.xml");
  }

  const metadata: Metadata = {

  };
  
  try {
    // Parse container.xml to get OPF path
    const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
    if (!opfPath) {
      throw new Error("Cannot find OPF file path");
    }
    const opfContent  = await zip.file(opfPath)?.async("text");
    if(opfContent ){
        metadata.title = opfContent.match(/<dc:title[^>]*>([^<]+)/)?.[1];
        metadata.creator = opfContent.match(/<dc:creator[^>]*>([^<]+)/)?.[1];
        metadata.identifier = opfContent.match(/<dc:identifier[^>]*>([^<]+)/)?.[1];
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
      identifier: metadata.identifier?.trim()
      // Intentionally exclude size as it might vary slightly
    };
    
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(normalized));
    return hash.digest("hex");
  }


