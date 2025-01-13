// src/controllers/QueryController.ts
import { Request, Response } from "express";
import { ProcessQueryRequest, QueryResponse } from "../types";
import { EPUBProcessor } from "../services/EPUBProcessor";

// Define QueryController class
export class QueryController {
  private epubProcessor: EPUBProcessor;

  // Initialize EPUBProcessor with bucket name
  constructor(bucketName: string) {
    this.epubProcessor = new EPUBProcessor(bucketName);
  }

  // Define query handler function for Express route handler
  async handleQuery(
    req: Request<{}, {}, ProcessQueryRequest>,
    res: Response<QueryResponse>
  ) {
    try {
      const { fileKey, query } = req.body;
      const result = await this.epubProcessor.processAndQuery(fileKey, query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: `Server error: ${error}` });
    }
  }

  async handleDelete(req: Request, res: Response) {
    try {
      const { collectionName } = req.params;
      const success = await this.epubProcessor.deleteCollection(collectionName);

      if (success) {
        res
          .status(200)
          .json({
            message: `Collection ${collectionName} deleted successfully`,
          });
      } else {
        res.status(500).json({ error: "Failed to delete collection" });
      }
    } catch (error) {
      res.status(500).json({ error: "Error deleting collection" });
    }
  }
}

export const queryController = new QueryController(
  process.env.DO_SPACES_NAME || ""
);
