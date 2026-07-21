import "./observability/bootstrap";
import app from "./app";
import swaggerdocs from "./utils/swagger";
import { startHttpServer } from "./server";

swaggerdocs(app);
startHttpServer(app);
