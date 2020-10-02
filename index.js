const fetch = require("node-fetch");
const Jimp = require("jimp");
const strava = require("strava-v3");
const prettyMilliseconds = require("pretty-ms");
const dateFormat = require("dateformat");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const JSONdb = require("simple-json-db");
const db = new JSONdb(__dirname + "/database.json");
require("dotenv").config();

strava.config({
  access_token: "blank",
  client_id: process.env.STRAVA_CLIENT_ID,
  client_secret: process.env.STRAVA_CLIENT_SECRET,
  redirect_uri: "http://localhost",
});

const refreshToken = process.env.STRAVA_REFRESH_TOKEN;

const getLastActivities = async () => {
  // try get the activities otherwise get it with the refresh token

  const stravaToken = db.get("strava");

  let activities = [];
  try {
    activities = await strava.athlete.listActivities({
      access_token: stravaToken,
      per_page: 5,
      page: 1,
    });
  } catch (error) {
    if (error.statusCode === 401) {
      // assume this is token expire so lets get a new one and try again
      const newToken = await strava.oauth.refreshToken(refreshToken);
      db.set("strava", newToken.access_token);
      activities = await strava.athlete.listActivities({
        access_token: newToken.access_token,
        per_page: 5,
        page: 1,
      });
    }
  }

  return activities;
};

(async function() {
  const activities = await getLastActivities();

  console.log({ activities });

  const lastActivity = activities[0];

  const lastDbactivity = db.get("last");

  if (lastDbactivity !== lastActivity.id) {
    // haven't printed yet so print

    const font = await Jimp.loadFont(__dirname + "/fonts/exo2.fnt");
    // const font = await Jimp.loadFont(Jimp.FONT_SANS_8_BLACK)

    let runImage = null;
    if (lastActivity.type === "Run") {
        runImage = await Jimp.read(__dirname + "/templates/run.png");
    }
    else if (lastActivity.type === "Walk") {
        runImage = await Jimp.read(__dirname + "/templates/walk.png");
    }
    else if (lastActivity.type === "Cycle") {
        runImage = await Jimp.read(__dirname + "/templates/cycle.png");
    } else {
      console.log("unkown type");
      db.set("last", lastActivity.id);
      return;
    }

    await runImage
      .print(font, 160, 20, `${(lastActivity.distance / 1000).toFixed(1)} km`)
      .print(font, 160, 60, `Yay!!`)
      .print(
        font,
        20,
        120 + 50,
        `${dateFormat(new Date(lastActivity.start_date_local), "dd mmm yyyy")}`
      )
      .print(
        font,
        160,
        120,
        `${prettyMilliseconds(lastActivity.moving_time * 1000)}`
      )
      .print(font, 20, 120 + 50 + 50 + 50, `-`)

      // .resize(256, 256)
      .writeAsync("result.png");

    db.set("last", lastActivity.id);

    const { stdout, stderr } = await exec(
      "lp -d PP-9000 -o fit-to-page result.png"
    );
    console.log({ stdout });
  } else {
    console.log("not need to print");
  }
})();
