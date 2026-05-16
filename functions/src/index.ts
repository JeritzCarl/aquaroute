import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import Busboy from "busboy";                     // ✅ correct default import for v1
import { v4 as uuidv4 } from "uuid";

admin.initializeApp();
const bucket = admin.storage().bucket();

export const uploadPermit = functions.https.onRequest((req, res): void => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const busboy = Busboy({ headers: req.headers });  // ✅ Busboy v1 constructor call
  const fields: Record<string, string> = {};
  let uploadFile: { file: NodeJS.ReadableStream; fileRef: any; mimetype: string } | null = null;

  busboy.on(
    "file",
    (
      fieldname: string,
      file: NodeJS.ReadableStream,
      filename: string,
      encoding: string,
      mimetype: string
    ) => {
      const newFilename = `permits/${uuidv4()}_${filename}`;
      const fileRef = bucket.file(newFilename);     // ✅ use generic “any”
      uploadFile = { file, fileRef, mimetype };
    }
  );

  busboy.on("field", (fieldname: string, value: string) => {
    fields[fieldname] = value;
  });

  busboy.on("finish", async () => {
    if (!uploadFile) {
      res.status(400).send("No file uploaded.");
      return;
    }

    const { file, fileRef, mimetype } = uploadFile;

    file
      .pipe(
        fileRef.createWriteStream({
          metadata: { contentType: mimetype },
        })
      )
      .on("error", (err: any) => {
        console.error("Upload error:", err);
        res.status(500).send("Upload failed.");
      })
      .on("finish", async () => {
        const [url] = await fileRef.getSignedUrl({
          action: "read",
          expires: "03-01-2100",
        });
        res.status(200).json({ permitUrl: url });
      });
  });

  req.pipe(busboy);
});
