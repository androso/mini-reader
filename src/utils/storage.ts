import {
    PutObjectCommand,
    S3Client,
    GetObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

const s3Client = new S3Client({
    endpoint: process.env.DO_SPACES_ENDPOINT!,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY!,
        secretAccessKey: process.env.DO_SPACES_SECRET!,
    },
});

const storageDriver = process.env.STORAGE_DRIVER || "s3";
const localStorageDir =
    process.env.LOCAL_STORAGE_DIR ||
    path.resolve(process.cwd(), ".local-storage");

const localFilePath = (key: string) => {
    const resolvedPath = path.resolve(localStorageDir, key);
    const storageRoot = path.resolve(localStorageDir);

    if (!resolvedPath.startsWith(`${storageRoot}${path.sep}`)) {
        throw new Error("Invalid storage key");
    }

    return resolvedPath;
};

export const uploadFile = async (key: string, file: Buffer) => {
    if (storageDriver === "local") {
        const filePath = localFilePath(key);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file);
        return { key, path: filePath };
    }

    const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key,
        Body: file,
        ACL: "private",
    });
    return s3Client.send(command);
};

export const getFile = async (key: string) => {
    if (storageDriver === "local") {
        return fs.readFile(localFilePath(key));
    }

    const command = new GetObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
        throw new Error("No response body");
    }

    const streamBody = response.Body as any;
    const chunks = [];

    for await (const chunk of streamBody) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
};

export const deleteFile = async (key: string) => {
    if (storageDriver === "local") {
        await fs.rm(localFilePath(key), { force: true });
        return { key };
    }

    const command = new DeleteObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key,
    });

    return await s3Client.send(command);
};
