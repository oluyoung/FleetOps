/* eslint-disable */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("vehicles", {
    id: { type: "text", primaryKey: true },
    latitude: { type: "double precision" },
    longitude: { type: "double precision" },
    altitude_meters: { type: "double precision" },
    speed_mps: { type: "double precision" },
    heading_degrees: { type: "double precision" },
    battery_percent: { type: "double precision" },
    connectivity: { type: "text" },
    last_seen_source: { type: "text" },
    last_updated_at: { type: "timestamptz", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("vehicle_events", {
    id: { type: "uuid", primaryKey: true },
    vehicle_id: {
      type: "text",
      notNull: true,
      references: "vehicles",
      onDelete: "cascade",
    },
    source: { type: "text", notNull: true },
    occurred_at: { type: "timestamptz", notNull: true },
    received_at: { type: "timestamptz", notNull: true },
    telemetry: { type: "jsonb", notNull: true },
  });

  pgm.createIndex("vehicle_events", ["vehicle_id", "occurred_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("vehicle_events");
  pgm.dropTable("vehicles");
};
