import { S3 } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

export class S3Service {
    private s3: S3;
    private bucketName: string;

    constructor(bucketName: string) {
        this.bucketName = process.env.S3_BUCKET_NAME || bucketName;
        this.s3 = new S3({
            endpoint: process.env.S3_ENDPOINT,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
            },
            region: process.env.S3_REGION || "us-east-1",
        });
    }
    //retieve file from s3
    async downloadFile(key: string, localPath: string): Promise<boolean> {
        try {
            const response = await this.s3.getObject({
                Bucket: this.bucketName,
                Key: key,
            });

            if (response.Body) {
                // Write stream to file
                const fs = require("fs");
                await fs.promises.writeFile(
                    localPath,
                    await response.Body.transformToByteArray()
                );
                return true;
            }
            return false;
        } catch (error) {
            console.error("Error downloading file:", error);
            return false;
        }
    }
}
