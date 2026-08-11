/* eslint-disable */
exports.shorthands = undefined;

// Per ADR-005 ("provider ID mapping" is adapter-owned) and Step 13: canonical
// vehicleIds must be FleetOps-owned, not provider-owned. This table is the
// durable (source, provider_ref) -> vehicle_id mapping that lets identity-
// establishing adapters (OpenSky, MQTT) resolve a raw provider identifier to
// the same canonical vehicle every time, instead of embedding the provider's
// id format/namespace directly into vehicleId.
exports.up = (pgm) => {
  pgm.createTable("vehicle_identities", {
    id: { type: "uuid", primaryKey: true },
    source: { type: "text", notNull: true },
    provider_ref: { type: "text", notNull: true },
    vehicle_id: { type: "text", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint("vehicle_identities", "vehicle_identities_source_provider_ref_key", {
    unique: ["source", "provider_ref"],
  });
};

exports.down = (pgm) => {
  pgm.dropTable("vehicle_identities");
};
