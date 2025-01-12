import { PutObjectCommand, S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"

const s3Client = new S3Client({
    endpoint: process.env.DO_SPACES_ENDPOINT!,
    region: "us-east-1",
    credentials: {
        accessKeyId: process.env.DO_SPACES_KEY!,
        secretAccessKey: process.env.DO_SPACES_SECRET!
    }
})

export const uploadFile = async (key: string, file: Buffer) => {
    const command = new PutObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key,
        Body: file,
        ACL: "private"
    });
    return s3Client.send(command);
}

export const getFile = async (key: string) => {
    const command = new GetObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
        throw new Error("No response body")  
    }

    const streamBody = response.Body as any;
    const chunks = [];

    for await (const chunk of streamBody) {
        chunks.push(chunk)
    }
    
    return Buffer.concat(chunks) 
}

export const deleteFile = async (key: string) => {
    const command = new DeleteObjectCommand({
        Bucket: process.env.DO_SPACES_NAME,
        Key: key
    })

    return await s3Client.send(command);
}