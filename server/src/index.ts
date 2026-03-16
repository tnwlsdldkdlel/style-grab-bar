import "dotenv/config";
import express from "express";
import cors from "cors";
import { extractRouter } from "./routes/extract";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/api", extractRouter);

app.listen(PORT, () => {
  console.log(`StyleGrabber server running on http://localhost:${PORT}`);
});
