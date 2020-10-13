const fetch = require("node-fetch");
const strava = require("strava-v3");
const prettyMilliseconds = require("pretty-ms");
const dateFormat = require("dateformat");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const JSONdb = require("simple-json-db");
const db = new JSONdb(__dirname + "/database.json");
const fs = require("fs");
const polyline = require("google-polyline");
const merc = require("mercator-projection");
const turf = require("@turf/turf");
const paper = require("paper-jsdom");
const sharp = require("sharp");

require("dotenv").config({ path: __dirname + "/.env" });

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

const makeSharpImage = async (image, distance, date, time, route) => {
  const routeSvg = Buffer.from(`<svg viewBox="-2 0 160 160">${route}</svg>`);

  const svgText = Buffer.from(`<svg height="300" width="300"> 
  <text x="160" y="40" font-weight="bold" font-size="20" fill="#000" font-family="Tahoma, Verdana, Segoe, sans-serif">${distance}</text>
  <text x="20" y="190" font-weight="bold" font-size="20" fill="#000" font-family="Tahoma, Verdana, Segoe, sans-serif">${time}</text>
  <text x="20" y="220" font-weight="bold" font-size="20" fill="#000" font-family="Tahoma, Verdana, Segoe, sans-serif">${date}</text>
  <text x="20" y="295" font-size="20" fill="#000" font-family="Tahoma, Verdana, Segoe, sans-serif">.</text>

  </svg>`);

  return sharp(image)
    .flatten({ background: "#fff" })
    .composite([
      { input: routeSvg, top: 60, left: 160, blend: "over" },
      { input: svgText, gravity: sharp.gravity.northwest, blend: "over" },
    ])
    .toFile("result.png");
};

(async function() {
  // makeSharpImage(__dirname + "/templates/run.png", '20 km', dateFormat(new Date(), "dd mmm yyyy"), prettyMilliseconds(234533 * 1000))
  // return
  const activities = await getLastActivities();

  console.log({ activities });

  const lastActivity = activities[0];

  const lastDbactivity = db.get("last");

  if (lastDbactivity !== lastActivity.id) {
    // haven't printed yet so print

    let runImage = null;
    if (lastActivity.type === "Run") {
      runImage = __dirname + "/templates/run.png";
    } else if (lastActivity.type === "Walk") {
      runImage = __dirname + "/templates/walk.png";
    } else if (lastActivity.type === "Cycle") {
      runImage = __dirname + "/templates/cycle.png";
    } else {
      console.log("unkown type");
      db.set("last", lastActivity.id);
      return;
    }

    const routeSvg = makeRoutePath(lastActivity.map.summary_polyline);

    await makeSharpImage(
      runImage,
      `${(lastActivity.distance / 1000).toFixed(1)} km`,
      `${dateFormat(new Date(lastActivity.start_date_local), "dd mmm yyyy")}`,
      `${prettyMilliseconds(lastActivity.moving_time * 1000)}`,
      routeSvg
    );

    db.set("last", lastActivity.id);

    const { stdout, stderr } = await exec(
      "lp -d PP-9000 -o fit-to-page result.png"
    );
    console.log({ stdout });
  } else {
    console.log("not need to print");
  }
})();

function makeRoutePath(route) {
  const decodedPoly = polyline.decode(route.replace(/\\\\/g, "\\"));
  const linestring1 = turf.lineString(
    decodedPoly.map((a) => [a[1], a[0]]),
    { name: "line 1" }
  );
  const bbox = turf.bbox(linestring1);
  const squareSize = 150;

  const xyPlot = linestring1.geometry.coordinates.map((a) =>
    merc.fromLatLngToPoint({ lat: a[1], lng: a[0] })
  );
  const xyBbox = [
    merc.fromLatLngToPoint({ lat: bbox[1], lng: bbox[0] }),
    merc.fromLatLngToPoint({ lat: bbox[3], lng: bbox[2] }),
  ];

  // dont know why i couldnt come up with this function myself thanks stack overflow
  const mapRange = function(from, to, s) {
    return to[0] + ((s - from[0]) * (to[1] - to[0])) / (from[1] - from[0]);
  };

  const aspect =
    Math.abs(xyBbox[1].x - xyBbox[0].x) / Math.abs(xyBbox[1].y - xyBbox[0].y);

  const mappedXY = xyPlot.map((a) => ({
    x: mapRange([xyBbox[0].x, xyBbox[1].x], [0, squareSize * aspect], a.x),
    y: mapRange([xyBbox[1].y, xyBbox[0].y], [0, squareSize], a.y),
  }));

  paper.setup(new paper.Size(squareSize, squareSize));
  var myPath = new paper.Path();
  myPath.strokeColor = "black";
  myPath.strokeWidth = 2;
  mappedXY.forEach((a) => {
    myPath.add(new paper.Point(a.x, a.y));
  });
  myPath.simplify(1);

  var svg1 = myPath.exportSVG({ asString: true });
  // fs.writeFile('aaa.svg', `<svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" version="1.1">${svg1}</svg>`, function (err) {
  // 	if (err) return console.log(err);
  // 	console.log('wrote');
  //   });

  return svg1;
}
