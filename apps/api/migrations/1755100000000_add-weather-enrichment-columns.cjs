/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("vehicles", {
    ambient_temperature_c: { type: "double precision" },
    wind_speed_mps: { type: "double precision" },
    weather_updated_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("vehicles", [
    "ambient_temperature_c",
    "wind_speed_mps",
    "weather_updated_at",
  ]);
};
