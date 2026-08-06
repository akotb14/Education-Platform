/**
 * Shared multer configuration.
 *
 * The four routers used to declare their own diskStorage config, each
 * accepting any file type with no size limit — and the uploaded files are
 * served back from the same origin via express.static. An uploaded .html or
 * .svg is therefore a stored-XSS vector: it executes with the origin's
 * privileges and can read the localStorage JWT.
 *
 * This is the single choke point: whitelist extensions and cap the size.
 */
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Which file types are allowed to be uploaded, per use case.
const ALLOWED_EXTENSIONS = {
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  pdf: [".pdf"],
};

const MAX_SIZE = {
  image: 5 * 1024 * 1024, // 5 MB
  pdf: 10 * 1024 * 1024, // 10 MB
};

/* Cap on how many files one request may carry. The add-assessment form uses
 * upload.any(), because its image fields are generated per question and there
 * is no fixed list of names to declare — and .any() with no `files` limit
 * accepts however many parts a client chooses to send. This matches the 50
 * questions the form allows, plus a little slack.
 */
const MAX_FILES = 60;

function makeStorage(destinationDir) {
  // multer does not create the destination directory; make sure it exists so
  // uploads do not fail at runtime (documantion/ did not exist on disk).
  fs.mkdirSync(destinationDir, { recursive: true });

  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destinationDir),
    filename: (req, file, cb) => {
      const safeName = file.originalname.replace(/\s+/g, "-");
      cb(null, `${Date.now()}_${safeName}`);
    },
  });
}

function makeUploader({ destination, kind }) {
  const allowed = ALLOWED_EXTENSIONS[kind];

  return multer({
    storage: makeStorage(destination),
    limits: { fileSize: MAX_SIZE[kind], files: MAX_FILES },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `File type not allowed: ${file.originalname}. Allowed: ${allowed.join(", ")}`
          )
        );
      }
    },
  });
}

module.exports = {
  uploadImage: makeUploader({ destination: "./images/", kind: "image" }),
  uploadPdf: makeUploader({ destination: "./documantion/", kind: "pdf" }),
  ALLOWED_EXTENSIONS,
  MAX_SIZE,
  MAX_FILES,
};
