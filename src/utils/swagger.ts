import doc from 'swagger-jsdoc';
import ui from 'swagger-ui-express';
import { Express, Request, Response } from 'express';

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "Mentarie API",
            version: "1.0.0",
            description: "Mentarie API Documentation to provide all the endpoints, and how to use it to interact with the application",
        },
        servers:
            [
                {
                    url: `http://localhost:3000`,
                },
            ],
    },
    apis: ["./src/routes/*.ts"],
}
// Initialize swagger-jsdoc
const spec = doc(options);

const swaggerdocs = (app: Express, port: any) => {
    app.use('/api-docs', ui.serve, ui.setup(spec));
    app.get('/api-docs', (req: Request, res: Response) => {
        res.json(spec);
    });
}

export default swaggerdocs;