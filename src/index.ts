import app from "./app";
import swaggerdocs from "./utils/swagger";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  swaggerdocs(app, PORT);
});