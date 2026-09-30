const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ALLOWED_EXTENSIONS = {
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  pdf: [".pdf"],
};

const MAX_SIZE = {
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
};

const MAX_FILES = 60;

function makeStorage(destinationDir) {
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
