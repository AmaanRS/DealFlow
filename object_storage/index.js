import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateBase64(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new TypeError("data must be a non-empty base64 string");
  }
  return value;
}

export class ObjectStorage {
  constructor(
    {
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle = true,
    },
    { client } = {},
  ) {
    this.bucket = requiredString(bucket, "bucket");
    this.client =
      client ??
      new S3Client({
        endpoint: requiredString(endpoint, "endpoint"),
        region: requiredString(region, "region"),
        forcePathStyle,
        credentials: {
          accessKeyId: requiredString(accessKeyId, "accessKeyId"),
          secretAccessKey: requiredString(secretAccessKey, "secretAccessKey"),
        },
      });
  }

  async checkHealth() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async putBase64Object({ key, data, metadata = {} }) {
    const objectKey = requiredString(key, "key");
    const base64 = validateBase64(data);
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: base64,
        ContentType: "text/plain; charset=utf-8",
        Metadata: {
          "stored-encoding": "base64",
          "source-content-type": "application/pdf",
          ...metadata,
        },
      }),
    );

    return {
      bucket: this.bucket,
      key: objectKey,
      etag: result.ETag ?? null,
      versionId: result.VersionId ?? null,
    };
  }

  async getObjectText(key) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: requiredString(key, "key"),
      }),
    );
    return result.Body.transformToString();
  }

  async deleteObject(key) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: requiredString(key, "key"),
      }),
    );
  }
}

export function createObjectStorage(configuration, options) {
  return new ObjectStorage(configuration, options);
}
