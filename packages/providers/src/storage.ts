import {
    DeleteObjectCommand,
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";

export interface StorageProvider {
    uploadFile(key: string, file: Buffer): Promise<unknown>;
    getFile(key: string): Promise<Buffer>;
    deleteFile(key: string): Promise<unknown>;
}

export interface ObjectStorageProviderOptions {
    storageDriver?: "local" | "s3";
    localStorageDir?: string;
    s3Client?: Pick<S3Client, "send">;
    bucketName?: string;
}

export class ObjectStorageProvider implements StorageProvider {
    private readonly s3Client: Pick<S3Client, "send">;
    private readonly storageDriver: "local" | "s3";
    private readonly localStorageDir: string;
    private readonly bucketName: string | undefined;

    constructor(options: ObjectStorageProviderOptions = {}) {
        this.storageDriver =
            options.storageDriver ??
            ((process.env.STORAGE_DRIVER as "local" | "s3" | undefined) ||
                "s3");
        this.bucketName = options.bucketName ?? process.env.S3_BUCKET_NAME;

        if (options.s3Client) {
            this.s3Client = options.s3Client;
        } else {
            const endpoint = process.env.S3_ENDPOINT;
            this.s3Client = new S3Client({
                ...(endpoint ? { endpoint } : {}),
                region: process.env.S3_REGION || "us-east-1",
            });
        }

        if (options.localStorageDir) {
            this.localStorageDir = options.localStorageDir;
        } else {
            const platformRoot = path.resolve(__dirname, "../../..");
            this.localStorageDir = process.env.LOCAL_STORAGE_DIR
                ? path.resolve(platformRoot, process.env.LOCAL_STORAGE_DIR)
                : path.resolve(platformRoot, ".local-storage");
        }
    }

    private localFilePath(key: string) {
        const resolvedPath = path.resolve(this.localStorageDir, key);
        const storageRoot = path.resolve(this.localStorageDir);

        if (!resolvedPath.startsWith(`${storageRoot}${path.sep}`)) {
            throw new Error("Invalid storage key");
        }

        return resolvedPath;
    }

    async uploadFile(key: string, file: Buffer) {
        if (this.storageDriver === "local") {
            const filePath = this.localFilePath(key);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, file);
            return { key, path: filePath };
        }

        return this.s3Client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: file,
            })
        );
    }

    async getFile(key: string) {
        if (this.storageDriver === "local") {
            return fs.readFile(this.localFilePath(key));
        }

        const response = await this.s3Client.send(
            new GetObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            })
        );
        if (!response.Body) {
            throw new Error("No response body");
        }

        const chunks = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    }

    async deleteFile(key: string) {
        if (this.storageDriver === "local") {
            await fs.rm(this.localFilePath(key), { force: true });
            return { key };
        }

        return this.s3Client.send(
            new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            })
        );
    }
}

export const storageProvider = new ObjectStorageProvider();

export const uploadFile = (key: string, file: Buffer) =>
    storageProvider.uploadFile(key, file);

export const getFile = (key: string) => storageProvider.getFile(key);

export const deleteFile = (key: string) => storageProvider.deleteFile(key);
