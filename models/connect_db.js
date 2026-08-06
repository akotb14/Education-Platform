const mongoose = require("mongoose");
const config = require("../config");

module.exports = class ConnectDB {
  static db() {
    mongoose.set("strictQuery", true);
    return mongoose
      .connect(config.databaseUrl)
      .then(() => {
        console.log("db is connected");
      })
      .catch((e) => {
        console.error("db connection failed:", e.message);
        process.exit(1);
      });
  }
};
